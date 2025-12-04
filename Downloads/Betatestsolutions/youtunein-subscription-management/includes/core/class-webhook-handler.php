<?php
/**
 * Handle Stripe Webhook event.
 *
 * @package YTISM
 */

namespace YTISM\Core;

use YTISM\Helpers\Stripe_Error_Codes;
use YTISM\Helpers\Functions;
use YTISM\Database\Factory;
use YTISM\Core\Stripe_Product_Manager;
use WP_REST_Request;
use WP_REST_Response;
use WP_User_Query;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Webhook_Handler {
	private $stripe;
	private $payments_db;
	private $subscriptions_db;
	private $events_db;

	public function __construct() {
		$stripe_secret_key = Functions::get_settings( 'stripe_secret_key' );

		if ( ! empty( $stripe_secret_key ) ) {
			$this->stripe = new \Stripe\StripeClient( $stripe_secret_key );
		}

		$this->payments_db      = Factory::payment();
		$this->subscriptions_db = Factory::subscription();
		$this->events_db        = Factory::event();
	}

	/**
	 * Main webhook handler
	 */
	public function handle_webhook( WP_REST_Request $request ) {
		try {
			$payload        = $request->get_body();
			$sig_header     = isset( $_SERVER['HTTP_STRIPE_SIGNATURE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_STRIPE_SIGNATURE'] ) ) : '';
			$webhook_secret = Functions::get_settings( 'stripe_webhook_secret' );

			if ( empty( $payload ) || empty( $sig_header ) ) {
				Functions::log_debug( 'Missing payload or signature' );
				return new WP_REST_Response( [ 'error' => 'Missing payload or signature' ], 400 );
			}

			// Verify webhook signature
			try {
				$event = \Stripe\Webhook::constructEvent( $payload, $sig_header, $webhook_secret );
			} catch ( \UnexpectedValueException $e ) {
				Functions::log_debug( 'Invalid payload: ' . $e->getMessage() );
				return new WP_REST_Response( [ 'error' => 'Invalid payload' ], 400 );
			} catch ( \Stripe\Exception\SignatureVerificationException $e ) {
				Functions::log_debug( 'Invalid signature: ' . $e->getMessage() );
				return new WP_REST_Response( [ 'error' => 'Invalid signature' ], 400 );
			}

			// Process webhook
			$result = $this->process_webhook_event( $event );

			return new WP_REST_Response(
				[
					'status'     => 'ok',
					'event_type' => $event->type,
					'processed'  => $result,
				],
				200
			);

		} catch ( \Exception $e ) {
			Functions::log_debug( 'Processing failed: ' . $e->getMessage() );
			return new WP_REST_Response( [ 'error' => 'Webhook processing failed' ], 500 );
		}
	}

	/**
	 * Route webhook events to appropriate handlers
	 */
	private function process_webhook_event( $event ) {
		switch ( $event->type ) {
			// Subscription events.
			case 'customer.subscription.created':
				return $this->handle_subscription_created( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'customer.subscription.updated':
				return $this->handle_subscription_updated( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'customer.subscription.deleted':
				return $this->handle_subscription_deleted( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'customer.subscription.trial_will_end':
				return $this->handle_subscription_trial_will_end( $event->data->object, $event->id, $event->data->previous_attributes ?? null );

			case 'payment_intent.succeeded':
				return $this->handle_payment_intent_succeeded( $event->data->object, $event->id, $event->data->previous_attributes ?? null );

			/**
			 * For trailing subscriptions.
			 */
			case 'setup_intent.setup_failed':
				return $this->handle_setup_intent_failed( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'setup_intent.canceled':
				return $this->handle_setup_intent_canceled( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'setup_intent.succeeded':
				return $this->handle_setup_intent_succeeded( $event->data->object, $event->id, $event->data->previous_attributes ?? null );

			case 'invoice.finalized':
				return $this->handle_invoice_finalized( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'invoice.payment_failed':
				return $this->handle_invoice_payment_failed( $event->data->object, $event->id, $event->data->previous_attributes ?? null );
			case 'invoice.paid':
				return $this->handle_invoice_paid( $event->data->object, $event->id, $event->data->previous_attributes ?? null );

			/**
			 * For normal subscriptions
			 */
			/*
			case 'payment_intent.payment_failed':
				return $this->handle_payment_intent_failed($event->data->object);
			case 'payment_intent.processing':
				return $this->handle_payment_intent_processing($event->data->object);
			case 'payment_intent.canceled':
				return $this->handle_payment_intent_canceled($event->data->object);
				*/

			// Product events
			case 'product.created':
			case 'product.updated':
				return $this->handle_product_update_create( $event->data->object );
			case 'product.deleted':
				return $this->handle_product_deleted( $event->data->object );

			// Plan/Price events
			case 'plan.created':
			case 'plan.updated':
			case 'price.created':
			case 'price.updated':
			case 'plan.deleted':
			case 'price.deleted':
				return $this->handle_price_plan_curd( $event->data->object );

			default:
				return false;
		}
	}

	private function handle_subscription_created( $subscription, string $event_id, $previous_attributes = null ) {
		if ( empty( $subscription->id ) || empty( $event_id ) || empty( $subscription->metadata->wp_user_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Subscription created event missing ID, event ID, or wp_user_id in metadata.' );
			return false;
		}

		$sub_handler       = new \YTISM\Database\Subscription_Handler();
		$log_handler       = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$user_id            = intval( $subscription->metadata->wp_user_id );
		$user               = get_user_by( 'id', $user_id );
		$existing_sub       = $sub_handler->get_by_gateway_id( 'stripe', $subscription->id, ARRAY_A );
		$existing_sub_order = $sub_order_handler->get_by_gateway_id( 'stripe', $subscription->id );

		if ( ! $existing_sub_order || null === $existing_sub_order || ! ( $existing_sub_order instanceof \YTISM\Core\Sub_Order ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Subscription created event received but no matching subscription found for Stripe ID ' . $subscription->id );
			return false;
		}

		if ( ! $existing_sub || empty( $existing_sub['ID'] ) || ! $user ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Subscription created event received but no matching subscription found for Stripe ID ' . $subscription->id );
			return false;
		}

		// Check if log already exists for this event.
		$log_data = $sub_order_handler->get_log_by_uid( $event_id );
		if ( $log_data ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Duplicate event received for subscription ' . $subscription->id . ', skipping processing.' );
			return false;
		}

		$status_map      = [
			'incomplete'         => 'incomplete',
			'incomplete_expired' => 'expired',
			'trialing'           => 'trialing',
			'active'             => 'active',
			'past_due'           => 'past_due',
			'canceled'           => 'canceled',
			'unpaid'             => 'unpaid',
			'paused'             => 'paused',
		];
		$status          = $status_map[ $subscription->status ] ?? $subscription->status;
		$setup_intent_id = $subscription->pending_setup_intent ?? null;

		if ( ! empty( $setup_intent_id ) ) {
			// Verify setup intent status
			try {
				$setup_intent = $this->stripe->setupIntents->retrieve( $setup_intent_id, [] );
				if ( $setup_intent && $setup_intent->status !== 'succeeded' ) {
					$status = 'incomplete';
				}
			} catch ( \Exception $e ) {
				Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Failed to retrieve SetupIntent ' . $setup_intent_id . ': ' . $e->getMessage() );
				$status = 'incomplete';
			}
		}

		$plan         = $subscription->plan ?? null;
		$period_start = ! empty( $subscription->current_period_start ) ? gmdate( 'Y-m-d H:i:s', $subscription->current_period_start ) : null;
		$period_end   = ! empty( $subscription->current_period_end ) ? gmdate( 'Y-m-d H:i:s', $subscription->current_period_end ) : null;
		$trial_start  = ! empty( $subscription->trial_start ) ? gmdate( 'Y-m-d H:i:s', $subscription->trial_start ) : null;
		$trial_end    = ! empty( $subscription->trial_end ) ? gmdate( 'Y-m-d H:i:s', $subscription->trial_end ) : null;

		$newdata = [
			'plan_id'          => $plan->id ?? null,
			'customer_id'      => $subscription->customer ?? null,
			'qty'              => $subscription->quantity ?? 1,
			'status'           => $status,
			'period_start'     => $period_start,
			'period_end'       => $period_end,
			'next_billing_at'  => $subscription->cancel_at_period_end ? null : $period_end,
			'trial_start_at'   => $trial_start,
			'trial_end_at'     => $trial_end,
			'activated_at'     => ( in_array( $status, [ 'active', 'past_due' ] ) ? current_time( 'mysql' ) : null ),
			'billing_cycle'    => $plan->interval ?? 'month',
			'billing_interval' => $plan->interval_count ?? 1,
			'metadata'         => [
				'setup_intent_id' => $subscription->pending_setup_intent ?? null,
				'invoice_id'      => $subscription->latest_invoice ?? null,
			],
		];

		$existing_sub['metadata'] = is_array( $existing_sub['metadata'] ) ? $existing_sub['metadata'] : json_decode( $existing_sub['metadata'], true );
		$needs_update             = Functions::array_changes_only_recursive( $existing_sub, $newdata );
		if ( ! empty( $needs_update ) ) {
			$sub_handler->update( $existing_sub['ID'], $needs_update );
		}

		$message = ( ( $trial_end && $trial_start ) || $subscription->status === 'trialing' )
			? sprintf(
				__( 'Subscription created with trial: start=%1$s, end=%2$s (duration=%3$d days), subscription_id=%4$s', 'ytism' ),
				$trial_start,
				$trial_end,
				ceil( ( strtotime( $trial_end ) - strtotime( $trial_start ) ) / 86400 ),
				$subscription->id
			)
			: sprintf(
				__( 'Subscription created: status=%1$s, plan_id=%2$s, period_start=%3$s, period_end=%4$s, subscription_id=%5$s', 'ytism' ),
				$status,
				$plan->id ?? 'N/A',
				$period_start,
				$period_end,
				$subscription->id
			);

		$log_id = $log_handler->create(
			[
				'ref_type'   => 'subscription',
				'ref_id'     => $existing_sub['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'subscription.created',
				'severity'   => 'info',
				'message'    => $message,
				'data'       => wp_json_encode(
					[
						'subscription_id'     => $subscription->id,
						'customer_id'         => $subscription->customer ?? null,
						'subscription_status' => $subscription->status,
						'invoice_id'          => $subscription->latest_invoice ?? null,
						'setup_intent_id'     => $subscription->pending_setup_intent ?? null,
					]
				),
				'user_id'    => $user->ID,
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.created> Failed to log subscription.created event: ' . $log_id->get_error_message() );
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			'ytism_subscription_created',
			$existing_sub['ID'],
			$user->ID,
			[
				'trial_start'          => $trial_start,
				'trial_end'            => $trial_end,
				'subscription_id'      => $subscription->id,
				'customer_id'          => $subscription->customer ?? null,
				'current_period_start' => $period_start,
				'current_period_end'   => $period_end,
			]
		);
		*/

		return true;
	}

	private function handle_subscription_updated( $subscription, string $event_id, $previous_attributes = null ) {
		if ( empty( $subscription->id ) || empty( $event_id ) || empty( $subscription->metadata->wp_user_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.updated> Subscription updated event missing ID, event ID, or wp_user_id in metadata.' );
			return false;
		}

		$sub_handler       = new \YTISM\Database\Subscription_Handler();
		$log_handler       = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$user_id     = intval( $subscription->metadata->wp_user_id );
		$user        = get_user_by( 'id', $user_id );

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $subscription->id, ARRAY_A );
		if ( ! $existing_sub || empty( $existing_sub['ID'] ) || ! $user ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.updated> Subscription updated event received but no matching subscription found for Stripe ID ' . $subscription->id );
			return false;
		}

		$status_map      = [
			'incomplete'         => 'incomplete',
			'incomplete_expired' => 'expired',
			'trialing'           => 'trialing',
			'active'             => 'active',
			'past_due'           => 'past_due',
			'canceled'           => 'canceled',
			'unpaid'             => 'unpaid',
			'paused'             => 'paused',
		];
		$new_status      = $status_map[ $subscription->status ] ?? $subscription->status;
		$setup_intent_id = $subscription->pending_setup_intent ?? null;

		if ( ! empty( $setup_intent_id ) ) {
			try {
				$setup_intent = $this->stripe->setupIntents->retrieve( $setup_intent_id, [] );
				if ( $setup_intent && $setup_intent->status !== 'succeeded' ) {
					$new_status = 'incomplete';
				}
			} catch ( \Exception $e ) {
				Functions::log_debug( 'WEBHOOK:<customer.subscription.updated> Failed to retrieve SetupIntent ' . $setup_intent_id . ': ' . $e->getMessage() );
				$new_status = 'incomplete';
			}
		}

		$plan         = $subscription->plan ?? null;
		$period_start = ! empty( $subscription->current_period_start ) ? date( 'Y-m-d H:i:s', $subscription->current_period_start ) : null;
		$period_end   = ! empty( $subscription->current_period_end ) ? date( 'Y-m-d H:i:s', $subscription->current_period_end ) : null;
		$trial_start  = ! empty( $subscription->trial_start ) ? date( 'Y-m-d H:i:s', $subscription->trial_start ) : null;
		$trial_end    = ! empty( $subscription->trial_end ) ? date( 'Y-m-d H:i:s', $subscription->trial_end ) : null;

		$newdata = [
			'plan_id'          => $plan->id ?? null,
			'customer_id'      => $subscription->customer ?? null,
			'qty'              => $subscription->quantity ?? 1,
			'status'           => $new_status,
			'period_start'     => $period_start,
			'period_end'       => $period_end,
			'next_billing_at'  => $subscription->cancel_at_period_end ? null : $period_end,
			'trial_start_at'   => $trial_start,
			'trial_end_at'     => $trial_end,
			'activated_at'     => ( in_array( $new_status, [ 'active', 'past_due' ] ) && empty( $existing_sub['activated_at'] ) ) ? current_time( 'mysql' ) : $existing_sub['activated_at'],
			'billing_cycle'    => $plan->interval ?? 'month',
			'billing_interval' => $plan->interval_count ?? 1,
			'metadata'         => [
				'setup_intent_id' => $subscription->pending_setup_intent ?? null,
				'invoice_id'      => $subscription->latest_invoice ?? null,
			],
		];

		$existing_sub['metadata'] = is_array( $existing_sub['metadata'] ) ? $existing_sub['metadata'] : json_decode( $existing_sub['metadata'], true );
		$needs_update             = Functions::array_changes_only_recursive( $existing_sub, $newdata );
		if ( ! is_array( $needs_update ) || empty( $needs_update ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.updated> No changes detected for subscription ' . $subscription->id . ', skipping update. Old Status: ' . $existing_sub['status'] . ', New Status: ' . $new_status );
			return false;
		}

		$sub_handler->update( $existing_sub['ID'], $needs_update );

		// Build log message with readable changes
		$changes = [];
		foreach ( $needs_update as $key => $value ) {
			$old_value = $existing_sub[ $key ] ?? 'N/A';
			if ( $key === 'metadata' && is_array( $value ) ) {
				$meta_changes = [];
				$old_meta     = is_array( $old_value ) ? $old_value : [];
				foreach ( $value as $mkey => $mval ) {
					$old_mval       = $old_meta[ $mkey ] ?? 'N/A';
					$meta_changes[] = sprintf( '%s: %s -> %s', $mkey, $old_mval, $mval );
				}
				$changes[] = 'metadata: [' . implode( ', ', $meta_changes ) . ']';
			} else {
				$changes[] = sprintf( '%s: %s -> %s', $key, $old_value, $value );
			}
		}

		if ( isset( $needs_update['status'] ) && isset( $existing_sub['status'] ) ) {
			array_unshift( $changes, sprintf( 'Status changed: %s -> %s', $existing_sub['status'], $needs_update['status'] ) );
		}

		$message = sprintf(
			__( 'Subscription updated for subscription_id=%1$s): %2$s', 'ytism' ),
			$subscription->id,
			implode( ', ', $changes )
		);

		$severity = in_array( $new_status, [ 'past_due', 'expired', 'unpaid' ] ) ? 'warning'
			: ( $new_status === 'canceled' ? 'error'
			: ( in_array( $new_status, [ 'active', 'trialing' ] ) ? 'success'
			: 'info' ) );

		$log_id = $log_handler->create(
			[
				'ref_type'   => 'subscription',
				'ref_id'     => $existing_sub['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'subscription.' . $new_status,
				'severity'   => $severity,
				'message'    => $message,
				'data'       => wp_json_encode(
					[
						'customer_id'         => $subscription->customer ?? null,
						'subscription_status' => $new_status,
						'subscription_id'     => $subscription->id,
						'latest_invoice'      => $subscription->latest_invoice ?? null,
					]
				),
				'user_id'    => $user->ID,
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.updated> Failed to log subscription.' . $new_status . ' event: ' . $log_id->get_error_message() );
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			"ytism_subscription_{$new_status}",
			$existing_sub['ID'],
			$user->ID,
			[
				'sub_data'             => $existing_sub,
				'subscription_id'      => $subscription->id,
				'customer_id'          => $subscription->customer ?? null,
				'current_period_start' => $period_start,
				'current_period_end'   => $period_end,
				'trial_start'          => $trial_start,
				'trial_end'            => $trial_end,
			]
		);
		*/

		return true;
	}

	private function handle_subscription_deleted( $subscription, string $event_id, $previous_attributes = null ) {
		if ( empty( $subscription->id ) || empty( $event_id ) || empty( $subscription->metadata->wp_user_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.deleted> Subscription deleted event missing ID, event ID, or wp_user_id in metadata.' );
			return false;
		}

		$sub_handler       = new \YTISM\Database\Subscription_Handler();
		$log_handler       = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$user_id     = intval( $subscription->metadata->wp_user_id );
		$user        = get_user_by( 'id', $user_id );

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $subscription->id, ARRAY_A );
		if ( ! $existing_sub || empty( $existing_sub['ID'] ) || ! $user ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.deleted> Subscription deleted event received but no matching subscription found for Stripe ID ' . $subscription->id );
			return false;
		}

		$old_status = $existing_sub['status'] ?? null;
		$new_status = 'canceled';

		if ( $old_status === $new_status ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.deleted> Subscription ' . $subscription->id . ' already marked as canceled, skipping update.' );
			return false;
		}

		$sub_handler->update(
			$existing_sub['ID'],
			[
				'status'      => $new_status,
				'canceled_at' => current_time( 'mysql' ),
			]
		);

		$details         = ( isset( $subscription->cancellation_details ) && is_object( $subscription->cancellation_details ) ) ? $subscription->cancellation_details : null;
		$reason          = $details && isset( $details->reason ) ? $details->reason : 'other';
		$reason_messages = [
			'cancellation_requested' => __( 'Cancellation requested', 'ytism' ),
			'payment_disputed'       => __( 'Payment disputed', 'ytism' ),
			'payment_failed'         => __( 'Payment failed', 'ytism' ),
			'other'                  => __( 'Other reason', 'ytism' ),
		];
		$reason_text     = $reason_messages[ $reason ] ?? __( 'Canceled on Stripe', 'ytism' );
		if ( $details && ! empty( $details->comment ) ) {
			$reason_text .= ' - ' . sanitize_text_field( $details->comment );
		}

		if ( ! empty( $subscription->pending_setup_intent ) ) {
			try {
				$setup_intent = $this->stripe->setupIntents->retrieve( $subscription->pending_setup_intent, [] );
				if ( $setup_intent && $setup_intent->status !== 'succeeded' ) {
					$reason_text .= ' (' . __( 'Payment method is not completed', 'ytism' ) . ')';
				}
			} catch ( \Exception $e ) {
				Functions::log_debug( 'WEBHOOK:<customer.subscription.deleted> Failed to retrieve SetupIntent ' . $subscription->pending_setup_intent . ': ' . $e->getMessage() );
			}
		}

		$message = sprintf(
			__( 'Subscription canceled. Reason: %s.', 'ytism' ),
			$reason_text
		);
		if ( $old_status ) {
			$message = sprintf( __( 'Subscription status updated from %1$s to %2$s. Reason: %3$s.', 'ytism' ), $old_status, $new_status, $reason_text );
		}

		// Log the cancellation
		$log_id = $log_handler->create(
			[
				'ref_type'   => 'subscription',
				'ref_id'     => $existing_sub['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'subscription.canceled',
				'severity'   => 'error',
				'message'    => $message,
				'data'       => wp_json_encode(
					[
						'customer_id'         => $subscription->customer ?? null,
						'subscription_status' => $new_status,
						'subscription_id'     => $subscription->id,
						'canceled_at'         => date( 'Y-m-d H:i:s', isset( $subscription->canceled_at ) ? $subscription->canceled_at : time() ),
					]
				),
				'user_id'    => $user->ID,
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.deleted> Failed to log subscription.canceled event: ' . $log_id->get_error_message() );
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			'ytism_subscription_canceled',
			$existing_sub['ID'],
			$user->ID,
			[
				'subscription_id'      => $subscription->id,
				'customer_id'          => $subscription->customer ?? null,
				'canceled_at'          => date( 'Y-m-d H:i:s', isset( $subscription->canceled_at ) ? $subscription->canceled_at : time() ),
				'cancellation_details' => $details,
			]
		);
		*/

		return true;
	}

	private function handle_subscription_trial_will_end( $subscription, string $event_id, $previous_attributes = null ) {
		// No action needed, just log
		if ( empty( $subscription->id ) || empty( $event_id ) || empty( $subscription->metadata->wp_user_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.trial_will_end> Subscription trial_will_end event missing ID, event ID, or wp_user_id in metadata.' );
			return false;
		}

		$sub_handler       = new \YTISM\Database\Subscription_Handler();
		$log_handler       = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$user_id     = intval( $subscription->metadata->wp_user_id );
		$user        = get_user_by( 'id', $user_id );

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $subscription->id, ARRAY_A );
		if ( ! $existing_sub || empty( $existing_sub['ID'] ) || ! $user || $existing_sub['status'] !== 'trialing' ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.trial_will_end> Subscription trial_will_end event received but no matching active trialing subscription found for Stripe ID ' . $subscription->id );
			return false;
		}

		$trial_end = ! empty( $subscription->trial_end ) ? date( 'Y-m-d H:i:s', $subscription->trial_end ) : null;

		$message = sprintf(
			__( 'Subscription trial will end on %s.', 'ytism' ),
			$trial_end ?? __( 'Unknown date', 'ytism' )
		);

		$log_id = $log_handler->create(
			[
				'ref_type'   => 'subscription',
				'ref_id'     => $existing_sub['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'subscription.trial_will_end',
				'severity'   => 'info',
				'message'    => $message,
				'data'       => wp_json_encode(
					[
						'customer_id'     => $subscription->customer ?? null,
						'subscription_id' => $subscription->id,
						'trial_end'       => $trial_end,
					]
				),
				'user_id'    => $user->ID,
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<customer.subscription.trial_will_end> Failed to log subscription.trial_will_end event: ' . $log_id->get_error_message() );
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			'ytism_subscription_trial_will_end',
			$existing_sub['ID'],
			$user->ID,
			[
				'trial_start'          => $subscription->trial_start ? date( 'Y-m-d H:i:s', $subscription->trial_start ) : $existing_sub['trial_start_at'] ?? null,
				'trial_end'            => $subscription->trial_end ? date( 'Y-m-d H:i:s', $subscription->trial_end ) : $existing_sub['trial_end_at'] ?? null,
				'subscription_id'      => $subscription->id,
				'customer_id'          => $subscription->customer ?? null,
				'current_period_start' => $subscription->current_period_start ? date( 'Y-m-d H:i:s', $subscription->current_period_start ) : $existing_sub['period_start'] ?? null,
				'current_period_end'   => $subscription->current_period_end ? date( 'Y-m-d H:i:s', $subscription->current_period_end ) : $existing_sub['period_end'] ?? null,
			]
		);
		*/

		return true;
	}

	private function handle_setup_intent_failed( $setup_intent, string $event_id, $previous_attributes = null ) {
		if ( empty( $setup_intent->id ) || empty( $event_id ) || empty( $setup_intent->last_setup_error ) || empty( $setup_intent->customer ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> Setup intent failed event missing ID, event ID, last_setup_error, or customer.' );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$error        = $setup_intent->last_setup_error;
		$existing_sub = $sub_handler->get_by_setup_intent( 'stripe', $setup_intent->customer, $setup_intent->id, null );
		if ( ! $existing_sub || empty( $existing_sub->ID ) || ! $error ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> No matching subscription found for setup_intent ' . $setup_intent->id . ' and customer ' . $setup_intent->customer );
			return false;
		}

		$existing_txn = $txn_handler->get_by_subscription_id( 'stripe', $existing_sub->ID, $setup_intent->created ?? null, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> No matching transaction found for setup_intent ' . $setup_intent->id . ' and subscription ID ' . $existing_sub->ID );
			return false;
		}

		$stripe_error_msg = Stripe_Error_Codes::get_error_message( $error );

		$system_message = ( $stripe_error_msg && isset( $stripe_error_msg['system_message'] ) ) ? $stripe_error_msg['system_message'] : ( $error && isset( $error->message ) ? $error->message : __( 'Unknown error occurred during setup.', 'ytism' ) );
		$user_message   = ( $stripe_error_msg && isset( $stripe_error_msg['user_message'] ) ) ? $stripe_error_msg['user_message'] : ( $error && isset( $error->message ) ? $error->message : __( 'Unknown error occurred during setup.', 'ytism' ) );

		// Payment method details
		$payment_method_details = null;
		if ( isset( $error->payment_method ) && ! empty( $error->payment_method->id ) ) {
			try {
				$payment_method = $this->stripe->paymentMethods->retrieve( $error->payment_method->id, [] );
				if ( $payment_method && $payment_method->id == $setup_intent->payment_method ) {
					$payment_method_details = Functions::format_payment_method_details( $payment_method );
				}
			} catch ( \Exception $e ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> Failed to retrieve PaymentMethod ' . $error->payment_method->id . ': ' . $e->getMessage() );
			}
		}

		$retry_count = 0;
		$newdata     = [
			'status'            => 'failed',
			'type'              => 'trial',
			'retry_count'       => $retry_count,
			'payment_method_id' => $error->payment_method->id ?? null,
			'processed_at'      => current_time( 'mysql' ),
			'gateway_data'      => [
				'stripe_message'         => [
					'system_message' => $system_message,
					'user_message'   => $user_message,
				],
				'payment_method_details' => $payment_method_details,
				'customer'               => $setup_intent->customer ?? null,
				'setup_intent_id'        => $setup_intent->id,
			],
		];

		$needs_update = Functions::array_changes_only_recursive(
			$existing_txn,
			[
				'status'            => 'failed',
				'type'              => 'trial',
				'payment_method_id' => $error->payment_method->id ?? null,
				'gateway_data'      => [
					'stripe_message'  => [
						'system_message' => $system_message,
						'user_message'   => $user_message,
					],
					'customer'        => $setup_intent->customer ?? null,
					'setup_intent_id' => $setup_intent->id,
				],
			]
		);

		if ( ! $needs_update || ! is_array( $needs_update ) || empty( $needs_update ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> No changes detected for transaction ' . $setup_intent->id . ', skipping update.' );
			return false;
		}

		if ( $existing_txn['status'] === 'failed' ) {
			$retry_count            = intval( $existing_txn['retry_count'] ) + 1;
			$newdata['retry_count'] = $retry_count;
		}

		$txn_handler->update( $existing_txn['ID'], $newdata );
		$sub_handler->update(
			$existing_sub->ID,
			[
				'status'      => 'incomplete',
				'last_txn_id' => $existing_txn['ID'],
			]
		);

		$message = sprintf(
			__( 'Trail payment setup failed, Reason: %s', 'ytism' ),
			$stripe_error_msg['system_message'] ?? $error->message ?? __( 'Unknown error', 'ytism' )
		);

		// Store the log
		$log_id = $log_handler->create(
			[
				'ref_type'   => 'transaction',
				'ref_id'     => $existing_txn['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'transaction.setup_failed',
				'severity'   => 'error',
				'message'    => $message,
				'data'       => wp_json_encode(
					[
						'setup_intent_id'   => $setup_intent->id,
						'error_type'        => $error->type ?? null,
						'error_code'        => $error->code ?? null,
						'decline_code'      => $error->decline_code ?? null,
						'customer'          => $setup_intent->customer ?? null,
						'payment_method_id' => $error->payment_method->id ?? null,
					]
				),
				'user_id'    => get_current_user_id(),
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> Failed to log setup on setup_intent.setup_failed: ' . $log_id->get_error_message() );
		}

		// Cancel subscription if retry_count >= 3
		if ( $retry_count >= 3 && ( $existing_sub->status === 'incomplete' || $existing_sub->status === 'trialing' ) && $existing_sub->status !== 'canceled' ) {
			$old_status = $existing_sub->status;
			$sub_handler->update(
				$existing_sub->ID,
				[
					'status'      => 'canceled',
					'canceled_at' => current_time( 'mysql' ),
				]
			);

			$message = sprintf(
				__( 'Subscription canceled. Reason: Multiple times payment setup failed attempt.', 'ytism' )
			);
			if ( $old_status ) {
				$message = sprintf( __( 'Subscription status updated from %1$s to %2$s. Reason: Multiple times payment setup failed attempt.', 'ytism' ), $old_status, 'canceled' );
			}

			$sub_log_id = $log_handler->create(
				[
					'ref_type'   => 'subscription',
					'ref_id'     => $existing_txn['sub_id'],
					'gateway'    => 'stripe',
					'event_id'   => $event_id,
					'event_code' => 'subscription.canceled',
					'severity'   => 'error',
					'message'    => $message,
					'data'       => wp_json_encode(
						[
							'setup_intent_id'   => $setup_intent->id,
							'error_type'        => $error->type ?? null,
							'error_code'        => $error->code ?? null,
							'decline_code'      => $error->decline_code ?? null,
							'payment_method_id' => $error->payment_method->id ?? null,
						]
					),
					'user_id'    => get_current_user_id(),
					'ip'         => Functions::get_user_ip(),
					'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
				]
			);

			if ( is_wp_error( $sub_log_id ) ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> Failed to log subscription canceled: ' . $sub_log_id->get_error_message() );
			}

			// Cancel on Stripe if gateway_sub_id exists
			try {
				$this->stripe->subscriptions->cancel( $existing_sub->gateway_sub_id, [] );
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.setup_failed> Stripe subscription rollback error: ' . $e->getMessage() );
			}
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			'ytism_setup_intent_failed',
			$existing_txn['ID'],
			[
				'sub_id'          => $existing_sub->ID,
				'subscription_id' => $existing_sub->gateway_sub_id ?? null,
				'retry_count'     => $retry_count,
				'setup_intent_id' => $setup_intent->id,
				'customer_id'     => $setup_intent->customer ?? null,
				'error'           => [
					'type'              => $error->type ?? null,
					'code'              => $error->code ?? null,
					'decline_code'      => $error->decline_code ?? null,
					'message'           => $error->message ?? null,
					'system_message'    => $stripe_error_msg['system_message'] ?? null,
					'payment_method_id' => $error->payment_method->id ?? null,
				],
			]
		);
		*/

		return true;
	}

	private function handle_setup_intent_canceled( $setup_intent, string $event_id, $previous_attributes = null ) {
		$required = [
			'id'         => $setup_intent->id ?? null,
			'event_id'   => $event_id ?? null,
			'customer'   => $setup_intent->customer ?? null,
			'wp_user_id' => $setup_intent->metadata->wp_user_id ?? null,
			'sub_id'     => $setup_intent->metadata->sub_id ?? null,
			'txn_id'     => $setup_intent->metadata->txn_id ?? null,
		];
		$missing  = array_keys(
			array_filter(
				$required,
				function ( $v ) {
					return empty( $v );
				}
			)
		);
		if ( $missing ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> Missing required fields: ' . implode( ', ', $missing ) );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get( $setup_intent->metadata->sub_id );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> No matching subscription found for setup_intent_id=' . $setup_intent->id . ', customer=' . $setup_intent->customer );
			return false;
		}

		$existing_txn = $txn_handler->get( $setup_intent->metadata->txn_id, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> No matching transaction found for setup_intent_id=' . $setup_intent->id . ', subscription_id=' . $existing_sub->ID );
			return false;
		}

		// Payment method details
		$payment_method_details = null;
		if ( ! empty( $setup_intent->payment_method ) ) {
			try {
				$payment_method = $this->stripe->paymentMethods->retrieve( $setup_intent->payment_method, [] );
				if ( $payment_method ) {
					$payment_method_details = Functions::format_payment_method_details( $payment_method );
				}
			} catch ( \Exception $e ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> Failed to retrieve PaymentMethod ' . $setup_intent->payment_method . ': ' . $e->getMessage() );
			}
		}

		$user_message   = __( 'Setup was canceled by the user or system.', 'ytism' );
		$system_message = __( 'The setup intent was canceled before completion.', 'ytism' );
		if ( $existing_txn['status'] === 'failed' ) {
			$gateway_data = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );
			if ( isset( $gateway_data['stripe_message'] ) && is_array( $gateway_data['stripe_message'] ) ) {
				$user_message   = $gateway_data['stripe_message']['user_message'] ?? $user_message;
				$system_message = $gateway_data['stripe_message']['system_message'] ?? $system_message;
			}
		}

		$newdata = [
			'status'            => 'canceled',
			'type'              => 'trial',
			'payment_method_id' => $setup_intent->payment_method ?? null,
			'processed_at'      => current_time( 'mysql' ),
			'gateway_data'      => [
				'customer'               => $setup_intent->customer ?? null,
				'setup_intent_id'        => $setup_intent->id,
				'payment_method_details' => $payment_method_details,
				'stripe_message'         => [
					'system_message' => $system_message,
					'user_message'   => $user_message,
				],
			],
		];

		$needs_update = Functions::array_changes_only_recursive(
			$existing_txn,
			[
				'status'            => 'canceled',
				'type'              => 'trial',
				'payment_method_id' => $setup_intent->payment_method ?? null,
				'gateway_data'      => [
					'customer'               => $setup_intent->customer ?? null,
					'setup_intent_id'        => $setup_intent->id,
					'payment_method_details' => $payment_method_details,
					'stripe_message'         => [
						'system_message' => $system_message,
						'user_message'   => $user_message,
					],
				],
			]
		);

		if ( ! $needs_update || ! is_array( $needs_update ) || empty( $needs_update ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> No changes detected for transaction ' . $setup_intent->id . ', skipping update.' );
			return false;
		}

		$txn_handler->update( $existing_txn['ID'], $newdata );
		$sub_handler->update(
			$existing_sub->ID,
			[
				'last_txn_id' => $existing_txn['ID'],
			]
		);

		// Store the log
		$log_id = $log_handler->create(
			[
				'ref_type'   => 'transaction',
				'ref_id'     => $existing_txn['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'transaction.setup_canceled',
				'severity'   => 'info',
				'message'    => __( 'Trial payment setup was canceled.', 'ytism' ),
				'data'       => wp_json_encode(
					[
						'customer'          => $setup_intent->customer ?? null,
						'setup_intent_id'   => $setup_intent->id,
						'payment_method_id' => $setup_intent->payment_method ?? null,
					]
				),
				'user_id'    => get_current_user_id(),
				'ip'         => Functions::get_user_ip(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:WEBHOOK:<setup_intent.canceled> Failed to log setup on setup_intent.canceled: ' . $log_id->get_error_message() );
		}

		// Cancel Subscription if status is incomplete or trialing
		if ( ( $existing_sub->status === 'incomplete' || $existing_sub->status === 'trialing' ) && $existing_sub->status !== 'canceled' ) {
			$old_status = $existing_sub->status;
			$sub_handler->update(
				$existing_sub->ID,
				[
					'status'      => 'canceled',
					'canceled_at' => current_time( 'mysql' ),
				]
			);

			$message = sprintf(
				__( 'Subscription canceled. Reason: Payment setup was canceled.', 'ytism' )
			);
			if ( $old_status ) {
				$message = sprintf( __( 'Subscription status updated from %1$s to %2$s. Reason: Payment setup was canceled.', 'ytism' ), $old_status, 'canceled' );
			}

			$sub_log_id = $log_handler->create(
				[
					'ref_type'   => 'subscription',
					'ref_id'     => $existing_txn['sub_id'],
					'gateway'    => 'stripe',
					'event_id'   => $event_id,
					'event_code' => 'subscription.canceled',
					'severity'   => 'error',
					'message'    => $message,
					'data'       => wp_json_encode(
						[
							'setup_intent_id'   => $setup_intent->id,
							'payment_method_id' => $setup_intent->payment_method ?? null,
						]
					),
					'user_id'    => get_current_user_id(),
					'ip'         => Functions::get_user_ip(),
					'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
				]
			);

			if ( is_wp_error( $sub_log_id ) ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> Failed to log subscription canceled: ' . $sub_log_id->get_error_message() );
			}

			// Cancel on Stripe
			try {
				$this->stripe->subscriptions->cancel( $existing_sub->gateway_sub_id, [] );
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'WEBHOOK:<setup_intent.canceled> Stripe subscription rollback error: ' . $e->getMessage() );
			}
		}

		// Trigger action for other plugins/themes to hook into
		/*
		do_action(
			'ytism_setup_intent_canceled',
			$existing_txn['ID'],
			[
				'sub_id'            => $existing_sub->ID,
				'subscription_id'   => $existing_sub->gateway_sub_id ?? null,
				'setup_intent_id'   => $setup_intent->id,
				'customer_id'       => $setup_intent->customer ?? null,
				'payment_method_id' => $setup_intent->payment_method ?? null,
			]
		);
		*/

		return true;
	}

	private function handle_setup_intent_succeeded( $setup_intent, string $event_id, $previous_attributes = null ) {
		$required = [
			'id'             => $setup_intent->id ?? null,
			'event_id'       => $event_id ?? null,
			'customer'       => $setup_intent->customer ?? null,
			'payment_method' => $setup_intent->payment_method ?? null,
			'wp_user_id'     => $setup_intent->metadata->wp_user_id ?? null,
			'sub_id'         => $setup_intent->metadata->sub_id ?? null,
			'txn_id'         => $setup_intent->metadata->txn_id ?? null,
		];
		$missing  = array_keys(
			array_filter(
				$required,
				function ( $v ) {
					return empty( $v );
				}
			)
		);
		if ( $missing ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> Missing required fields: ' . implode( ', ', $missing ) );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get( $setup_intent->metadata->sub_id );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> No matching subscription found for setup_intent_id=' . $setup_intent->id . ', customer=' . $setup_intent->customer );
			return false;
		}

		$existing_txn = $txn_handler->get( $setup_intent->metadata->txn_id, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> No matching transaction found for setup_intent_id=' . $setup_intent->id . ', subscription_id=' . $existing_sub->ID );
			return false;
		}

		$payment_method_detail = null;
		try {
			$payment_method = $this->stripe->paymentMethods->retrieve( $setup_intent->payment_method, [] );
			if ( $payment_method && ! empty( $payment_method->id ) ) {
				$payment_method_detail = Functions::format_payment_method_details( $payment_method );

				$newdata = [
					'status'            => 'succeeded',
					'type'              => 'trial',
					'payment_method_id' => $setup_intent->payment_method ?? null,
					'processed_at'      => current_time( 'mysql' ),
					'gateway_data'      => [
						'customer'               => $setup_intent->customer ?? null,
						'setup_intent_id'        => $setup_intent->id,
						'payment_method_details' => $payment_method_detail,
					],
				];

				$existing_txn['gateway_data'] = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );
				$needs_update                 = Functions::array_changes_only_recursive(
					$existing_txn,
					[
						'status'            => 'succeeded',
						'type'              => 'trial',
						'payment_method_id' => $payment_method->id,
						'gateway_data'      => [
							'customer'               => $setup_intent->customer ?? null,
							'setup_intent_id'        => $setup_intent->id,
							'payment_method_details' => $payment_method_detail,
						],
					]
				);

				if ( ! $needs_update || ! is_array( $needs_update ) || empty( $needs_update ) ) {
					Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> No changes detected for transaction_id=' . $setup_intent->id . '., skipping update.' );
					return false;
				}

				$txn_handler->update( $existing_txn['ID'], $newdata );
				if ( $existing_sub->status !== 'trialing' || $existing_sub->last_txn_id != $existing_txn['ID'] ) {
					// Update subscription status to trialing
					$sub_handler->update(
						$existing_sub->ID,
						[
							'status'       => 'trialing',
							'last_txn_id'  => $existing_txn['ID'],
							'activated_at' => current_time( 'mysql' ),
						]
					);
				}

				// Store the log
				$log_id = $log_handler->create(
					[
						'ref_type'   => 'transaction',
						'ref_id'     => $existing_txn['ID'],
						'gateway'    => 'stripe',
						'event_id'   => $event_id,
						'event_code' => 'transaction.setup_succeeded',
						'severity'   => 'info',
						'message'    => __( 'Trial payment setup succeeded.', 'ytism' ),
						'data'       => wp_json_encode(
							[
								'customer'          => $setup_intent->customer ?? null,
								'setup_intent_id'   => $setup_intent->id,
								'payment_method_id' => $payment_method->id ?? null,
							]
						),
						'user_id'    => get_current_user_id(),
						'ip'         => Functions::get_user_ip(),
						'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
					]
				);

				if ( is_wp_error( $log_id ) ) {
					Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> Failed to log setup for transaction_id=' . $setup_intent->id . '. Error: ' . $log_id->get_error_message() );
				}

				// Trigger action for other plugins/themes to hook into
				/*
				do_action(
					'ytism_setup_intent_succeeded',
					$existing_txn['ID'],
					[
						'sub_id'            => $existing_sub->ID,
						'subscription_id'   => $existing_sub->gateway_sub_id ?? null,
						'setup_intent_id'   => $setup_intent->id,
						'customer_id'       => $setup_intent->customer ?? null,
						'payment_method_id' => $payment_method->id ?? null,
					]
				);
				*/

				return true;
			}
		} catch ( \Exception $e ) {
			Functions::log_debug( 'WEBHOOK:<setup_intent.succeeded> Failed to retrieve PaymentMethod ' . $setup_intent->payment_method . ': ' . $e->getMessage() );

			return false;
		}

		return false;
	}

	private function handle_payment_intent_succeeded( $payment_intent, string $event_id, $previous_attributes = null ) {
		$required = [
			'id'             => $payment_intent->id ?? null,
			'event_id'       => $event_id ?? null,
			'customer'       => $payment_intent->customer ?? null,
			'payment_method' => $payment_intent->payment_method ?? null,
			'wp_user_id'     => $payment_intent->metadata->wp_user_id ?? null,
			'sub_id'         => $payment_intent->metadata->sub_id ?? null,
			'txn_id'         => $payment_intent->metadata->txn_id ?? null,
		];
		$missing  = array_keys(
			array_filter(
				$required,
				function ( $v ) {
					return empty( $v );
				}
			)
		);
		if ( $missing ) {
			Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> Missing required fields: ' . implode( ', ', $missing ) );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get( $payment_intent->metadata->sub_id );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> No matching subscription found for payment_intent_id=' . $payment_intent->id . ', customer=' . $payment_intent->customer );
			return false;
		}

		$existing_txn = $txn_handler->get( $payment_intent->metadata->txn_id, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> No matching transaction found for payment_intent_id=' . $payment_intent->id . ', subscription_id=' . $existing_sub->ID );
			return false;
		}

		try {
			$payment_method = $this->stripe->paymentMethods->retrieve( $payment_intent->payment_method, [] );
			if ( $payment_method && ! empty( $payment_method->id ) ) {
				$payment_method_detail = Functions::format_payment_method_details( $payment_method );

				$newdata = [
					'status'            => 'succeeded',
					'payment_method_id' => $payment_method->id,
					'processed_at'      => current_time( 'mysql' ),
					'gateway_data'      => [
						'customer'               => $payment_intent->customer ?? null,
						'payment_intent_id'      => $payment_intent->id,
						'payment_method_details' => $payment_method_detail,
					],
				];

				$existing_txn['gateway_data'] = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );
				$needs_update                 = Functions::array_changes_only_recursive(
					$existing_txn,
					[
						'status'            => 'succeeded',
						'payment_method_id' => $payment_method->id,
						'gateway_data'      => [
							'customer'               => $payment_intent->customer ?? null,
							'payment_intent_id'      => $payment_intent->id,
							'payment_method_details' => $payment_method_detail,
						],
					]
				);

				if ( ! $needs_update || ! is_array( $needs_update ) || empty( $needs_update ) ) {
					Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> No changes detected for transaction_id=' . $payment_intent->id . '., skipping update.' );
					return false;
				}

				$txn_handler->update( $existing_txn['ID'], $newdata );
				if ( $existing_sub->last_txn_id != $existing_txn['ID'] ) {
					$sub_handler->update(
						$existing_sub->ID,
						[
							'last_txn_id' => $existing_txn['ID'],
						]
					);
				}

				// Log message add payment details properly such as card and everything
				$message = sprintf(
					__( 'Payment intent succeeded for amount %1$s via %2$s', 'ytism' ),
					Functions::format_stripe_amount( $payment_intent->amount ?? 0, strtoupper( $payment_intent->currency ?? 'USD' ) ),
					$payment_method_detail['type'] ?? 'unknown'
				);

				// Store the log
				$log_id = $log_handler->create(
					[
						'ref_type'   => 'transaction',
						'ref_id'     => $existing_txn['ID'],
						'gateway'    => 'stripe',
						'event_id'   => $event_id,
						'event_code' => 'transaction.payment_intent_succeeded',
						'severity'   => 'info',
						'message'    => __( 'Payment succeeded.', 'ytism' ),
						'data'       => wp_json_encode(
							[
								'amount'                 => $payment_intent->amount ?? null,
								'currency'               => $payment_intent->currency ?? null,
								'customer'               => $payment_intent->customer ?? null,
								'payment_intent_id'      => $payment_intent->id,
								'payment_method_id'      => $payment_intent->payment_method ?? null,
								'sub_id'                 => $existing_sub->ID,
								'subscription_id'        => $existing_sub->gateway_sub_id ?? null,
								'payment_method_details' => $payment_method_detail,
							]
						),
						'user_id'    => get_current_user_id(),
						'ip'         => Functions::get_user_ip(),
						'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
					]
				);

				if ( is_wp_error( $log_id ) ) {
					Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> Failed to log payment for transaction_id=' . $payment_intent->id . '. Error: ' . $log_id->get_error_message() );
				}

				// Trigger action for other plugins/themes to hook into
				/*
				do_action(
					'ytism_payment_intent_succeeded',
					$existing_txn['ID'],
					[
						'sub_id'            => $existing_sub->ID,
						'subscription_id'   => $existing_sub->gateway_sub_id ?? null,
						'payment_intent_id' => $payment_intent->id,
						'customer_id'       => $payment_intent->customer ?? null,
						'payment_method_id' => $payment_method->id ?? null,
					]
				);
				*/

				return true;
			} else {
				Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> PaymentMethod ' . $payment_intent->payment_method . ' not found or invalid.' );
				return false;
			}
		} catch ( \Exception $e ) {
			Functions::log_debug( 'WEBHOOK:<payment_intent.succeeded> Failed to retrieve PaymentMethod ' . $payment_intent->payment_method . ': ' . $e->getMessage() );

			return false;
		}

		return false;
	}

	private function handle_payment_intent_created( $payment_intent, string $event_id, $previous_attributes = null ) {
		// No action needed, just log
		/*
		if (empty($payment_intent->id)) {
			Functions::log_debug('WEBHOOK: Payment intent created event missing ID.');
			return false;
		}

		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$message = sprintf(
			__("Payment intent created with ID %s.", "ytism"),
			$payment_intent->id
		);

		$log_id = $log_handler->create([
			'ref_type' => 'payment_intent',
			'ref_id' => null,
			'gateway' => 'stripe',
			'event_id' => $event_id,
			'event_code' => 'payment_intent.created',
			'severity' => 'info',
			'message' => $message,
			'data' => wp_json_encode([
				'amount' => $payment_intent->amount ?? null,
				'currency' => $payment_intent->currency ?? null,
				'customer' => $payment_intent->customer ?? null,
				'status' => $payment_intent->status ?? null,
				'payment_method' => $payment_intent->payment_method ?? null,
			]),
			'user_id' => get_current_user_id(),
			'ip' => Functions::get_user_ip(),
			'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null
		]);

		if (is_wp_error($log_id)) {
			Functions::log_debug('WEBHOOK: Failed to log payment_intent.created event: ' . $log_id->get_error_message());
		}

		return true;*/
	}

	private function handle_invoice_finalized( $invoice, string $event_id, $previous_attributes = null ) {
		if ( empty( $invoice->id ) || empty( $event_id ) || empty( $invoice->subscription ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.finalized> Invoice finalized event missing ID, event ID, or subscription ID.' );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $invoice->subscription );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.finalized> No matching subscription found for Subscription ID ' . $invoice->subscription );
			return false;
		}

		if ( $invoice->status !== 'open' || $invoice->paid === true || $invoice->amount_due <= 0 ) {
			Functions::log_debug( 'WEBHOOK:<invoice.finalized> Invoice status is not open or amount_due is zero/negative for Invoice ID ' . $invoice->id . ', skipping transaction creation.' );
			return false;
		}

		$map_status = [
			'draft'         => 'pending',
			'open'          => 'pending',
			'paid'          => 'succeeded',
			'uncollectible' => 'failed',
			'void'          => 'canceled',
		];
		$status     = $map_status[ $invoice->status ] ?? 'pending';

		$map_type = [
			'automatic_pending_invoice_item_invoice' => 'recurring',
			'manual'                                 => 'one_time',
			'quote_accept'                           => 'one_time',
			'subscription'                           => 'recurring',
			'subscription_create'                    => 'initial',
			'subscription_cycle'                     => 'upgrade',
			'subscription_threshold'                 => 'recurring',
			'subscription_update'                    => 'recurring',
			'upcoming'                               => 'recurring',
		];
		$type     = $map_type[ $invoice->billing_reason ] ?? 'one_time';

		$existing_txn = $txn_handler->get_by_gateway_txn_id( 'stripe', $invoice->id, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			// Create a new transaction record if not found
			$new_tnx_id = $txn_handler->create(
				[
					'sub_id'            => $existing_sub->ID,
					'gateway'           => 'stripe',
					'gateway_txn_id'    => $invoice->id,
					'gateway_intent_id' => $invoice->payment_intent ?? null,
					'status'            => $status,
					'type'              => $type,
					'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
					'currency'          => strtoupper( $invoice->currency ),
					'payment_method_id' => null,
					'processed_at'      => current_time( 'mysql' ),
					'gateway_data'      => wp_json_encode(
						[
							'subscription_id'  => $invoice->subscription,
							'intent_id'        => $invoice->payment_intent ?? null,
							'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
						]
					),
				]
			);

			if ( is_wp_error( $new_tnx_id ) ) {
				Functions::log_debug( 'WEBHOOK:<invoice.finalized> Failed to create transaction for Invoice ID ' . $invoice->id . ': ' . $new_tnx_id->get_error_message() );
				return false;
			}
		} else {
			$existing_txn['gateway_data'] = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );

			$needs_update = Functions::array_changes_only_recursive(
				$existing_txn,
				[
					'status'            => $status,
					'type'              => $type,
					'gateway_intent_id' => $invoice->payment_intent ?? null,
					'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
					'currency'          => strtoupper( $invoice->currency ),
					'gateway_data'      => [
						'subscription_id'  => $invoice->subscription,
						'intent_id'        => $invoice->payment_intent ?? null,
						'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
					],
				]
			);

			if ( $needs_update && is_array( $needs_update ) && ! empty( $needs_update ) ) {
				$txn_handler->update(
					$existing_txn['ID'],
					[
						'status'            => $status,
						'type'              => $type,
						'gateway_intent_id' => $invoice->payment_intent ?? null,
						'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
						'currency'          => strtoupper( $invoice->currency ),
						'processed_at'      => current_time( 'mysql' ),
						'gateway_data'      => [
							'subscription_id'  => $invoice->subscription,
							'intent_id'        => $invoice->payment_intent ?? null,
							'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
						],
					]
				);
			}
		}

		$log_id = $log_handler->create(
			[
				'ref_type'   => 'transaction',
				'ref_id'     => $existing_txn['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'transaction.invoice_finalized',
				'severity'   => 'info',
				'message'    => sprintf( __( 'Invoice finalized for payment of %1$s (Subscription: %2$s)', 'ytism' ), Functions::format_stripe_price( $invoice->amount_due, $invoice->currency ), $invoice->subscription ),
				'data'       => wp_json_encode(
					[
						'subscription_id' => $invoice->subscription,
						'payment_intent'  => $invoice->payment_intent,
						'amount_due'      => $invoice->amount_due,
						'currency'        => $invoice->currency,
						'customer_id'     => isset( $invoice->customer ) ? $invoice->customer : null,
					]
				),
				'user_id'    => get_current_user_id(),
				'ip'         => Functions::get_user_ip(),
				'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? $_SERVER['HTTP_USER_AGENT'] : null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.finalized> Failed to log invoice.finalized event: ' . $log_id->get_error_message() );
		}

		return true;
	}

	private function handle_invoice_payment_failed( $invoice, string $event_id, $previous_attributes = null ) {
		if ( empty( $invoice->id ) || empty( $event_id ) || empty( $invoice->subscription ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> Invoice payment failed event missing ID, event ID, or subscription ID.' );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $invoice->subscription );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> No matching subscription found for Subscription ID ' . $invoice->subscription );
			return false;
		}

		if ( $invoice->status !== 'open' || $invoice->paid === true || $invoice->amount_due <= 0 ) {
			Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> Invoice status is not open or amount_due is zero/negative for Invoice ID ' . $invoice->id . ', skipping transaction creation.' );
			return false;
		}

		$map_type = [
			'automatic_pending_invoice_item_invoice' => 'recurring',
			'manual'                                 => 'one_time',
			'quote_accept'                           => 'one_time',
			'subscription'                           => 'recurring',
			'subscription_create'                    => 'initial',
			'subscription_cycle'                     => 'upgrade',
			'subscription_threshold'                 => 'recurring',
			'subscription_update'                    => 'recurring',
			'upcoming'                               => 'recurring',
		];
		$type     = $map_type[ $invoice->billing_reason ] ?? 'recurring';

		$existing_txn = $txn_handler->get_by_gateway_txn_id( 'stripe', $invoice->id, 'ARRAY_A' );
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			// create a new transaction record if not found
			$new_tnx_id = $txn_handler->create(
				[
					'sub_id'            => $existing_sub['ID'],
					'gateway'           => 'stripe',
					'gateway_txn_id'    => $invoice->id,
					'gateway_intent_id' => $invoice->payment_intent ?? null,
					'status'            => 'failed',
					'type'              => $type,
					'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
					'currency'          => strtoupper( $invoice->currency ),
					'payment_method_id' => $invoice->default_payment_method ?? null,
					'processed_at'      => current_time( 'mysql' ),
					'gateway_data'      => wp_json_encode(
						[
							'subscription_id'  => $invoice->subscription,
							'intent_id'        => $invoice->payment_intent ?? null,
							'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
						]
					),
				]
			);

			if ( is_wp_error( $new_tnx_id ) ) {
				Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> Failed to create transaction for Invoice ID ' . $invoice->id . ': ' . $new_tnx_id->get_error_message() );
				return false;
			}
		} else {
			$existing_txn['gateway_data'] = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );

			if ( $existing_txn['status'] === 'failed' ) {
				$retry_count = intval( $existing_txn['retry_count'] ) + 1;
				$txn_handler->update(
					$existing_txn['ID'],
					[
						'retry_count'  => $invoice->attempt_count ?? $retry_count,
						'processed_at' => current_time( 'mysql' ),
					]
				);
			} else {
				$needs_update = Functions::array_changes_only_recursive(
					$existing_txn,
					[
						'status'            => 'failed',
						'type'              => $type,
						'gateway_intent_id' => $invoice->payment_intent ?? null,
						'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
						'currency'          => strtoupper( $invoice->currency ),
						'payment_method_id' => $invoice->default_payment_method ?? null,
						'gateway_data'      => wp_json_encode(
							[
								'subscription_id'  => $invoice->subscription,
								'intent_id'        => $invoice->payment_intent ?? null,
								'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
							]
						),
					]
				);

				if ( $needs_update && is_array( $needs_update ) && ! empty( $needs_update ) ) {
					$txn_handler->update(
						$existing_txn['ID'],
						[
							'status'            => 'failed',
							'type'              => $type,
							'gateway_intent_id' => $invoice->payment_intent ?? null,
							'amount'            => Functions::format_stripe_amount( $invoice->amount_due, $invoice->currency ),
							'currency'          => strtoupper( $invoice->currency ),
							'payment_method_id' => $invoice->default_payment_method ?? null,
							'processed_at'      => current_time( 'mysql' ),
							'gateway_data'      => wp_json_encode(
								[
									'subscription_id'  => $invoice->subscription,
									'intent_id'        => $invoice->payment_intent ?? null,
									'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
								]
							),
						]
					);
				}
			}
		}

		// Fetch payment intent to get error details
		$error_message = __( 'Unknown error', 'ytism' );
		if ( ! empty( $invoice->payment_intent ) ) {
			try {
				$payment_intent = $this->stripe->paymentIntents->retrieve( $invoice->payment_intent, [] );
				if ( $payment_intent && $payment_intent->status === 'requires_payment_method' ) {
					$stripe_message = Stripe_Error_Codes::get_error_message( $payment_intent->last_payment_error );
					$error_message  = $stripe_message['system_message'] ?? $payment_intent->last_payment_error->message ?? __( 'Payment method required', 'ytism' );
				}
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> Error retrieving payment intent ' . $invoice->payment_intent . ': ' . $e->getMessage() );
			}
		}

		// Log the payment failure
		$amount = Functions::format_stripe_price( $invoice->amount_due, $invoice->currency );
		$log_id = $log_handler->create(
			[
				'ref_type'   => 'transaction',
				'ref_id'     => $existing_txn['ID'],
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'transaction.invoice_payment_failed',
				'severity'   => 'error',
				'message'    => sprintf( __( 'Invoice payment failed for %1$s (Subscription: %2$s). Reason: %3$s', 'ytism' ), $amount, $invoice->subscription, $error_message ),
				'data'       => wp_json_encode(
					[
						'subscription_id' => $invoice->subscription,
						'payment_intent'  => $invoice->payment_intent,
						'amount_due'      => $invoice->amount_due,
						'currency'        => $invoice->currency,
						'customer_id'     => isset( $invoice->customer ) ? $invoice->customer : null,
					]
				),
				'user_id'    => get_current_user_id(),
				'ip'         => Functions::get_user_ip(),
				'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? $_SERVER['HTTP_USER_AGENT'] : null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.payment_failed> Failed to log invoice.payment_failed event: ' . $log_id->get_error_message() );
		}

		return true;
	}

	private function handle_invoice_paid( $invoice, string $event_id, $previous_attributes = null ) {
		if ( empty( $invoice->id ) || empty( $event_id ) || empty( $invoice->subscription ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.paid> Invoice paid event missing ID, event ID, or subscription ID.' );
			return false;
		}

		$sub_handler = new \YTISM\Database\Subscription_Handler();
		$txn_handler = new \YTISM\Database\Transaction_Handler();
		$log_handler = new \YTISM\Database\Log_Handler();
		$sub_order_handler = new \YTISM\Database\Sub_Order();

		$existing_sub = $sub_handler->get_by_gateway_id( 'stripe', $invoice->subscription );
		if ( ! $existing_sub || empty( $existing_sub->ID ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.paid> No matching subscription found for Subscription ID ' . $invoice->subscription );
			return false;
		}

		if ( $invoice->amount_paid <= 0 ) {
			Functions::log_debug( 'WEBHOOK:<invoice.paid> Invoice amount_paid is zero or negative for Invoice ID ' . $invoice->id . ', skipping transaction creation.' );
			return false;
		}

		$map_type = [
			'automatic_pending_invoice_item_invoice' => 'recurring',
			'manual'                                 => 'one_time',
			'quote_accept'                           => 'one_time',
			'subscription'                           => 'recurring',
			'subscription_create'                    => 'initial',
			'subscription_cycle'                     => 'upgrade',
			'subscription_threshold'                 => 'recurring',
			'subscription_update'                    => 'recurring',
			'upcoming'                               => 'recurring',
		];
		$type     = $map_type[ $invoice->billing_reason ] ?? 'recurring';

		$existing_txn = $txn_handler->get_by_gateway_txn_id( 'stripe', $invoice->id, 'ARRAY_A' );
		$txn_id       = null;
		if ( ! $existing_txn || empty( $existing_txn['ID'] ) ) {
			// create a new transaction record if not found
			$new_tnx_id = $txn_handler->create(
				[
					'sub_id'            => $existing_sub->ID,
					'gateway'           => 'stripe',
					'gateway_txn_id'    => $invoice->id,
					'gateway_intent_id' => $invoice->payment_intent ?? null,
					'status'            => 'succeeded',
					'type'              => $type,
					'amount'            => Functions::format_stripe_amount( $invoice->amount_paid, $invoice->currency ),
					'currency'          => strtoupper( $invoice->currency ),
					'payment_method_id' => $invoice->default_payment_method ?? null,
					'processed_at'      => current_time( 'mysql' ),
					'gateway_data'      => wp_json_encode(
						[
							'subscription_id'  => $invoice->subscription,
							'intent_id'        => $invoice->payment_intent ?? null,
							'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
						]
					),
				]
			);

			if ( is_wp_error( $new_tnx_id ) ) {
				Functions::log_debug( 'WEBHOOK:<invoice.paid> Failed to create transaction for Invoice ID ' . $invoice->id . ': ' . $new_tnx_id->get_error_message() );
				return false;
			}

			$txn_id = $new_tnx_id;

			if ( $existing_sub->last_txn_id != $new_tnx_id ) {
				$sub_handler->update(
					$existing_sub->ID,
					[
						'last_txn_id' => $new_tnx_id,
					]
				);
			}
		} else {
			$existing_txn['gateway_data'] = is_array( $existing_txn['gateway_data'] ) ? $existing_txn['gateway_data'] : json_decode( $existing_txn['gateway_data'], true );

			$needs_update = Functions::array_changes_only_recursive(
				$existing_txn,
				[
					'status'            => 'succeeded',
					'type'              => $type,
					'gateway_intent_id' => $invoice->payment_intent ?? null,
					'amount'            => Functions::format_stripe_amount( $invoice->amount_paid, $invoice->currency ),
					'currency'          => strtoupper( $invoice->currency ),
					'payment_method_id' => $invoice->default_payment_method ?? null,
					'gateway_data'      => wp_json_encode(
						[
							'subscription_id'  => $invoice->subscription,
							'intent_id'        => $invoice->payment_intent ?? null,
							'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
						]
					),
				]
			);

			if ( $needs_update && is_array( $needs_update ) && ! empty( $needs_update ) ) {
				$txn_handler->update(
					$existing_txn['ID'],
					[
						'status'            => 'succeeded',
						'type'              => $type,
						'gateway_intent_id' => $invoice->payment_intent ?? null,
						'amount'            => Functions::format_stripe_amount( $invoice->amount_paid, $invoice->currency ),
						'currency'          => strtoupper( $invoice->currency ),
						'payment_method_id' => $invoice->default_payment_method ?? null,
						'processed_at'      => current_time( 'mysql' ),
						'gateway_data'      => wp_json_encode(
							[
								'subscription_id'  => $invoice->subscription,
								'intent_id'        => $invoice->payment_intent ?? null,
								'invoice_pdf_link' => $invoice->invoice_pdf ?? null,
							]
						),
					]
				);
			}

			$txn_id = $existing_txn['ID'];

			if ( $existing_sub->last_txn_id != $existing_txn['ID'] ) {
				$sub_handler->update(
					$existing_sub->ID,
					[
						'last_txn_id' => $existing_txn['ID'],
					]
				);
			}
		}

		$amount = Functions::format_stripe_price( $invoice->amount_paid, $invoice->currency );
		$log_id = $log_handler->create(
			[
				'ref_type'   => 'transaction',
				'ref_id'     => $txn_id,
				'gateway'    => 'stripe',
				'event_id'   => $event_id,
				'event_code' => 'transaction.invoice_payment_succeeded',
				'severity'   => 'success',
				'message'    => sprintf( __( 'Invoice payment succeeded for %1$s (Subscription: %2$s)', 'ytism' ), $amount, $invoice->subscription ),
				'data'       => wp_json_encode(
					[
						'subscription_id' => $invoice->subscription,
						'payment_intent'  => $invoice->payment_intent,
						'amount_paid'     => $invoice->amount_paid,
						'currency'        => $invoice->currency,
						'customer_id'     => isset( $invoice->customer ) ? $invoice->customer : null,
					]
				),
				'user_id'    => get_current_user_id(),
				'ip'         => Functions::get_user_ip(),
				'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? $_SERVER['HTTP_USER_AGENT'] : null,
			]
		);

		if ( is_wp_error( $log_id ) ) {
			Functions::log_debug( 'WEBHOOK:<invoice.paid> Failed to log invoice.paid event: ' . $log_id->get_error_message() );
		}

		return true;
	}




	/**
	 * Handle failed payment intent with proper error mapping
	 */
	private function handle_payment_intent_failed( $payment_intent ) {
		if ( empty( $payment_intent->id ) ) {
			return false;
		}

		$payment = $this->payments_db->get_by_transaction_id( $payment_intent->id );

		if ( $payment ) {
			$error        = $payment_intent->last_payment_error;
			$error_code   = $error->code ?? null;
			$decline_code = $error->decline_code ?? null;

			$error_message = Stripe_Error_Codes::get_error_message( $error_code, $decline_code );

			// Determine payment type
			$payment_type = $payment->payment_type ?? 'subscription';
			$is_renewal   = ( $payment_type === 'renewal' );

			// Update payment WITHOUT logging
			$this->payments_db->update_status(
				$payment->ID,
				'failed',
				[
					'failure_code'     => $error_code ?? 'unknown',
					'failure_message'  => $error_message,
					'gateway_response' => $payment_intent,
					'metadata'         => json_encode(
						[
							'decline_code'     => $decline_code,
							'error_type'       => $error->type ?? null,
							'error_category'   => Stripe_Error_Codes::get_error_category( $error_code, $decline_code ),
							'original_message' => $error->message ?? null,
						]
					),
					'log_event'        => false,
				]
			);

			// Log appropriate failure event based on payment type
			if ( $is_renewal ) {
				$this->events_db->create(
					[
						'event_type'       => 'payment',
						'subscription_id'  => $payment->subscription_id,
						'payment_id'       => $payment->ID,
						'event_code'       => 'payment.renewal_failed',
						'status'           => 'error',
						'message'          => sprintf(
							__( 'Renewal payment failed: %s', 'ytism' ),
							$error_message
						),
						'old_status'       => 'processing',
						'new_status'       => 'failed',
						'failure_reason'   => $error_message,
						'retry_number'     => $payment->retry_count ?? 0,
						'gateway'          => 'stripe',
						'gateway_event_id' => $payment_intent->id,
					]
				);
			} else {
				$this->events_db->log_payment_failed(
					$payment->ID,
					$payment->subscription_id,
					Functions::format_stripe_price( $payment_intent->amount, $payment_intent->currency ),
					$error_message,
					$payment->retry_count ?? 0,
					'stripe',
					$payment_intent->id
				);
			}

			if ( $payment->subscription_id ) {
				$this->handle_subscription_payment_failure( $payment->subscription_id, $error_message );
			}

			return true;
		}

		$this->handle_orphaned_payment( $payment_intent, 'failed' );
		return false;
	}

	/**
	 * Handle payment processing status
	 */
	private function handle_payment_intent_processing( $payment_intent ) {
		if ( empty( $payment_intent->id ) ) {
			return false;
		}

		$payment = $this->payments_db->get_by_transaction_id( $payment_intent->id );

		if ( $payment ) {
			$this->payments_db->update_status(
				$payment->ID,
				'processing',
				[ 'gateway_response' => $payment_intent ]
			);

			$amount_with_currency = Functions::format_stripe_price( $payment_intent->amount, $payment_intent->currency );

			$this->events_db->create(
				[
					'event_type'       => 'payment',
					'payment_id'       => $payment->ID,
					'subscription_id'  => $payment->subscription_id,
					'event_code'       => 'payment.processing',
					'status'           => 'info',
					'message'          => sprintf( 'Payment of %s is being processed by the bank', $amount_with_currency ),
					'gateway'          => 'stripe',
					'gateway_event_id' => $payment_intent->id,
				]
			);

			return true;
		}

		return false;
	}

	/**
	 * Handle canceled payment
	 */
	private function handle_payment_intent_canceled( $payment_intent ) {
		if ( empty( $payment_intent->id ) ) {
			return false;
		}

		$payment = $this->payments_db->get_by_transaction_id( $payment_intent->id );

		if ( $payment ) {
			$cancellation_reasons = [
				'duplicate'             => 'Duplicate payment detected',
				'fraudulent'            => 'Suspected fraudulent payment',
				'requested_by_customer' => 'Canceled by customer request',
				'abandoned'             => 'Payment abandoned by customer',
				'failed_invoice'        => 'Related invoice payment failed',
				'void_invoice'          => 'Related invoice was voided',
				'automatic'             => 'Automatically canceled by system',
			];

			$reason = $cancellation_reasons[ $payment_intent->cancellation_reason ] ??
					$payment_intent->cancellation_reason ??
					'Payment canceled';

			$amount_with_currency = Functions::format_stripe_price( $payment_intent->amount, $payment_intent->currency );

			$this->payments_db->update_status(
				$payment->ID,
				'canceled',
				[
					'gateway_response' => $payment_intent,
					'failure_message'  => $reason,
				]
			);

			$this->events_db->create(
				[
					'event_type'       => 'payment',
					'payment_id'       => $payment->ID,
					'subscription_id'  => $payment->subscription_id,
					'event_code'       => 'payment.canceled',
					'event_subtype'    => $payment_intent->cancellation_reason,
					'status'           => 'warning',
					'message'          => sprintf( 'Payment of %s was canceled: %s', $amount_with_currency, $reason ),
					'gateway'          => 'stripe',
					'gateway_event_id' => $payment_intent->id,
				]
			);

			return true;
		}

		return false;
	}


	/**
	 * Handle invoice payment action required
	 */
	private function handle_invoice_payment_action_required( $invoice ) {
		if ( empty( $invoice->subscription ) ) {
			return false;
		}

		$subscription = $this->subscriptions_db->get_by_gateway_id( $invoice->subscription );

		if ( $subscription ) {
			// Update subscription status
			$this->subscriptions_db->update_status(
				$subscription->ID,
				'requires_action',
				'Payment requires additional verification'
			);

			// Log event
			$this->events_db->create(
				[
					'event_type'       => 'subscription',
					'subscription_id'  => $subscription->ID,
					'event_code'       => 'subscription.payment_action_required',
					'status'           => 'warning',
					'message'          => sprintf( 'Subscription payment requires customer action for %s', Functions::format_stripe_price( $invoice->amount_due, $invoice->currency ) ),
					'gateway'          => 'stripe',
					'gateway_event_id' => $invoice->id,
				]
			);

			return true;
		}

		return false;
	}




	/**
	 * Handle subscription trial ending soon
	 */


	/**
	 * Handle orphaned payments
	 */
	private function handle_orphaned_payment( $payment_intent, $status ) {
		// Create payment record for tracking
		$payment_id = $this->payments_db->create(
			[
				'subscription_id'  => 0,
				'status'           => $status,
				'amount'           => Functions::format_stripe_amount( $payment_intent->amount, $payment_intent->currency ),
				'currency'         => $payment_intent->currency,
				'transaction_id'   => $payment_intent->id,
				'charge_id'        => $payment_intent->id,
				'payment_type'     => 'orphaned',
				'processed_at'     => current_time( 'mysql' ),
				'gateway_response' => json_encode( $payment_intent ),
				'metadata'         => json_encode(
					[
						'customer'       => $payment_intent->customer,
						'payment_method' => $payment_intent->payment_method,
						'metadata'       => $payment_intent->metadata,
					]
				),
			]
		);

		// Log orphaned payment
		$this->events_db->create(
			[
				'event_type'       => 'system',
				'payment_id'       => is_wp_error( $payment_id ) ? null : $payment_id,
				'event_code'       => 'payment.orphaned',
				'status'           => 'warning',
				'message'          => sprintf(
					__( 'Orphaned %1$s payment detected for %2$s', 'ytism' ),
					$status,
					Functions::format_stripe_price( $payment_intent->amount, $payment_intent->currency )
				),
				'gateway'          => 'stripe',
				'gateway_event_id' => $payment_intent->id,
			]
		);
	}

	/**
	 * Handle subscription payment failure
	 */
	private function handle_subscription_payment_failure( $subscription_id, $error_message ) {
		$subscription = $this->subscriptions_db->get( $subscription_id );
		if ( ! $subscription ) {
			return;
		}

		// Increment failed payment count
		$this->subscriptions_db->increment_failed_payments( $subscription_id );

		// Determine new status based on failure count
		$failed_count = $subscription->failed_payment_count + 1;

		if ( $failed_count >= 4 ) {
			// Cancel subscription after 4 failures
			$this->subscriptions_db->update_status(
				$subscription_id,
				'canceled',
				__( 'Subscription canceled due to multiple payment failures', 'ytism' )
			);
		} elseif ( $failed_count >= 2 ) {
			// Mark as unpaid after 2 failures
			$this->subscriptions_db->update_status(
				$subscription_id,
				'past_due',
				sprintf( __( 'Subscription past due - %s', 'ytism', $error_message ) )
			);
		}
	}

	private function handle_product_update_create( $product ) {
		if ( empty( $product->id ) ) {
			return false;
		}

		$product_manager = Stripe_Product_Manager::instance();
		$product_manager->maybe_refresh_product( $product->id );

		return true;
	}

	private function handle_product_deleted( $product ) {
		if ( empty( $product->id ) ) {
			return false;
		}

		$product_manager = Stripe_Product_Manager::instance();
		$product_manager->maybe_delete_product( $product->id );

		return true;
	}

	private function handle_price_plan_curd( $object ) {
		if ( empty( $object->product ) ) {
			return false;
		}

		$product_manager = Stripe_Product_Manager::instance();
		$product_manager->maybe_refresh_product( $object->product );

		return true;
	}
}
