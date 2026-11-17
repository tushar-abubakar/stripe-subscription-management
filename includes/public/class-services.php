<?php
/**
 * Services class
 *
 * @package YTISM
 * @subpackage Includes/Public
 * @since 1.0.0
 */

namespace YTISM\Public;

use YTISM\Core\Template;
use YTISM\Core\Product;
use YTISM\Core\AliasUser;
use YTISM\Core\Webhook_Handler;
use YTISM\Core\Api;
use YTISM\Helpers\Functions;
use YTISM\Helpers\Stripe_Error_Codes;
use YTISM\Core\Sub_Order as Sub_Order_Object;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Services Class
 */
class Services {
	/**
	 * Settings
	 *
	 * @var array
	 */
	private $settings = [];

	/**
	 * Stripe client
	 *
	 * @var \Stripe\StripeClient|null
	 */
	private $stripe;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->settings = Functions::get_settings();

		$stripe_secret_key = $this->settings['stripe_secret_key'] ?? '';
		if ( ! empty( $stripe_secret_key ) ) {
			$this->stripe = new \Stripe\StripeClient( $stripe_secret_key );
		} else {
			$this->stripe = null;
		}
	}

	/**
	 * Initialize public hooks
	 */
	public function init() {
		add_action( 'rest_api_init', [ $this, 'register_webhook_endpoint' ] );
		add_action( 'init', [ $this, 'on_initialize' ] );
		add_action( 'init', [ $this, 'handle_stripe_response' ] );
		add_action( 'wp_head', [ $this, 'add_inline_style' ] );
		add_filter( 'body_class', [ $this, 'add_body_class' ] );
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_assets' ] );

		// Shortcodes.
		add_shortcode( 'ytism_redeem_promo_code', [ $this, 'shortcode_redeem_promo_code' ] );
		add_shortcode( 'ytism_individual_plans_form', [ $this, 'shortcode_individual_plans_form' ] );
		add_shortcode( 'ytism_individual_plan', [ $this, 'shortcode_individual_plan' ] );
		add_shortcode( 'ytism_family_plan', [ $this, 'shortcode_family_plan' ] );
		add_shortcode( 'ytism_enterprise_plan', [ $this, 'shortcode_enterprise_plan' ] );
		add_shortcode( 'ytism_order_summary', [ $this, 'shortcode_order_summary' ] );
		add_shortcode( 'ytism_my_account', [ $this, 'shortcode_my_account' ] );
		add_shortcode( 'ytism_add_super_manager', [ $this, 'shortcode_add_super_manager' ] );
		add_shortcode( 'ytism_welcome_box', [ $this, 'shortcode_welcome_box' ] );
		add_shortcode( 'ytism_checkout', [ $this, 'shortcode_checkout' ] );
		add_shortcode( 'ytism_thank_you', [ $this, 'shortcode_thank_you' ] );
		add_shortcode( 'ytism_questions', [ $this, 'shortcode_questions' ] );
		add_shortcode( 'ytism_page_link', [ $this, 'shortcode_page_link' ] );

		// Hooks to maintain.
		add_action( 'ytism_subscription_trialing', [ $this, 'on_subscription_activate_action' ], 10, 3 );
		add_action( 'ytism_subscription_active', [ $this, 'on_subscription_activate_action' ], 10, 3 );

		// Ajax handlers.
		add_action( 'wp_ajax_ytism_create_subscription', [ $this, 'ajax_create_subscription' ] );
		add_action( 'wp_ajax_nopriv_ytism_create_subscription', [ $this, 'ajax_create_subscription' ] );
	}

	/**
	 * Enqueue public assets (CSS/JS).
	 *
	 * @return void
	 */
	public function enqueue_assets(): void {
		// Register styles.
		wp_register_style( 'ytism-select2-style', YTISM_PLUGIN_URL . 'assets/css/select2.min.css', [], '1.0.0' );
		wp_register_style( 'ytism-intlTelInput-style', YTISM_PLUGIN_URL . 'assets/css/intlTelInput.min.css', [], '1.0.0' );

		// Enqueue styles.
		wp_enqueue_style( 'ytism-select2-style' );
		wp_enqueue_style( 'ytism-intlTelInput-style' );
		wp_enqueue_style( 'ytism-public-style', YTISM_PLUGIN_URL . 'assets/css/public.css', [], '3.33.89' );

		// Inline styles.
		$custom_css       = '.family-plan > .ytism-welcome-box { max-width: 52rem; }';
		$thankyou_page_id = $this->settings['thankyou_page_id'];
		if ( ! empty( $thankyou_page_id ) ) {
			$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

			if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
				$translated_id = apply_filters( 'wpml_object_id', $thankyou_page_id, 'page', true, $current_lang );
				if ( $translated_id ) {
					$thankyou_page_id = $translated_id;
				}
			}

			$page = get_post( $thankyou_page_id );
			if ( $page && ! empty( $page->post_name ) ) {
				$current_slug = $page->post_name;
				$custom_css  .= ".ytism-welcome-box.name-{$current_slug} { max-width: 52rem; }
				";
			}
		}
		if ( ! empty( $custom_css ) ) {
			wp_add_inline_style( 'ytism-public-style', $custom_css );
		}

		// Register custom scripts.
		wp_register_script( 'ytism-intlTelInput-script', YTISM_PLUGIN_URL . 'assets/js/intlTelInputWithUtils.min.js', [ 'jquery' ], '1.0.0', true );
		wp_register_script( 'ytism-select2-script', YTISM_PLUGIN_URL . 'assets/js/select2.full.min.js', [ 'jquery' ], '1.0.0', true );
		wp_register_script( 'ytism-jqueryvalidate-script', YTISM_PLUGIN_URL . 'assets/js/jquery.validate.min.js', [ 'jquery' ], '1.0.0', true );

		// phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- Stripe v3 CDN script is versionless by design.
		wp_register_script( 'ytism-stripe-v3-script', 'https://js.stripe.com/v3/', [], null, true );

		// Enqueue scripts.
		if ( ! wp_script_is( 'jquery', 'enqueued' ) ) {
			wp_enqueue_script( 'jquery' );
		}
		if ( ! wp_script_is( 'wp-i18n', 'enqueued' ) ) {
			wp_enqueue_script( 'wp-i18n' );
		}
		if ( ! wp_script_is( 'zxcvbn-async', 'enqueued' ) && ! is_user_logged_in() ) {
			wp_enqueue_script( 'zxcvbn-async' );
		}
		if ( ! wp_script_is( 'password-strength-meter', 'enqueued' ) && ! is_user_logged_in() ) {
			wp_enqueue_script( 'password-strength-meter' );
		}

		wp_enqueue_script( 'ytism-intlTelInput-script' );
		wp_enqueue_script( 'ytism-select2-script' );
		wp_enqueue_script( 'ytism-jqueryvalidate-script' );

		if ( ! empty( $this->settings['stripe_secret_key'] ) && ! empty( $this->settings['stripe_publishable_key'] ) && is_user_logged_in() ) {
			wp_enqueue_script( 'ytism-stripe-v3-script' );
		}

		// phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- Local version managed via build/deployment.
		wp_register_script( 'ytism-public-script', YTISM_PLUGIN_URL . 'assets/js/public.js', [ 'jquery', 'wp-i18n', 'ytism-jqueryvalidate-script' ], '3.33.88', true );

		wp_set_script_translations( 'ytism-public-script', 'ytism', YTISM_PLUGIN_DIR . '/languages' );

		wp_enqueue_script( 'ytism-public-script' );

		$user_country     = Functions::get_user_country( 'US' );
		$checkout_url     = Functions::get_checkout_page_url();
		$checkout_page_id = url_to_postid( $checkout_url );
		$current_locale   = apply_filters( 'wpml_current_locale', get_locale() );

		wp_localize_script(
			'ytism-public-script',
			'YTISM_PUBLIC',
			[
				'site_url'                  => site_url(),
				'ajax_url'                  => admin_url( 'admin-ajax.php' ),
				'is_logged_in'              => is_user_logged_in(),
				'locale'                    => str_replace( '_', '-', $current_locale ),
				'user_country'              => $user_country ?? 'US',
				'is_auth_page'              => (bool) get_query_var( 'ytism_alias_auth', false ),
				'is_checkout_page'          => ! empty( $checkout_page_id ) ? is_page( $checkout_page_id ) : false,
				'stripe_public_key'         => $this->settings['stripe_publishable_key'] ?? '',
				'order_summary_link'        => Functions::get_ordersummary_page_url(),
				'auth_load_form_nonce'      => wp_create_nonce( 'auth_load_from' ),
				'redeem_code_nonce'         => wp_create_nonce( 'redeem_code_nonce' ),
				'price_calculation_nonce'   => wp_create_nonce( 'stripe_price_calculation_nonce' ),
				'create_subscription_nonce' => wp_create_nonce( 'ytism_create_subscription_nonce' ),
				'cancel_subscription_nonce' => wp_create_nonce( 'ytism_cancel_subscription_nonce' ),
				'download_invoice_nonce'    => wp_create_nonce( 'ytism_download_invoice_nonce' ),
			]
		);
	}

	/**
	 * Register REST API endpoint for Stripe webhooks
	 */
	public function register_webhook_endpoint() {
		register_rest_route(
			'ytism/v1',
			'/stripe-webhook',
			[
				'methods'             => 'POST',
				'callback'            => [ $this, 'handle_stripe_webhook' ],
				'permission_callback' => '__return_true',
			]
		);
	}

	/**
	 * Handle Stripe webhook requests
	 *
	 * @param \WP_REST_Request $request The REST request object.
	 * @return \WP_REST_Response
	 */
	public function handle_stripe_webhook( \WP_REST_Request $request ) {
		/*
		$webhook_handler = new Webhook_Handler();
		return $webhook_handler->handle_webhook( $request );
		*/
		return false;
	}

	/**
	 * Add My Account sub pags
	 */
	public function on_initialize() {
		// My Account routes (all translations).
		$myaccount_page_id = intval( $this->settings['myaccount_page_id'] ?? 0 );

		if ( $myaccount_page_id <= 0 ) {
			return;
		}

		$page_ids = [ $myaccount_page_id ];
		// WPML support: get all translations of the myaccount page.
		if ( function_exists( 'wpml_object_id' ) ) {
			$languages = apply_filters( 'wpml_active_languages', null, [ 'skip_missing' => 0 ] );
			if ( ! empty( $languages ) && is_array( $languages ) ) {
				foreach ( $languages as $lang ) {
					$translated_id = apply_filters( 'wpml_object_id', $myaccount_page_id, 'page', false, $lang['code'] );
					if ( $translated_id && $translated_id !== $myaccount_page_id ) {
						$page_ids[] = (int) $translated_id;
					}
				}
				$page_ids = array_unique( $page_ids );
			}
		}

		$slugs = [];
		if ( ! empty( $page_ids ) ) {
			$pages = get_posts(
				[
					'post_type'   => 'page',
					'post_status' => 'publish',
					'post__in'    => $page_ids,
					'numberposts' => -1,
				]
			);
			foreach ( $pages as $page ) {
				if ( $page instanceof \WP_Post && 'page' === $page->post_type && 'publish' === $page->post_status && ! empty( $page->post_name ) ) {
					$slugs[ $page->ID ] = $page->post_name;
				}
			}
		}

		foreach ( $slugs as $page_id => $slug ) {
			add_rewrite_rule( "^{$slug}/?$", 'index.php?page_id=' . $page_id . '&ytism_myaccount_pages=dashboard', 'top' );
			add_rewrite_rule( "^{$slug}/profile/?$", 'index.php?page_id=' . $page_id . '&ytism_myaccount_pages=profile', 'top' );
			add_rewrite_rule( "^{$slug}/transactions/?$", 'index.php?page_id=' . $page_id . '&ytism_myaccount_pages=transactions', 'top' );
			add_rewrite_rule( "^{$slug}/subscriptions/?$", 'index.php?page_id=' . $page_id . '&ytism_myaccount_pages=subscriptions', 'top' );
			add_rewrite_rule( "^{$slug}/super-manager/?$", 'index.php?page_id=' . $page_id . '&ytism_myaccount_pages=super_manager', 'top' );
		}

		// Register query var.
		add_rewrite_tag( '%ytism_myaccount_pages%', '([^&]+)' );

		// Flush rules if not done yet.
		$is_flushed = get_option( 'ytism_flush_rewrite_rules', false );
		if ( ! $is_flushed ) {
			flush_rewrite_rules();
			update_option( 'ytism_flush_rewrite_rules', true );
		}
	}

	/**
	 * Handle Stripe responses (like return_url after 3D Secure)
	 */
	public function handle_stripe_response() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Handled via Stripe's own security mechanisms.
		if ( ! isset( $_GET['ytism_stripe_action'] ) || empty( $_GET['ytism_stripe_action'] ) ) {
			return;
		}

		// phpcs:disable WordPress.Security.NonceVerification -- Handled via Stripe's own security mechanisms.
		$sub_order_id      = isset( $_GET['sub_order_id'] ) ? intval( $_GET['sub_order_id'] ) : 0;
		$plan              = isset( $_GET['plan'] ) ? sanitize_text_field( wp_unslash( $_GET['plan'] ) ) : '';
		$payment_intent_id = isset( $_GET['payment_intent'] ) ? sanitize_text_field( wp_unslash( $_GET['payment_intent'] ) ) : '';
		$setup_intent_id   = isset( $_GET['setup_intent'] ) ? sanitize_text_field( wp_unslash( $_GET['setup_intent'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification

		if ( ! $this->stripe || empty( $sub_order_id ) || ( empty( $payment_intent_id ) && empty( $setup_intent_id ) ) ) {
			return;
		}

		$ordersummary_page_url = Functions::get_ordersummary_page_url();

		$sub_order_handler  = new \YTISM\Database\Sub_Order();
		$existing_sub_order = $sub_order_handler->get( $sub_order_id );

		if ( ! $existing_sub_order || null === $existing_sub_order || ! ( $existing_sub_order instanceof \YTISM\Core\Sub_Order ) ) {
			return;
		}

		if ( ! empty( $setup_intent_id ) ) {
			// Handle setup intent (for trials).
			try {
				$setup_intent = $this->stripe->setupIntents->retrieve( $setup_intent_id, [] );

				if ( empty( $setup_intent ) || empty( $setup_intent->id ) || empty( $setup_intent->status ) ) {
					Functions::log_debug( 'Invalid or missing SetupIntent data.' );
					return;
				}

				if ( empty( $setup_intent->metadata ) || empty( $setup_intent->metadata->sub_order_id ) || (int) $setup_intent->metadata->sub_order_id !== (int) $existing_sub_order->ID ) {
					Functions::log_debug( 'Missing order ID in SetupIntent metadata.' );
					return;
				}

				// Try to get Payment Method details (common for all statuses).
				$payment_method_details = null;
				if ( ! empty( $setup_intent->payment_method ) ) {
					try {
						$payment_method = $this->stripe->paymentMethods->retrieve( $setup_intent->payment_method, [] );
						if ( $payment_method && ! empty( $payment_method->id ) ) {
							$payment_method_details = Functions::format_payment_method_details( $payment_method );
						}
					} catch ( \Exception $e ) {
						Functions::log_debug( 'Could not retrieve payment method details: ' . $e->getMessage() );
					}
				}

				$txn_status = 'pending';
				$sub_status = 'incomplete';

				$status         = $setup_intent->status;
				$system_message = sprintf( 'Setup Intent status: %s', $status );
				$redirect_args  = [
					'sub_order_id' => $existing_sub_order->ID,
				];

				switch ( $status ) {
					case 'requires_payment_method':
						$system_message = __( 'Setup Intent requires a valid payment method.', 'ytism' );

						if ( ! empty( $setup_intent->last_payment_error ) ) {
							$error            = $setup_intent->last_payment_error;
							$stripe_error_msg = Stripe_Error_Codes::get_error_message( $error );
							$system_message   = $stripe_error_msg['system_message'] ?? $error->message ?? $system_message;
						}

						$txn_status              = 'failed';
						$sub_status              = 'incomplete';
						$redirect_args['status'] = 'error';
						break;

					case 'requires_confirmation':
						$system_message = 'Setup Intent requires confirmation.';

						$txn_status              = 'pending';
						$sub_status              = 'incomplete';
						$redirect_args['status'] = 'pending';
						break;

					case 'requires_action':
						$system_message = 'Setup Intent requires additional action.';

						$txn_status              = 'pending';
						$sub_status              = 'incomplete';
						$redirect_args['status'] = 'requires_action';
						break;

					case 'processing':
						$system_message = 'Setup Intent is processing.';

						$txn_status              = 'processing';
						$sub_status              = 'incomplete';
						$redirect_args['status'] = 'processing';
						break;

					case 'canceled':
						$reason = ! empty( $setup_intent->cancellation_reason )
							? sprintf(
								/* translators: %s is the cancellation reason. */
								__( ' Reason: %s', 'ytism' ),
								str_replace( '_', ' ', $setup_intent->cancellation_reason )
							)
							: '';
						$system_message = sprintf( 'Setup intent was canceled.%s', $reason );

						$txn_status              = 'canceled';
						$sub_status              = 'canceled';
						$redirect_args['status'] = 'canceled';
						break;

					case 'succeeded':
						$system_message = 'Setup Intent succeeded.';

						$txn_status              = 'completed';
						$sub_status              = 'trialing';
						$redirect_args['status'] = 'success';
						break;

					default:
						$system_message = 'Unknown SetupIntent status.';

						$txn_status              = 'failed';
						$sub_status              = 'incomplete';
						$redirect_args['status'] = 'error';
						break;
				}

				$saverity = ( 'completed' === $txn_status ) ? 'info' : ( ( 'failed' === $txn_status || 'canceled' === $txn_status ) ? 'error' : 'warning' );
				$message  = 'Setup Intent ' . $status . '. ' . $system_message;

				// Update transactions.
				$update_txn_result = $sub_order_handler->update_transaction(
					$existing_sub_order->ID,
					[
						'last_txn_id'         => $setup_intent->id,
						'last_txn_status'     => $txn_status,
						'last_payment_method' => is_array( $payment_method_details ) ? $payment_method_details : [],
					]
				)->add_log(
					[
						'event_uid'  => $setup_intent->created ?? time(),
						'ref_type'   => 'setup_intent',
						'ref_status' => 'setup_intent.' . $txn_status,
						'severity'   => $saverity,
						'message'    => $message,
					]
				);

				if ( ! $update_txn_result || is_wp_error( $update_txn_result ) ) {
					Functions::log_debug( 'Failed to update transaction record after SetupIntent: ' . ( is_wp_error( $update_txn_result ) ? $update_txn_result->get_error_message() : 'Unknown error' ) );
					return;
				}

				// Update Subscription.
				$saverity = ( 'active' === $sub_status || 'trialing' === $sub_status ) ? 'info' : ( ( 'canceled' === $sub_status || 'expired' === $sub_status ) ? 'error' : 'warning' );

				$update_sub_result = $sub_order_handler->update_subscription(
					$existing_sub_order->ID,
					[
						'sub_status'   => $sub_status,
						'activated_at' => ( 'active' === $sub_status ) ? current_time( 'mysql' ) : null,
					]
				)->add_log(
					[
						'event_uid'  => time(),
						'ref_type'   => 'subscription',
						'ref_status' => 'subscription.' . $sub_status,
						'severity'   => $saverity,
						'message'    => 'Subscription status updated to ' . $sub_status . '.',
					]
				);

				if ( ! $update_sub_result || is_wp_error( $update_sub_result ) ) {
					Functions::log_debug( 'Failed to update subscription record after SetupIntent: ' . ( is_wp_error( $update_sub_result ) ? $update_sub_result->get_error_message() : 'Unknown error' ) );
					return;
				}

				// Trigger action for other plugins/themes to hook into.
				do_action(
					"ytism_subscription_{$sub_status}",
					$existing_sub_order->ID,
					$existing_sub_order->user_id,
					[
						'sub_data'             => $existing_sub_order,
						'subscription_id'      => $existing_sub_order->sub_id,
						'customer_id'          => $existing_sub_order->customer_id ?? null,
						'current_period_start' => $existing_sub_order->period_start ?? null,
						'current_period_end'   => $existing_sub_order->period_end,
						'trial_start'          => $existing_sub_order->trial_start_at,
						'trial_end'            => $existing_sub_order->trial_end_at,
					]
				);

				// Redirect to Order Summary.
				wp_safe_redirect( add_query_arg( $redirect_args, $ordersummary_page_url ) );
				exit;
			} catch ( \Exception $e ) {
				Functions::log_debug( 'Stripe Setup Intent retrieval error: ' . $e->getMessage() );
				wp_safe_redirect( add_query_arg( [ 'status' => 'error' ], $ordersummary_page_url ) );
				exit;
			}
		} elseif ( ! empty( $payment_intent_id ) ) {
			// Handle payment intent (for immediate payments).
			try {
				$payment_intent = $this->stripe->paymentIntents->retrieve( $payment_intent_id, [] );

				if ( ! $payment_intent || empty( $payment_intent->id ) || empty( $payment_intent->status ) ) {
					return;
				}

				if ( empty( $payment_intent->metadata ) || empty( $payment_intent->metadata->sub_order_id ) || (int) $payment_intent->metadata->sub_order_id !== (int) $existing_sub_order->ID ) {
					Functions::log_debug( 'Missing order ID in PaymentIntent metadata.' );
					return;
				}

				// Retrieve related payment method once.
				$payment_method_details = null;
				if ( ! empty( $payment_intent->payment_method ) ) {
					try {
						$payment_method = $this->stripe->paymentMethods->retrieve( $payment_intent->payment_method, [] );
						if ( $payment_method && $payment_method->id === $payment_intent->payment_method ) {
							$payment_method_details = Functions::format_payment_method_details( $payment_method );
						}
					} catch ( \Exception $e ) {
						Functions::log_debug( 'Failed to retrieve payment method: ' . $e->getMessage() );
					}
				}

				$txn_status = 'pending';
				$sub_status = 'incomplete';
				$redirect_status = 'error';
				// Default messages.
				$system_message = sprintf( 'Payment Intent status: %s', $payment_intent->status );

				switch ( $payment_intent->status ) {
					case 'requires_payment_method':
						$system_message = 'Payment Intent requires a valid payment method.';

						if ( ! empty( $payment_intent->last_payment_error ) ) {
							$error            = $payment_intent->last_payment_error;
							$stripe_error_msg = Stripe_Error_Codes::get_error_message( $error );
							$system_message   = $stripe_error_msg['system_message'] ?? $error->message ?? $system_message;
						}

						$txn_status      = 'failed';
						$sub_status      = 'incomplete';
						$redirect_status = 'error';
						break;

					case 'requires_confirmation':
						$system_message  = 'Requires confirmation from Stripe.';
						$txn_status      = 'pending';
						$sub_status      = 'incomplete';
						$redirect_status = 'pending';
						break;

					case 'requires_action':
						$system_message  = 'Requires customer action (3DS).';
						$txn_status      = 'pending';
						$sub_status      = 'incomplete';
						$redirect_status = 'requires_action';
						break;

					case 'processing':
						$system_message  = 'Payment intent is processing.';
						$txn_status      = 'processing';
						$sub_status      = 'incomplete';
						$redirect_status = 'processing';
						break;

					case 'requires_capture':
						$system_message  = 'Payment intent requires capture.';
						$txn_status      = 'pending';
						$sub_status      = 'incomplete';
						$redirect_status = 'pending';
						break;

					case 'canceled':
						$reason          = ! empty( $payment_intent->cancellation_reason )
							? ' (' . str_replace( '_', ' ', $payment_intent->cancellation_reason ) . ')'
							: '';
						$system_message  = sprintf( 'Payment intent canceled. %s', $reason );
						$txn_status      = 'canceled';
						$sub_status      = 'canceled';
						$redirect_status = 'canceled';
						break;

					case 'succeeded':
						$system_message  = 'Payment intent succeeded.';
						$txn_status      = 'completed';
						$sub_status      = 'active';
						$redirect_status = 'success';
						break;

					default:
						$system_message  = sprintf(
							'Unexpected payment intent status: %s',
							$payment_intent->status
						);
						$txn_status      = 'failed';
						$sub_status      = 'incomplete';
						$redirect_status = 'error';
						break;
				}

				$saverity = ( 'completed' === $txn_status ) ? 'info' : ( ( 'failed' === $txn_status || 'canceled' === $txn_status ) ? 'error' : 'warning' );
				$message  = 'Payment Intent ' . $payment_intent->status . '. ' . $system_message;

				// Update transactions.
				$update_txn_result = $sub_order_handler->update_transaction(
					$existing_sub_order->ID,
					[
						'last_txn_id'         => $payment_intent->id,
						'last_txn_status'     => $txn_status,
						'last_payment_method' => is_array( $payment_method_details ) ? $payment_method_details : [],
					]
				)->add_log(
					[
						'event_uid'  => $payment_intent->created ?? time(),
						'ref_type'   => 'payment_intent',
						'ref_status' => 'payment_intent.' . $txn_status,
						'severity'   => $saverity,
						'message'    => $message,
					]
				);

				if ( ! $update_txn_result || is_wp_error( $update_txn_result ) ) {
					Functions::log_debug( 'Failed to update transaction record: ' . ( is_wp_error( $update_txn_result ) ? $update_txn_result->get_error_message() : 'Unknown error' ) );
					return;
				}

				// Update Subscription.
				$saverity = ( 'active' === $sub_status || 'trialing' === $sub_status ) ? 'info' : ( ( 'canceled' === $sub_status || 'expired' === $sub_status ) ? 'error' : 'warning' );

				$update_sub_result = $sub_order_handler->update_subscription(
					$existing_sub_order->ID,
					[
						'sub_status'   => $sub_status,
						'activated_at' => ( 'active' === $sub_status ) ? current_time( 'mysql' ) : null,
					]
				)->add_log(
					[
						'event_uid'  => time(),
						'ref_type'   => 'subscription',
						'ref_status' => 'subscription.' . $sub_status,
						'severity'   => $saverity,
						'message'    => 'Subscription status updated to ' . $sub_status . '.',
					]
				);

				if ( ! $update_sub_result || is_wp_error( $update_sub_result ) ) {
					Functions::log_debug( 'Failed to update subscription record: ' . ( is_wp_error( $update_sub_result ) ? $update_sub_result->get_error_message() : 'Unknown error' ) );
					return;
				}

				// Trigger action for other plugins/themes to hook into.
				do_action(
					"ytism_subscription_{$sub_status}",
					$existing_sub_order->ID,
					$existing_sub_order->user_id,
					[
						'sub_data'             => $existing_sub_order,
						'subscription_id'      => $existing_sub_order->sub_id,
						'customer_id'          => $existing_sub_order->customer_id ?? null,
						'current_period_start' => $existing_sub_order->period_start ?? null,
						'current_period_end'   => $existing_sub_order->period_end,
						'trial_start'          => $existing_sub_order->trial_start_at,
						'trial_end'            => $existing_sub_order->trial_end_at,
					]
				);

				// Redirect to order summary.
				wp_safe_redirect(
					add_query_arg(
						[
							'sub_order_id' => $sub_order_id,
							'status'       => $redirect_status,
						],
						$ordersummary_page_url
					)
				);
				exit;
			} catch ( \Exception $e ) {
				Functions::log_debug( 'Stripe Payment Intent retrieval error: ' . $e->getMessage() );
				wp_safe_redirect( add_query_arg( [ 'status' => 'error' ], $ordersummary_page_url ) );
				exit;
			}
		}
	}

	/**
	 * Add Inline CSS
	 */
	public function add_inline_style() {
		// Get pages.
		$original_page_ids = [
			$this->settings['individual']['page_id'],
			$this->settings['family']['page_id'],
			$this->settings['enterprise']['page_id'],
			$this->settings['myaccount_page_id'],
			$this->settings['checkout_page_id'],
			$this->settings['thankyou_page_id'],
			$this->settings['ordersummary_page_id'],
			6843, // Family redeem page id.
		];

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		// Remove empty values.
		$original_page_ids = array_filter( $original_page_ids );

		// Get translated IDs.
		$translated_page_ids = [];
		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			foreach ( $original_page_ids as $page_id ) {
				$translated_id = apply_filters( 'wpml_object_id', $page_id, 'page', true, $current_lang );
				if ( $translated_id ) {
					$translated_page_ids[] = $translated_id;
				}
			}
		}

		$all_page_ids    = array_unique( array_merge( $original_page_ids, $translated_page_ids ) );
		$current_page_id = get_the_ID();

		if ( in_array( $current_page_id, $all_page_ids, true ) && ! wp_is_mobile() ) {
			?>
			<style>
				html {
					font-size: 85%;
				}
			</style>
			<?php
		}
	}

	/**
	 * Add custom classes to the body tag
	 *
	 * @param array $classes Existing body classes.
	 * @return array Modified body classes.
	 */
	public function add_body_class( $classes ): array {
		global $post;

		if ( ! isset( $post->ID ) ) {
			return $classes;
		}

		if ( is_page() ) {
			if ( isset( $post->post_name ) ) {
				$classes[] = 'page-' . sanitize_html_class( $post->post_name );
			}
		}

		$ordersummary_page_id = intval( $this->settings['ordersummary_page_id'] ?? 0 );
		$myaccount_page_id    = intval( $this->settings['myaccount_page_id'] ?? 0 );

		$ytism_shortcodes = [
			'ytism_individual_plan',
			'ytism_family_plan',
			'ytism_enterprise_plan',
			'ytism_order_summary',
			'ytism_myaccount',
		];

		$add_class = false;

		if ( $post->ID === $ordersummary_page_id || $post->ID === $myaccount_page_id ) {
			$add_class = true;
		} else {
			foreach ( $ytism_shortcodes as $shortcode ) {
				if ( has_shortcode( $post->post_content, $shortcode ) ) {
					$add_class = true;
					break;
				}
			}
		}

		if ( $add_class ) {
			$classes[] = 'ytism-page';
		}

		return $classes;
	}

	/**
	 * Retrieve SetupIntent or PaymentIntent from client secret
	 *
	 * @param string $client_secret The client secret from Stripe.
	 * @return \Stripe\SetupIntent|\Stripe\PaymentIntent|\WP_Error The retrieved intent or WP_Error on failure.
	 */
	private function get_intent_from_client_secret( string $client_secret ) {
		$intent_id = explode( '_secret', $client_secret )[0];
		if ( ! $intent_id ) {
			return new \WP_Error( 'invalid_client_secret', __( 'Invalid client secret provided.', 'ytism' ) );
		}

		try {
			if ( substr( $intent_id, 0, 5 ) === 'seti_' ) {
				return $this->stripe->setupIntents->retrieve( $intent_id );
			} elseif ( substr( $intent_id, 0, 3 ) === 'pi_' ) {
				return $this->stripe->paymentIntents->retrieve( $intent_id );
			} else {
				return new \WP_Error( 'invalid_client_secret', __( 'Invalid client secret provided.', 'ytism' ) );
			}
		} catch ( \Stripe\Exception\ApiErrorException $e ) {
			Functions::log_debug( 'Stripe API Error in get_intent_from_client_secret: ' . $e->getMessage() );
			return new \WP_Error( 'stripe_api_error', __( 'Failed to retrieve setup intent.', 'ytism' ) );
		} catch ( \Exception $e ) {
			Functions::log_debug( 'General Error in get_intent_from_client_secret: ' . $e->getMessage() );
			return new \WP_Error( 'general_error', __( 'An unexpected error occurred while retrieving setup intent.', 'ytism' ) );
		}
	}

	/**
	 * Create ajax subscription
	 */
	public function ajax_create_subscription() {
		// Check nonce.
		check_ajax_referer( 'ytism_create_subscription_nonce', 'nonce' );

		// phpcs:disabled WordPress.Security.NonceVerification -- Nonce verified above.
		$plan     = isset( $_POST['plan'] ) ? sanitize_text_field( wp_unslash( $_POST['plan'] ) ) : '';
		$price_id = isset( $_POST['price_id'] ) ? sanitize_text_field( wp_unslash( $_POST['price_id'] ) ) : '';
		$quantity = isset( $_POST['quantity'] ) ? intval( wp_unslash( $_POST['quantity'] ) ) : 1;
		$currency = isset( $_POST['currency'] ) ? sanitize_text_field( wp_unslash( $_POST['currency'] ) ) : 'usd';
		// phpcs:enabled WordPress.Security.NonceVerification

		$result = $this->create_subscription( $plan, $price_id, $quantity, $currency );

		if ( is_array( $result ) && isset( $result['success'] ) ) {
			wp_send_json(
				[
					'success' => (bool) $result['success'],
					'data'    => array_diff_key( $result, [ 'success' => '' ] ),
				]
			);
		} else {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'An unexpected error occurred while creating the subscription.', 'ytism' ),
				]
			);
		}
		wp_die();
	}

	/**
	 * Create subscription
	 *
	 * @param string $plan The subscription plan (individual, family, enterprise).
	 * @param string $price_id The Stripe price ID.
	 * @param int    $quantity The number of users/licenses.
	 * @param string $currency The currency code (e.g., USD).
	 * @return array Result of the subscription creation process.
	 */
	public function create_subscription( string $plan, string $price_id, int $quantity, string $currency ): array {
		if ( ! is_user_logged_in() ) {
			return [
				'success'    => false,
				'error_type' => 'auth',
				'message'    => __( 'You must be logged in to subscribe.', 'ytism' ),
			];
		}

		$valid_plans = [ 'individual', 'family', 'enterprise' ];
		if ( ! $price_id || $quantity < 1 || ! $currency || ! in_array( $plan, $valid_plans, true ) ) {
			return [
				'success'    => false,
				'error_type' => 'invalid_parameters',
				'message'    => __( 'Missing or invalid subscription parameters. Please select a valid plan, quantity, and currency before proceeding.', 'ytism' ),
			];
		}

		if ( ! $this->stripe ) {
			return [
				'success'    => false,
				'error_type' => 'system',
				'message'    => __( 'Payment system not configured. Please contact support.', 'ytism' ),
			];
		}

		$plan_rules    = [
			'individual' => fn( $q ) => 1 === $q,
			'family'     => fn( $q ) => $q >= 2 && $q <= 5,
			'enterprise' => fn( $q ) => $q >= 20 && $q <= 50,
		];
		$plan_messages = [
			'individual' => __( 'Individual plan allows only 1 user.', 'ytism' ),
			'family'     => __( 'Family plan allows between 2 to 5 users.', 'ytism' ),
			'enterprise' => __( 'Enterprise plan allows between 20 to 50 users.', 'ytism' ),
		];

		if ( ! isset( $plan_rules[ $plan ] ) || ! $plan_rules[ $plan ]( $quantity ) ) {
			return [
				'success'    => false,
				'error_type' => 'invalid_quantity',
				'message'    => $plan_messages[ $plan ] ?? __( 'Invalid plan type or quantity.', 'ytism' ),
			];
		}

		$wp_user_id             = get_current_user_id();
		$full_name              = null;
		$user_email             = null;
		$organization_name      = null;
		$has_trial              = false;
		$without_trial_price    = null;
		$without_trial_interval = '';

		$alias_user = new AliasUser( $wp_user_id );
		$alias_ok   = $alias_user && $alias_user->exists();

		if ( ! $alias_ok ) {
			return [
				'success'    => false,
				'error_type' => 'user_not_found',
				'message'    => __( 'User data not found. Please ensure your profile is complete.', 'ytism' ),
			];
		}

		$product = new \YTISM\Core\Product( $plan, false );
		if ( ! $product || ! $product instanceof \YTISM\Core\Product || $product->has_error() ) {
			return [
				'success'    => false,
				'error_type' => 'product',
				'message'    => __( 'Error retrieving product details.', 'ytism' ),
			];
		}

		$price = $product->get_price( $price_id );
		if ( ! $price || ! $price instanceof \YTISM\Core\Price || $price->has_error() ) {
			return [
				'success'    => false,
				'error_type' => 'price',
				'message'    => __( 'Error retrieving price details.', 'ytism' ),
			];
		}

		if ( 'enterprise' === $plan ) {
			if ( $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() && ! $alias_user->is_individual_user() ) {
				$alias_user_data   = $alias_user->get_userdata();
				$full_name         = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email        = $alias_user->get_email();
				$organization_name = $alias_user_data['organizationName'] ?? '';

				if ( $alias_user->has_active_subscription() ) {
					return [
						'success'    => false,
						'error_type' => 'existing_subscription',
						'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Enterprise plan.', 'ytism' ),
					];
				}
			} else {
				return [
					'success'    => false,
					'error_type' => 'user_data',
					'message'    => __( 'User data not found or invalid for Enterprise plan.', 'ytism' ),
				];
			}
		} elseif ( 'family' === $plan ) {
			if ( $alias_user->is_individual_user() && ! $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() ) {
				$alias_user_data = $alias_user->get_userdata();
				$full_name       = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email      = $alias_user->get_email();

				if ( $alias_user->has_active_subscription() ) {
					return [
						'success'    => false,
						'error_type' => 'existing_subscription',
						'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Family plan.', 'ytism' ),
					];
				}
			} else {
				return [
					'success'    => false,
					'error_type' => 'user_data',
					'message'    => __( 'User data not found or invalid for Family plan.', 'ytism' ),
				];
			}
		} elseif ( 'individual' === $plan ) {
			if ( $price->get_recurring_interval() === 'year' ) {
				$has_trial = true;

				$calculated_amounts = $price->calculate_total_for_currency( $quantity, $currency );
				if ( ! is_wp_error( $calculated_amounts ) ) {
					$without_trial_interval = isset( $calculated_amounts['recurring_interval_i18n'] ) ? $calculated_amounts['recurring_interval_i18n'] : '';
					$interval_i18n          = isset( $calculated_amounts['recurring_interval_i18n'] ) ? '/' . $calculated_amounts['recurring_interval_i18n'] : '';
					$without_trial_price    = isset( $calculated_amounts['total'] ) ? $calculated_amounts['total'] . $interval_i18n : null;
				}
			}

			if ( $alias_user->is_individual_user() && ! $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() ) {
				$alias_user_data = $alias_user->get_userdata();
				$full_name       = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email      = $alias_user->get_email();

				if ( $alias_user->has_active_subscription() ) {
					return [
						'success'    => false,
						'error_type' => 'existing_subscription',
						'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Individual plan.', 'ytism' ),
					];
				}
			} else {
				return [
					'success'    => false,
					'error_type' => 'user_data',
					'message'    => __( 'User data not found or invalid for Individual plan.', 'ytism' ),
				];
			}
		}

		if ( ! is_email( $user_email ) ) {
			return [
				'success'    => false,
				'error_type' => 'email',
				'message'    => __( 'Valid email not found for user. Please update your profile with a valid email address.', 'ytism' ),
			];
		}

		$customer      = null;
		$customer_data = get_user_meta( $wp_user_id, 'ytism_stripe_customer_data', true );
		$customer_id   = ( is_array( $customer_data ) && ! empty( $customer_data[ $currency ] ) ) ? $customer_data[ $currency ] : null;

		if ( $customer_id ) {
			try {
				$c = $this->stripe->customers->retrieve( $customer_id );
				if ( empty( $c->id ) || ! empty( $c->deleted ) || empty( $c->email ) || ( ! empty( $c->currency ) && $c->currency !== $currency ) || ( ! empty( $c->email ) && $c->email !== $user_email ) ) {
					$c = null;
				}
				$customer = $c;
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'Stripe customer retrieval error: ' . $e->getMessage() );
			}
		}

		if ( ! $customer ) {
			try {
				foreach ( $this->stripe->customers->search(
					[
						'query' => "email:'{$user_email}' AND metadata['wp_user_id']:'{$wp_user_id}'",
						'limit' => 100,
					]
				)->autoPagingIterator() as $c ) {
					if ( empty( $c->id ) || ! empty( $c->deleted ) || ( ! empty( $c->currency ) && $c->currency !== $currency ) ) {
						continue;
					}
					$customer = $c;
					break;
				}
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'Stripe customer search error: ' . $e->getMessage() );
			}
		}

		if ( ! $customer ) {
			try {
				$customer = $this->stripe->customers->create(
					[
						'email'    => $user_email,
						'name'     => $full_name,
						'metadata' => [ 'wp_user_id' => (string) $wp_user_id ],
					]
				);
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'Stripe customer creation error: ' . $e->getMessage() );
				return [
					'success'    => false,
					'error_type' => 'customer_creation',
					'message'    => __( 'Failed to create customer. Please try again.', 'ytism' ),
				];
			}
		}

		if ( empty( $customer->id ) ) {
			return [
				'success'    => false,
				'error_type' => 'customer_creation',
				'message'    => __( 'Customer not found or could not be created. Please contact support.', 'ytism' ),
			];
		}

		update_user_meta(
			$wp_user_id,
			'ytism_stripe_customer_data',
			array_merge( is_array( $customer_data ) ? $customer_data : [], [ $currency => $customer->id ] )
		);

		try {
			$stripe_subs_data = [
				'customer'           => $customer->id,
				'currency'           => $currency,
				'payment_behavior'   => 'default_incomplete',
				'payment_settings'   => [ 'save_default_payment_method' => 'on_subscription' ],
				'expand'             => [ 'latest_invoice.confirmation_secret' ],
				'collection_method'  => 'charge_automatically',
				'proration_behavior' => 'create_prorations',
				'items'              => [
					[
						'price'    => $price_id,
						'quantity' => $quantity,
					],
				],
				'metadata'           => [
					'wp_user_id' => (string) $wp_user_id,
					'user_ip'    => (string) Functions::get_user_ip(),
					'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 500 ) : 'UNKNOWN',
				],
			];

			if ( $has_trial ) {
				/* phpcs:ignore Squiz.PHP.CommentedOutCode
				$trial_minutes = 1;
				$trial_seconds = $trial_minutes * 60;
				$current_time  = time();
				$trial_end     = $current_time + $trial_seconds;
				$stripe_subs_data['trial_end'] = $trial_end;
				*/

				// phpcs:ignore Squiz.PHP.CommentedOutCode 
				$stripe_subs_data['trial_period_days'] = 7;
				$stripe_subs_data['expand'][]          = 'pending_setup_intent';
				$stripe_subs_data['trial_settings']    = [ 'end_behavior' => [ 'missing_payment_method' => 'cancel' ] ];
			}

			$stripe_subs = $this->stripe->subscriptions->create( $stripe_subs_data );

			$items = $stripe_subs->items->data ?? [];
			if ( ! $stripe_subs || ! isset( $stripe_subs->id ) || ! $items || count( $items ) === 0 ) {
				return [
					'success'    => false,
					'error_type' => 'no_items',
					'message'    => __( 'Subscription has no items. Please contact support.', 'ytism' ),
				];
			}

			if ( count( $items ) > 1 ) {
				return [
					'success'    => false,
					'error_type' => 'multiple_items',
					'message'    => __( 'Multiple subscription items are not supported.', 'ytism' ),
				];
			}

			$latest_invoice = $stripe_subs->latest_invoice;
			if ( ! $latest_invoice || ! isset( $latest_invoice->id ) ) {
				return [
					'success'    => false,
					'error_type' => 'invoice_creation',
					'message'    => __( 'Failed to retrieve invoice for subscription. Please contact support.', 'ytism' ),
				];
			}

			$client_secret = $latest_invoice->confirmation_secret->client_secret ?? null;
			if ( 'trialing' === $stripe_subs->status ) {
				$client_secret = $stripe_subs->pending_setup_intent->client_secret ?? null;
			}

			if ( ! $client_secret ) {
				return [
					'success'    => false,
					'error_type' => 'invalid_client_secret',
					'message'    => __( 'Failed to initiate payment. Please try again.', 'ytism' ),
				];
			}

			$intent = $this->get_intent_from_client_secret( $client_secret );
			if ( ! $intent || is_wp_error( $intent ) || ! isset( $intent->id ) ) {
				return [
					'success'    => false,
					'error_type' => 'invalid_intent',
					'message'    => __( 'Failed to initiate payment. Please try again.', 'ytism' ),
				];
			}

			$current_period_end   = null;
			$current_period_start = null;
			$billing_period       = null;
			$billing_interval     = 1;
			foreach ( $items as $item ) {
				if ( isset( $item->current_period_start ) && ! empty( $item->current_period_start ) ) {
					$current_period_start = $item->current_period_start;
				}
				if ( isset( $item->current_period_end ) && ! empty( $item->current_period_end ) ) {
					$current_period_end = $item->current_period_end;
				}
				if ( isset( $item->price->recurring->interval ) && ! empty( $item->price->recurring->interval ) ) {
					$billing_period = $item->price->recurring->interval;
				}
				if ( isset( $item->price->recurring->interval_count ) && ! empty( $item->price->recurring->interval_count ) ) {
					$billing_interval = max( 1, intval( $item->price->recurring->interval_count ) );
				}
				if ( $current_period_start && $current_period_end && $billing_period ) {
					break;
				}
			}

			if ( ! $current_period_end ) {
				return [
					'success'    => false,
					'error_type' => 'invalid_period',
					'message'    => __( 'Failed to retrieve subscription period. Please contact support.', 'ytism' ),
				];
			}
			if ( ! $current_period_start ) {
				$current_period_start = time();
			}

			$sub_order_handler = new \YTISM\Database\Sub_Order();

			$trail_start = null;
			$trial_end   = null;
			if ( 'trialing' === $stripe_subs->status ) {
				$trail_start = $stripe_subs->trial_start ? gmdate( 'Y-m-d H:i:s', $stripe_subs->trial_start ) : gmdate( 'Y-m-d H:i:s', $current_period_start );
				$trial_end   = $stripe_subs->trial_end ? gmdate( 'Y-m-d H:i:s', $stripe_subs->trial_end ) : gmdate( 'Y-m-d H:i:s', $current_period_end );
			}

			$amount  = Functions::format_stripe_amount( $latest_invoice->total, $latest_invoice->currency );
			$message = sprintf( 'Subscription order created for user #%d (Amount: %.2f %s, Status: %s)', $wp_user_id, $amount, $latest_invoice->currency, 'incomplete' );

			// Create Sub Order.
			$sub_order_res = $sub_order_handler->create(
				[
					'user_id'          => $wp_user_id,
					'gateway'          => 'stripe',
					'sub_id'           => $stripe_subs->id,
					'plan_items'       => [
						[
							'price_id' => $price_id,
							'quantity' => $quantity,
						],
					],
					'customer_id'      => $stripe_subs->customer ?? null,
					'sub_status'       => 'incomplete',
					'last_txn_id'      => $intent->id,
					'last_txn_status'  => 'pending',
					'qty'              => $stripe_subs->quantity ?? $quantity,
					'amount'           => $amount,
					'currency'         => strtoupper( $latest_invoice->currency ),
					'period_start'     => gmdate( 'Y-m-d H:i:s', $current_period_start ),
					'period_end'       => gmdate( 'Y-m-d H:i:s', $current_period_end ),
					'next_billing_at'  => gmdate( 'Y-m-d H:i:s', $current_period_end ),
					'trial_start_at'   => $trail_start,
					'trial_end_at'     => $trial_end,
					'billing_cycle'    => $billing_period,
					'billing_interval' => $billing_interval,
					'metadata'         => [
						'has_trial'           => ( 'trialing' === $stripe_subs->status ) ? true : false,
						'lastest_invoice_id'  => $latest_invoice->id,
						'lastest_invoice_pdf' => $latest_invoice->invoice_pdf,
					],
				]
			)->add_log(
				[
					'event_uid'  => $stripe_subs->created ?? time(),
					'ref_type'   => 'subscription',
					'ref_status' => 'subscription.created',
					'severity'   => 'info',
					'message'    => $message,
				]
			);

			if ( ! $sub_order_res || is_wp_error( $sub_order_res ) ) {
				try {
					$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
				} catch ( \Stripe\Exception\ApiErrorException $e ) {
					Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
				}

				return [
					'success'    => false,
					'error_type' => 'subscription_order',
					'message'    => $sub_order_res instanceof \WP_Error ? $sub_order_res->get_error_message() : __( 'Failed to create subscription order. Please contact support.', 'ytism' ),
				];
			}

			$sub_order_id = $sub_order_res->get_last_order_id();

			if ( $sub_order_id ) {
				if ( 'trialing' !== $stripe_subs->status ) {
					try {
						$this->stripe->paymentIntents->update(
							$intent->id,
							[
								'metadata' => [
									'wp_user_id'   => (string) $wp_user_id,
									'sub_order_id' => (string) $sub_order_id,
								],
							]
						);
					} catch ( \Stripe\Exception\ApiErrorException $e ) {
						Functions::log_debug( 'Stripe payment intent metadata update error: ' . $e->getMessage() );
						$sub_order_handler->delete( $sub_order_id );

						try {
							$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
						} catch ( \Stripe\Exception\ApiErrorException $e ) {
							Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
						}
						return [
							'success'    => false,
							'error_type' => 'payment_intent_metadata',
							'message'    => __( 'Failed to create payment record. Please contact support.', 'ytism' ),
						];
					}
				} else {
					try {
						$this->stripe->setupIntents->update(
							$intent->id,
							[
								'metadata' => [
									'wp_user_id'   => (string) $wp_user_id,
									'sub_order_id' => (string) $sub_order_id,
								],
							]
						);
					} catch ( \Stripe\Exception\ApiErrorException $e ) {
						Functions::log_debug( 'Stripe setup intent metadata update error: ' . $e->getMessage() );
						$sub_order_handler->delete( $sub_order_id );

						try {
							$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
						} catch ( \Stripe\Exception\ApiErrorException $e ) {
							Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
						}
						return [
							'success'    => false,
							'error_type' => 'setup_intent_metadata',
							'message'    => __( 'Failed to create payment record. Please contact support.', 'ytism' ),
						];
					}
				}

				// Memo description.
				$description = esc_html__(
					'Your subscription order has been created and is awaiting payment. Please complete your payment to activate your subscription and enjoy full access.',
					'ytism'
				);
				if ( ! empty( $without_trial_price ) && 'trialing' === $stripe_subs->status ) {
					$description = sprintf(
						/* translators: %1$d: number of free trial days, %2$s: price after trial, %3$s: billing interval */
						esc_html__(
							'Your subscription order has been created with a %1$d-day free trial. To activate your subscription, please set up your payment method. You will not be charged until the trial ends. After that, %2$s will be automatically charged, and your subscription will auto-renew every %3$s unless canceled.',
							'ytism'
						),
						7,
						'<strong>' . esc_html( $without_trial_price ) . '</strong>',
						$without_trial_interval
					);
				} elseif ( 'trialing' === $stripe_subs->status ) {
					$description = sprintf(
						/* translators: %1$d: number of free trial days */
						esc_html__(
							'Your subscription order is created with a %1$d-day free trial. To activate your subscription, please set up your payment method. You will not be charged until the trial ends.',
							'ytism'
						),
						7
					);
				}

				return [
					'success'       => true,
					'sub_order_id'  => $sub_order_id,
					'intent_id'     => $intent->id,
					'client_secret' => $client_secret,
					'has_trial'     => ( 'trialing' === $stripe_subs->status ) ? true : false,
					'plan'          => $plan,
					'invoice'       => [
						'invoice_id'   => $latest_invoice->id,
						'amount_due'   => Functions::format_stripe_price( $latest_invoice->total, $latest_invoice->currency ),
						'currency'     => strtoupper( $latest_invoice->currency ),
						'due_date'     => date_i18n( get_option( 'date_format' ), $latest_invoice->due_date ?? time() ),
						'account_name' => $latest_invoice->account_name ?? get_bloginfo( 'name' ),
						'description'  => $latest_invoice->description ?? $description,
					],
				];
			} else {
				try {
					$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
				} catch ( \Stripe\Exception\ApiErrorException $e ) {
					Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
				}
				return [
					'success'    => false,
					'error_type' => 'db_error',
					'message'    => __( 'Failed to create order record. Please contact support.', 'ytism' ),
				];
			}
		} catch ( \Stripe\Exception\ApiErrorException $e ) {
			Functions::log_debug( 'Stripe subscription creation error: ' . $e->getMessage() );
			return [
				'success'    => false,
				'error_type' => 'subscription_creation',
				'message'    => __( 'Payment service error: ', 'ytism' ) . $e->getMessage(),
			];
		} catch ( \Exception $e ) {
			Functions::log_debug( 'General error during subscription creation: ' . $e->getMessage() );
			return [
				'success'    => false,
				'error_type' => 'general',
				'message'    => __( 'An unexpected error occurred. Please try again.', 'ytism' ),
			];
		}

		return [
			'success'    => false,
			'error_type' => 'general',
			'message'    => __( 'An unexpected error occurred. Please try again later.', 'ytism' ),
		];
	}

	/**
	 * Shortcode redeem promo code
	 */
	public function shortcode_redeem_promo_code() {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		// phpcs:disable WordPress.Security.NonceVerification -- Read-only usage.
		$promo_code = isset( $_POST['promo_code'] ) ? sanitize_text_field( wp_unslash( $_POST['promo_code'] ) ) : '';
		$email      = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.
		?>
		<div class="ytism-promocode-container">
			<h2 class="ytism-promocode-heading">
				<?php
					printf(
						/* translators: 1: opening span tag, 2: closing span tag */
						esc_html__( 'Enter your %1$spromo code%2$s here', 'ytism' ),
						'<strong>',
						'</strong>'
					);
				?>
			</h2>
			<div class="ytism-promocode-form">
				<form method="post" class="ytism-apply-promocode-form" id="<?php echo esc_attr( $unique_id . '-apply-promocode-form' ); ?>">
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_promo_code' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Promo Code:', 'ytism' ); ?></label>
						<input type="text" name="promo_code"
							id="<?php echo esc_attr( $unique_id . '_promo_code' ); ?>"
							maxlength="100"
							required
							placeholder="<?php esc_attr_e( 'Promo Code', 'ytism' ); ?>"
							value="<?php echo esc_attr( $promo_code ); ?>">
					</div>
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_email' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Email:', 'ytism' ); ?></label>
						<input type="email" name="email"
							id="<?php echo esc_attr( $unique_id . '_email' ); ?>"
							maxlength="100"
							required
							placeholder="<?php esc_attr_e( 'Email address', 'ytism' ); ?>"
							value="<?php echo esc_attr( $email ); ?>">
					</div>

					<?php wp_nonce_field( 'ytism_apply_promocode_nonce', 'nonce' ); ?>
					<button type="submit" name="ytism_apply_promocode" class="ytism-btn ytism-apply-promocode-btn" id="<?php echo esc_attr( $unique_id . '_ytism_apply_promocode' ); ?>">
						<?php esc_html_e( 'Validate', 'ytism' ); ?>
						<span class="ytism-btn-spinner" style="display:none;"></span>
					</button>
				</form>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Shortcode to display inidividual plan form
	 */
	public function shortcode_individual_plans_form() {
		if ( function_exists( 'litespeed_cache_control' ) ) {
			litespeed_cache_control( 'no-cache' );
		}

		// Get user currency or default to USD.
		$user_currency = Functions::get_user_currency( 'USD' );
		$product       = new Product( 'individual', false, $user_currency );

		ob_start();
		if ( ! $product->has_error() || ! $product instanceof \YTISM\Core\Product ) {
			?>
			<div class="ytism-price-container" id="<?php echo esc_attr( uniqid( 'ytism-' ) . '-individual-plan-form' ); ?>" data-currency="<?php echo esc_attr( $user_currency ); ?>">
				<form method="get" action="<?php echo esc_url( \YTISM\Helpers\Functions::individual_purchase_page_url() ); ?>">
					<div class="ytism-price-items">
						<?php
						$prices           = $product->get_prices();
						$default_price    = $product->get_default_price();
						$default_price_id = ( $default_price && $default_price instanceof \YTISM\Core\Price ) ? $default_price->get_id() : '';
						$initial_currency = $product->get_initiate_checkout_currency();

						/*
						* Ensure the first valid price is used as fallback when there is no default.
						* We'll track whether we've output any valid price yet.
						*/
						$first_valid_found = false;
						$selected_interval_type = '';

						foreach ( $prices as $price_index => $price ) {
							/* Skip invalid price objects early. */
							if ( ! $price || ! $price instanceof \YTISM\Core\Price || $price->has_error() ) {
								continue;
							}

							$calculated_amounts = $price->calculate_total_for_currency( 1, $initial_currency );

							if ( is_wp_error( $calculated_amounts ) || ! is_array( $calculated_amounts ) ) {
								continue;
							}

							$recurring_interval = isset( $calculated_amounts['recurring_interval'] ) ? $calculated_amounts['recurring_interval'] : '';
							$subtotal           = isset( $calculated_amounts['subtotal'] ) ? $calculated_amounts['subtotal'] : '';
							$subtotal_raw       = isset( $calculated_amounts['subtotal_raw'] ) ? $calculated_amounts['subtotal_raw'] : '';

							$price_id = $price->get_id();

							/*
							* Determine whether this radio should be checked.
							* Priority:
							* 1. If there is a configured default_price_id and it matches.
							* 2. Otherwise, mark the first valid price as checked.
							*/
							$checked = '';
							if ( '' !== $default_price_id ) {
								$checked = checked( $default_price_id, $price_id, false );
							} elseif ( ! $first_valid_found ) {
								$checked           = 'checked';
								$first_valid_found = true;
							}

							// Track the interval of the checked price.
							if ( $checked ) {
								$selected_interval_type = $recurring_interval;
							}

							// Unique ID per price to associate label/input correctly.
							$input_id = 'ytism-price-' . esc_attr( $price_id );
							?>
							<label for="<?php echo esc_attr( $input_id ); ?>" class="<?php echo ( $checked ? 'checked' : '' ); ?>" data-interval="<?php echo esc_attr( $recurring_interval ); ?>">
								<div class="ytism-plan-item">
									<input
										type="radio"
										name="price_id"
										id="<?php echo esc_attr( $input_id ); ?>"
										value="<?php echo esc_attr( $price_id ); ?>"
										<?php echo $checked ? 'checked' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
									/>
									<div class="ytism-plan-info">
										<div class="ytism-plan-pack">
											<span class="ytism-plan-title">
												<?php
												/* translators: 1: Plan Name */
												printf(
													/* translators: 1: Plan Name */
													esc_html__( '%s Plan', 'ytism' ),
													esc_html( $price->get_name() )
												);
												?>
											</span>

											<?php if ( 'year' === $recurring_interval ) : ?>
												<span class="ytism-plan-free"><b><?php echo esc_html__( '7 days FREE', 'ytism' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></b></span>
											<?php endif; ?>
										</div>

										<div class="ytism-plan-price">
											<div class="ytism-plan-details">
												<?php if ( 'year' === $recurring_interval ) : ?>
													<span class="ytism-price">
														<?php
														// format_stripe_price returns formatted HTML/text — escape appropriately if it returns plain text.
														echo wp_kses_post( \YTISM\Helpers\Functions::format_stripe_price( $subtotal_raw / 12, $initial_currency ) );
														?>
													</span>
													<span class="ytism-price-sub"><?php echo esc_html( '/' . __( 'month', 'ytism' ) ); ?></span>
												<?php else : ?>
													<span class="ytism-monthly-price"><?php echo esc_html( $subtotal ); ?></span>
												<?php endif; ?>
											</div>

											<?php if ( 'year' === $recurring_interval ) : ?>
												<div class="ytism-plan-notice">
													<?php
													/* translators: %s: Subtotal (localized) */
													printf( esc_html__( '%s billing annually', 'ytism' ), esc_html( $subtotal ) );
													?>
												</div>
											<?php endif; ?>
										</div>
									</div>

									<?php if ( 'year' === $recurring_interval ) : ?>
										<img
											src="<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/img/badge-50-off.png' ); ?>"
											alt="<?php echo esc_attr( __( 'Badge', 'ytism' ) ); ?>"
											class="ytism-plan-badge"
										/>
									<?php endif; ?>
								</div>
							</label>
							<?php
						} // end foreach
						?>
					</div>
					<input type="hidden" name="currency" value="<?php echo esc_attr( $initial_currency ); ?>">
					<button type="submit" class="ytism-plan-submit">
						<?php
						if ( 'year' === $selected_interval_type ) {
							echo esc_html__( 'Start Free Trial', 'ytism' );
						} else {
							echo esc_html__( 'Continue to Subscribe', 'ytism' );
						}
						?>
					</button>
				</form>
			</div>
		<?php } else { ?>
			<div class="ytism-error-message"></div>
				<?php echo esc_html( $product->get_error_message() ); ?>
			</div>
			<?php
		}
		return ob_get_clean();
	}

	/**
	 * Shortcode to display Individual Plan details and subscription form
	 */
	public function shortcode_individual_plan() {
		static $is_running_individual_plan = false;

		if ( $is_running_individual_plan ) {
			return '';
		}

		$is_running_individual_plan = true;
		ob_start();

		$user_object = null;
		$alias_user  = new AliasUser( get_current_user_id() );

		if ( $alias_user && $alias_user->exists() && ! $alias_user->is_enterprise_user() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'          => $alias_user->get_wp_user_id(),
				'user_email'       => $alias_user->get_email(),
				'display_name'     => trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) ),
				'has_subscription' => $alias_user->has_active_subscription(),
			];
		}

		$user_currency = Functions::get_user_currency( 'USD' );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only usage.
		// $selected_currency = isset( $_GET['currency'] ) ? sanitize_text_field( wp_unslash( $_GET['currency'] ) ) : $user_currency;
		$product           = new Product( 'individual', false, $user_currency );

		Template::load(
			'individual-plan.php',
			[
				'userdata' => $user_object,
				'product'  => $product,
			]
		);

		$is_running_individual_plan = false;
		return ob_get_clean();
	}

	/**
	 * Shortcode to display Family Plan details and subscription form
	 */
	public function shortcode_family_plan() {
		static $is_running_family_plan = false;

		if ( $is_running_family_plan ) {
			return '';
		}

		$is_running_family_plan = true;
		ob_start();

		$user_object = null;
		$alias_user  = new AliasUser( get_current_user_id() );

		if ( $alias_user && $alias_user->exists() && ! $alias_user->is_enterprise_user() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'          => $alias_user->get_wp_user_id(),
				'user_email'       => $alias_user->get_email(),
				'display_name'     => trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) ),
				'has_subscription' => $alias_user->has_active_subscription(),
			];
		}

		$user_currency = Functions::get_user_currency( 'USD' );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only usage.
		// $selected_currency = isset( $_GET['currency'] ) ? sanitize_text_field( wp_unslash( $_GET['currency'] ) ) : $user_currency;
		$product           = new Product( 'family', false, $user_currency );

		Template::load(
			'family-plan.php',
			[
				'product'  => $product,
				'userdata' => $user_object,
			]
		);

		$is_running_family_plan = false;
		return ob_get_clean();
	}

	/**
	 * Shortcode to display Enterprise Plan details and subscription form
	 */
	public function shortcode_enterprise_plan() {
		static $is_running_enterprise_plan = false;

		if ( $is_running_enterprise_plan ) {
			return '';
		}

		$is_running_enterprise_plan = true;
		ob_start();

		$user_object = null;
		$alias_user  = new AliasUser( get_current_user_id() );

		if ( $alias_user && $alias_user->exists() && $alias_user->is_enterprise_user() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'              => $alias_user->get_wp_user_id(),
				'user_email'           => $alias_user->get_email(),
				'contract_person_name' => trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) ),
				'subscription_status'  => $alias_user->get_subscription(),
				'organization_name'    => $alias_user_data['organizationName'] ?? '',
				'has_subscription'     => $alias_user->has_active_subscription(),
			];
		}

		// $user_currency = Functions::get_user_currency( 'USD' );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only usage.
		// $selected_currency = isset( $_GET['currency'] ) ? sanitize_text_field( wp_unslash( $_GET['currency'] ) ) : $user_currency;
		$product           = new Product( 'enterprise', false, 'USD' );

		Template::load(
			'enterprise-plan.php',
			[
				'product'  => $product,
				'userdata' => $user_object,
			]
		);

		$is_running_enterprise_plan = false;
		return ob_get_clean();
	}

	/**
	 * Render payment method details in order summary
	 *
	 * @param array $pm_details Payment method details array.
	 * @return string HTML output of payment method details.
	 */
	protected function render_payment_method_details( array $pm_details ): string {
		if ( empty( $pm_details['type'] ) || empty( $pm_details['method_details'] ) ) {
			return '';
		}

		$type    = $pm_details['type'];
		$details = $pm_details['method_details'];

		ob_start();

		switch ( $type ) {
			case 'card':
				$brand   = ucfirst( $details['brand'] ?? __( 'Card', 'ytism' ) );
				$last4   = $details['last4'] ?? 'XXXX';
				$funding = ucfirst( $details['funding'] ?? '' );
				?>
				<tr>
					<td><?php esc_html_e( 'Card Details', 'ytism' ); ?></td>
					<td>
						<?php
						/* translators: %1$s: card brand (Visa, Mastercard, etc), %2$s: funding type (Credit, Debit), %3$s: last 4 digits */
						echo esc_html( sprintf( __( '%1$s %2$s ending in %3$s', 'ytism' ), $brand, $funding, $last4 ) );

						if ( ! empty( $details['wallet'] ) ) {
							echo ' <span class="ytism-wallet-badge">' . esc_html( ucfirst( $details['wallet'] ) ) . '</span>';
						}
						?>
					</td>
				</tr>
				<?php
				break;

			case 'us_bank_account':
			case 'acss_debit':
			case 'bacs_debit':
			case 'au_becs_debit':
				$bank_name = $details['bank_name'] ?? __( 'Bank Account', 'ytism' );
				$last4     = $details['last4'] ?? 'XXXX';
				?>
				<tr>
					<td><?php esc_html_e( 'Bank Details', 'ytism' ); ?></td>
					<td>
						<?php
						/* translators: %1$s: bank name, %2$s: last 4 digits */
						echo esc_html( sprintf( __( '%1$s ending in %2$s', 'ytism' ), $bank_name, $last4 ) );
						?>
					</td>
				</tr>
				<?php
				break;

			case 'sepa_debit':
				$country = $details['country'] ?? '';
				$last4   = $details['last4'] ?? 'XXXX';
				?>
				<tr>
					<td><?php esc_html_e( 'SEPA Details', 'ytism' ); ?></td>
					<td>
						<?php
						/* translators: %1$s: country code, %2$s: last 4 digits */
						echo esc_html( sprintf( __( '%1$s account ending in %2$s', 'ytism' ), $country, $last4 ) );
						?>
					</td>
				</tr>
				<?php
				break;

			case 'paypal':
				$email = $details['payer_email'] ?? '';
				if ( $email ) {
					?>
					<tr>
						<td><?php esc_html_e( 'PayPal Email', 'ytism' ); ?></td>
						<td><?php echo esc_html( $email ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'ideal':
				$bank = $details['bank'] ?? '';
				if ( $bank ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Bank', 'ytism' ); ?></td>
						<td><?php echo esc_html( $bank ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'eps':
				$bank = $details['bank'] ?? '';
				if ( $bank ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Bank', 'ytism' ); ?></td>
						<td><?php echo esc_html( $bank ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'p24':
				$bank = $details['bank'] ?? '';
				if ( $bank ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Bank', 'ytism' ); ?></td>
						<td><?php echo esc_html( $bank ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'sofort':
				$country = $details['country'] ?? '';
				if ( $country ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Country', 'ytism' ); ?></td>
						<td><?php echo esc_html( $country ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'cashapp':
				$cashtag = $details['cashtag'] ?? '';
				if ( $cashtag ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Cashtag', 'ytism' ); ?></td>
						<td><?php echo esc_html( $cashtag ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'link':
				$email = $details['email'] ?? '';
				if ( $email ) {
					?>
					<tr>
						<td><?php esc_html_e( 'Email', 'ytism' ); ?></td>
						<td><?php echo esc_html( $email ); ?></td>
					</tr>
					<?php
				}
				break;

			case 'klarna':
				?>
				<tr>
					<td><?php esc_html_e( 'Payment Type', 'ytism' ); ?></td>
					<td><?php esc_html_e( 'Pay Later', 'ytism' ); ?></td>
				</tr>
				<?php
				break;
		}

		return ob_get_clean();
	}

	/**
	 * Render order summary wrapper
	 *
	 * @param bool             $is_error      Whether the message is an error or success.
	 * @param string           $order_heading Heading message.
	 * @param string           $order_message  Body message.
	 * @param Sub_Order_Object $order_data  Order Data.
	 * @return string HTML output of order summary wrapper.
	 */
	protected function render_order_wrapper( bool $is_error, string $order_heading, string $order_message, ?Sub_Order_Object $order_data = null ): string {
		// Set transaction message based on transaction status.
		$payment_message = __( 'Your payment is being processed.', 'ytism' );
		if ( preg_match( '/^pi_[a-zA-Z0-9]+$/', $order_data->last_txn_id ) === 1 ) {
			$payment_intent = $this->stripe->paymentIntents->retrieve( $order_data->last_txn_id, [] );

			if ( $payment_intent && ! empty( $payment_intent->id ) && ! empty( $payment_intent->status ) && ! empty( $payment_intent->metadata->sub_order_id ) && (int) $payment_intent->metadata->sub_order_id === (int) $order_data->ID ) {
				switch ( $payment_intent->status ) {
					case 'requires_payment_method':
						$payment_message = __( 'Your payment method setup failed. Please try again or use a different method.', 'ytism' );

						if ( ! empty( $payment_intent->last_payment_error ) ) {
							$error            = $payment_intent->last_payment_error;
							$stripe_error_msg = Stripe_Error_Codes::get_error_message( $error );
							$payment_message  = $stripe_error_msg['user_message'] ?? $error->message ?? $payment_message;
						}
						break;

					case 'requires_confirmation':
						$payment_message = __( 'Your payment is pending confirmation.', 'ytism' );
						break;

					case 'requires_action':
						$payment_message = __( 'Additional authentication required. Please complete verification with your bank.', 'ytism' );
						break;

					case 'processing':
						$payment_message = __( 'Hold tight, your order is being processed.', 'ytism' );
						break;

					case 'requires_capture':
						$payment_message = __( 'Your payment is awaiting capture.', 'ytism' );
						break;

					case 'canceled':
						$reason          = ! empty( $payment_intent->cancellation_reason )
							? ' (' . str_replace( '_', ' ', $payment_intent->cancellation_reason ) . ')'
							: '';
						$payment_message = sprintf(
							/* translators: %s is the cancellation reason. */
							__( 'Your payment was canceled%s.', 'ytism' ),
							$reason
						);
						break;

					case 'succeeded':
						$payment_message = __( 'Your payment was successful. Thank you!', 'ytism' );
						break;

					default:
						$payment_message = __( 'Unknown payment status. Please contact support.', 'ytism' );
						break;
				}
			}
		}

		// Payment method data.
		$pm_data = $order_data->last_payment_method;

		$myaccount_url = Functions::get_myaccount_page_url();

		$is_enterprise = false;
		$is_family     = false;
		$is_individual = false;

		ob_start();
		?>
		
		<div class="ytism-order-summary-wrapper <?php echo $is_error ? 'error' : 'success'; ?>">
			<!-- Order Summary Header -->
			<div class="ytism-order-summary-header">
				<div class="ytism-order-icon <?php echo $is_error ? 'error' : 'success'; ?>">
					<?php if ( $is_error ) : ?>
						<i class="ytism-icon ytism-icon-cross-circle"></i>
					<?php else : ?>
						<i class="ytism-icon ytism-icon-shield-check"></i>
					<?php endif; ?>
				</div>
				<h2 class="ytism-order-message-heading"><?php echo esc_html( $order_heading ); ?></h2>
				<p class="ytism-order-message-body"><?php echo esc_html( $order_message ); ?></p>
				<?php if ( ! empty( $payment_message ) ) : ?>
					<p class="ytism-order-message-payment" style="<?php echo ( isset( $order_data->sub_status ) && ( 'trialing' === $order_data->sub_status || 'active' === $order_data->sub_status ) ) ? 'color: #23A26D;' : 'color: #ec3323'; ?>"><?php echo esc_html( $payment_message ); ?></p>
				<?php endif; ?>
			</div>
			
			<!-- Payment Details Section -->
			<?php
			if ( ! empty( $order_data ) ) :
				// Check user type.
				$alias_user    = new AliasUser( $order_data->user_id );
				$is_enterprise = $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() && $alias_user->is_enterprise_user();
				$is_family     = $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() && $alias_user->is_family_user();
				$is_individual = $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() && $alias_user->is_individual_user();

				$status_colors = [
					'trialing'   => '#fbbf24',
					'active'     => '#10b981',
					'canceled'   => '#ef4444',
					'past_due'   => '#f97316',
					'incomplete' => '#6b7280',
					'paused'     => '#8b5cf6',
				];

				$status_labels = [
					'trialing'   => __( 'Trialing', 'ytism' ),
					'active'     => __( 'Active', 'ytism' ),
					'canceled'   => __( 'Canceled', 'ytism' ),
					'past_due'   => __( 'Past Due', 'ytism' ),
					'incomplete' => __( 'Incomplete', 'ytism' ),
					'paused'     => __( 'Paused', 'ytism' ),
				];

				$badge_color = $status_colors[ $order_data->sub_status ] ?? '#6b7280';
				$badge_label = $status_labels[ $order_data->sub_status ] ?? ucfirst( $order_data->sub_status );

				$billing_interval = $order_data->billing_interval;
				$billing_cycle    = $order_data->billing_cycle;
				$cycle_labels     = [
					'day'   => _n( 'Day', 'Days', $billing_interval, 'ytism' ),
					'week'  => _n( 'Week', 'Weeks', $billing_interval, 'ytism' ),
					'month' => _n( 'Month', 'Months', $billing_interval, 'ytism' ),
					'year'  => _n( 'Year', 'Years', $billing_interval, 'ytism' ),
				];

				$billing_cycle_text = $cycle_labels[ $billing_cycle ] ?? ucfirst( $billing_cycle );

				$redirect_url = Functions::get_thankyou_page_url();
				?>
				<div class="ytism-payment-method-details">
					<h3 class="ytism-payment-method-heading"><?php esc_html_e( 'Payment Details', 'ytism' ); ?></h3>
					<table class="ytism-payment-method-list" width="100%">
						<tbody>
							<tr>
								<td><?php esc_html_e( 'Order ID', 'ytism' ); ?></td>
								<td><strong>#<?php echo esc_html( $order_data->ID ); ?></strong></td>
							</tr>

							<?php if ( ! empty( $order_data->sub_id ) && $order_data->qty > 1 ) : ?>
								<tr>
									<td>
										<?php
										if ( $is_enterprise ) {
											echo esc_html( _n( 'Seat', 'Seats', $order_data->qty, 'ytism' ) );
										} else {
											echo esc_html( _n( 'Member', 'Members', $order_data->qty, 'ytism' ) );
										}
										?>
									</td>
									<td><?php echo esc_html( $order_data->qty ); ?></td>
								</tr>
							<?php endif; ?>
							
							<tr>
								<td><?php esc_html_e( 'Status', 'ytism' ); ?></td>
								<td><?php printf( '<span class="ytism-badge" style="background-color: %s;">%s</span>', esc_attr( $badge_color ), esc_html( $badge_label ) ); ?></td>
							</tr>
							
							<tr>
								<td><?php esc_html_e( 'Amount', 'ytism' ); ?></td>
								<td>
									<span class="ytism-price">
										<?php
										// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
										echo Functions::format_price( $order_data->amount, $order_data->currency, true );
										?>
									</span>
								</td>
							</tr>
							
							<?php if ( ! empty( $order_data->sub_id ) && ( 'trialing' === $order_data->sub_status || 'active' === $order_data->sub_status ) ) : ?>
								<tr>
									<td><?php esc_html_e( 'Billing Cycle', 'ytism' ); ?></td>
									<td>
										<?php
										echo esc_html(
											sprintf(
												/* translators: %1$s: billing interval number, %2$s: billing cycle text */
												__( 'Every %1$s %2$s', 'ytism' ),
												$billing_interval,
												$billing_cycle_text
											)
										);
										?>
									</td>
								</tr>
								<tr>
									<td><?php esc_html_e( 'Next Billing Date', 'ytism' ); ?></td>
									<td><strong><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $order_data->next_billing_at ) ) ); ?></strong></td>
								</tr>
								
								<?php if ( 'trialing' === $order_data->sub_status && $order_data->trial_end_at ) : ?>
								<tr>
									<td><?php esc_html_e( 'Trial Ends', 'ytism' ); ?></td>
									<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $order_data->trial_end_at ) ) ); ?></td>
								</tr>
								<?php endif; ?>
							<?php endif; ?>
							
							<tr>
								<td><?php esc_html_e( 'Order Date', 'ytism' ); ?></td>
								<td><?php echo esc_html( date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $order_data->created_at ) ) ); ?></td>
							</tr>
							
							<?php if ( $order_data->canceled_at ) : ?>
							<tr>
								<td><?php esc_html_e( 'Canceled Date', 'ytism' ); ?></td>
								<td class="ytism-text-error">
									<?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $order_data->canceled_at ) ) ); ?>
								</td>
							</tr>
							<?php endif; ?>
						
							<?php if ( $pm_data && is_array( $pm_data ) && ! empty( $pm_data['id'] ) ) : ?>
								<tr>
									<td><?php esc_html_e( 'Payment Method', 'ytism' ); ?></td>
									<td><?php echo esc_html( Functions::get_payment_type_label( $pm_data['type'] ) ); ?></td>
								</tr>

								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_payment_method_details( $pm_data );
								?>
							<?php endif; ?>
						</tbody>
					</table>
				</div>
			<?php endif; ?>

			<!-- Action Buttons -->
			<div class="ytism-order-actions">
				<a href="<?php echo esc_url( $myaccount_url ); ?>" class="ytism-btn ytism-btn-secondary">
					<?php esc_html_e( 'My Account', 'ytism' ); ?>
				</a>
				<?php if ( $is_enterprise ) : ?>
					<a href="<?php echo esc_url( $redirect_url ); ?>" class="ytism-btn ytism-btn-primary">
						<?php esc_html_e( 'Add Super Manager', 'ytism' ); ?>
					</a>
				<?php endif; ?>
			</div>

			<?php if ( ! empty( $order_data->gateway_subscription_id ) && ( 'trialing' === $order_data->sub_status || 'active' === $order_data->sub_status ) ) : ?>
				<div class="ytism-order-bottom-extra">
					<a href="https://d39nwl09lkpgpv.cloudfront.net/login/" target="_blank" class="ytism-webapp-link"><?php esc_html_e( 'Continue to webapp', 'ytism' ); ?></a>
				</div>
			<?php endif; ?>
		</div>

		<?php if ( ! empty( $redirect_url ) ) : ?>
			<script>
			setTimeout(function() {
				window.location.href = '<?php echo esc_url( $redirect_url ); ?>';
			}, 5000);
			</script>
		<?php endif; ?>

		<?php
		return ob_get_clean();
	}

	/**
	 * Shortcode: [ytism_order_summary]
	 */
	public function shortcode_order_summary() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only usage.
		$sub_order_id = isset( $_GET['sub_order_id'] ) ? intval( $_GET['sub_order_id'] ) : 0;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		if ( empty( $sub_order_id ) || $sub_order_id <= 0 ) {
			$is_error      = true;
			$order_heading = __( 'Invalid Order!', 'ytism' );
			$order_message = __( 'The order ID provided is invalid. Please check the link and try again, or contact support for assistance.', 'ytism' );

			return $this->render_order_wrapper( $is_error, $order_heading, $order_message );
		}

		$is_error      = true;
		$order_heading = __( 'Order Failed!', 'ytism' );
		$order_message = __( 'Your order could not be completed due to a payment issue. Please try again or contact support for assistance.', 'ytism' );

		$sub_order_handler  = new \YTISM\Database\Sub_Order();
		$existing_sub_order = $sub_order_handler->get( $sub_order_id );

		if ( ! $existing_sub_order || null === $existing_sub_order || ! ( $existing_sub_order instanceof \YTISM\Core\Sub_Order ) ) {
			$order_heading = __( 'Order Not Found!', 'ytism' );
			$order_message = __( "We couldn't find your order. Please check the order ID and try again, or contact support for assistance.", 'ytism' );

			return $this->render_order_wrapper( $is_error, $order_heading, $order_message );
		}

		$wp_user_id = get_current_user_id();
		if ( $existing_sub_order && (int) $existing_sub_order->user_id !== (int) $wp_user_id && ! current_user_can( 'manage_options' ) ) {
			$order_heading = __( 'Access Denied!', 'ytism' );
			$order_message = __( 'You do not have permission to view this order. Please log in with the correct account or contact support for assistance.', 'ytism' );
			$is_error      = true;

			return $this->render_order_wrapper( $is_error, $order_heading, $order_message );
		}

		// Set message heading/body based on subscription status.
		switch ( $existing_sub_order->sub_status ) {
			case 'active':
				$order_heading = __( 'Order Successful!', 'ytism' );
				$order_message = __( 'Thank you! Your subscription is now active and you have full access.', 'ytism' );
				$is_error      = false;
				break;
			case 'trialing':
				$order_heading = __( 'Trial Started!', 'ytism' );
				$order_message = __( 'Your subscription trial has started. You have access during the trial period.', 'ytism' );
				$is_error      = false;
				break;
			case 'incomplete':
				$order_heading = __( 'Order Incomplete', 'ytism' );
				$order_message = __( 'Your order is incomplete. Please complete your payment to activate your subscription.', 'ytism' );
				$is_error      = true;
				break;
			case 'canceled':
				$order_heading = __( 'Order Canceled', 'ytism' );
				$order_message = __( 'Your subscription has been canceled. If this was a mistake, you can try again.', 'ytism' );
				$is_error      = true;
				break;
			case 'expired':
				$order_heading = __( 'Order Expired', 'ytism' );
				$order_message = __( 'Your subscription has expired. Please renew to regain access.', 'ytism' );
				$is_error      = true;
				break;
			case 'pending':
				$order_heading = __( 'Order Pending', 'ytism' );
				$order_message = __( 'Your order is pending. Please wait while we process your payment.', 'ytism' );
				$is_error      = true;
				break;
			case 'failed':
				$order_heading = __( 'Order Failed!', 'ytism' );
				$order_message = __( 'Your order could not be completed due to a payment issue. Please try again or contact support for assistance.', 'ytism' );
				$is_error      = true;
				break;
			default:
				break;
		}

		return $this->render_order_wrapper( $is_error, $order_heading, $order_message, $existing_sub_order );
	}

	/**
	 * Shortcode: [ytism_my_account]
	 */
	public function shortcode_my_account() {
		static $is_running_myaccount = false;

		// Allow AJAX requests (do not check is_page() for AJAX).
		$is_ajax = defined( 'DOING_AJAX' ) && DOING_AJAX;

		if ( ( ! is_page() && ! $is_ajax ) || $is_running_myaccount ) {
			return '';
		}

		$is_running_myaccount = true;

		if ( ! is_user_logged_in() ) {
			$is_running_myaccount = false;
			return '<p>' . esc_html__( 'Please log in to access your account.', 'ytism' ) . '</p>';
		}

		$subpage = get_query_var( 'ytism_myaccount_pages', 'dashboard' );

		$user_object = null;
		$alias_user  = new AliasUser( get_current_user_id() );

		$output = __( 'You are not authorized to view this content.', 'ytism' );

		if ( $alias_user && $alias_user->exists() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'             => $alias_user->get_wp_user_id(),
				'user_email'          => $alias_user->get_email(),
				'first_name'          => $alias_user_data['name'] ?? '',
				'last_name'           => $alias_user_data['lastName'] ?? '',
				'subscription_status' => $alias_user->get_subscription(),
			];
			$myaccount_tabs  = Functions::get_myaccount_tabs( $alias_user->get_wp_user_id() );

			switch ( $subpage ) {
				case 'profile':
					$output = Template::load(
						'my-account/profile.php',
						[
							'alias_user' => $alias_user,
							'userdata'   => $user_object,
							'tabs'       => $myaccount_tabs,
						]
					);
					break;
				case 'transactions':
					$output = Template::load(
						'my-account/transactions.php',
						[
							'alias_user' => $alias_user,
							'userdata'   => $user_object,
							'tabs'       => $myaccount_tabs,
						]
					);
					break;
				case 'subscriptions':
					$output = Template::load(
						'my-account/subscriptions.php',
						[
							'alias_user' => $alias_user,
							'userdata'   => $user_object,
							'tabs'       => $myaccount_tabs,
						]
					);
					break;
				case 'super_manager':
					if ( $alias_user->is_enterprise_user() ) {
						$output = Template::load(
							'my-account/super-manager.php',
							[
								'alias_user' => $alias_user,
								'userdata'   => $user_object,
								'tabs'       => $myaccount_tabs,
							]
						);
					} else {
						$output = __( 'You are not authorized to view this content.', 'ytism' );
					}
					break;
				default:
					$output = Template::load(
						'my-account/dashboard.php',
						[
							'alias_user' => $alias_user,
							'userdata'   => $user_object,
							'tabs'       => $myaccount_tabs,
						]
					);
					break;
			}
		}

		$is_running_myaccount = false;

		return $output;
	}

	/**
	 * Shortcode: [ytism_checkout]
	 */
	public function shortcode_checkout() {
		static $is_running_checkout = false;

		// Allow AJAX requests (do not check is_page() for AJAX).
		$is_ajax = defined( 'DOING_AJAX' ) && DOING_AJAX;

		if ( ( ! is_page() && ! $is_ajax ) || ! is_user_logged_in() || $is_running_checkout ) {
			return '';
		}

		$is_running_checkout = true;

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only usage.
		$plan     = isset( $_GET['plan'] ) ? sanitize_text_field( wp_unslash( $_GET['plan'] ) ) : '';
		$price_id = isset( $_GET['price_id'] ) ? sanitize_text_field( wp_unslash( $_GET['price_id'] ) ) : '';
		$currency = isset( $_GET['currency'] ) ? sanitize_text_field( wp_unslash( $_GET['currency'] ) ) : Functions::get_user_currency( 'USD' );
		$quantity = isset( $_GET['quantity'] ) ? intval( $_GET['quantity'] ) : 1;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		$output     = __( 'You are not authorized to view this content.', 'ytism' );
		$alias_user = new AliasUser( get_current_user_id() );

		if ( $alias_user && $alias_user->exists() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'          => $alias_user->get_wp_user_id(),
				'user_email'       => $alias_user->get_email(),
				'display_name'     => trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) ),
				'has_subscription' => $alias_user->has_active_subscription(),
			];

			$subscription = $this->create_subscription( $plan, $price_id, $quantity, $currency );

			wp_localize_script( 'ytism-public-script', 'YTISM_CHECKOUT', $subscription );

			$output = Template::load(
				'checkout.php',
				[
					'alias_user'    => $alias_user,
					'userdata'      => $user_object,
					'is_enterprise' => $alias_user->is_enterprise_user(),
					'subscription'  => $subscription,
				]
			);
		}

		$is_running_checkout = false;

		return $output;
	}

	/**
	 * Shortcode: [ytism_add_super_manager]
	 */
	public function shortcode_add_super_manager() {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		// phpcs:disable WordPress.Security.NonceVerification -- Read-only usage.
		$first_name   = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name    = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$email        = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$phone_number = isset( $_POST['phone_number_full'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number_full'] ) ) : ( isset( $_POST['phone_number'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number'] ) ) : '' );
		$terms        = isset( $_POST['terms'] ) ? (bool) $_POST['terms'] : false;
		// phpcs:enable WordPress.Security.NonceVerification
		?>
		<div class="ytism-supermanager-container">
			<h2 class="ytism-supermanager-header">
				<?php esc_html_e( 'Super Manager Registration', 'ytism' ); ?>
			</h2>
			<div class="ytism-supermanager-form">
				<form method="post" class="ytism-register-form ytism-add-supermanager-form" id="<?php echo esc_attr( $unique_id . '-supermanager-register-form' ); ?>">
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_first_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'First name:', 'ytism' ); ?></label>
						<input type="text" name="first_name"
							id="<?php echo esc_attr( $unique_id . '_first_name' ); ?>"
							maxlength="100"
							required
							placeholder="<?php esc_attr_e( 'First name', 'ytism' ); ?>"
							value="<?php echo esc_attr( $first_name ); ?>">
					</div>
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_last_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Last name:', 'ytism' ); ?></label>
						<input type="text" name="last_name"
							id="<?php echo esc_attr( $unique_id . '_last_name' ); ?>"
							maxlength="100"
							required
							placeholder="<?php esc_attr_e( 'Last name', 'ytism' ); ?>"
							value="<?php echo esc_attr( $last_name ); ?>">
					</div>
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_email' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Email:', 'ytism' ); ?></label>
						<input type="email" name="email"
							id="<?php echo esc_attr( $unique_id . '_email' ); ?>"
							maxlength="100"
							required
							placeholder="<?php esc_attr_e( 'Email address', 'ytism' ); ?>"
							value="<?php echo esc_attr( $email ); ?>">
					</div>
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_phone_number' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Phone number:', 'ytism' ); ?></label>
						<input type="tel" name="phone_number" class="ytism-intl-tel-input"
							id="<?php echo esc_attr( $unique_id . '_phone_number' ); ?>"
							maxlength="25"
							required
							placeholder="<?php esc_attr_e( 'Phone number', 'ytism' ); ?>"
							value="<?php echo esc_attr( $phone_number ); ?>">
					</div>
					<div class="ytism-form-field">
						<label for="<?php echo esc_attr( $unique_id . '_terms' ); ?>" class="ytism-form-field-label ytism-form-field-label-checkbox ytism-form-field-terms require">
							<input type="checkbox" name="terms" id="<?php echo esc_attr( $unique_id . '_terms' ); ?>" required value="1" <?php checked( $terms, true ); ?>/>
							
							<?php
							printf(
								wp_kses_post(
									/* translators: 1: opening anchor tag for Terms of Use, 2: closing anchor tag for Terms of Use, 3: opening anchor tag for Privacy Policy and Subscription Terms, 4: closing anchor tag for Privacy Policy and Subscription Terms. */
									__( 'By clicking add super manager, you confirm and affirm that you have read, understood and agreed to our %1$sTerms of Use%2$s, %3$sPrivacy Policy and Subscription Terms%4$s.', 'ytism' )
								),
								'<a href="' . esc_url( Functions::get_terms_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
								'</a>',
								'<a href="' . esc_url( Functions::get_privacy_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
								'</a>'
							);
							?>
						</label>
					</div>

					<?php wp_nonce_field( 'ytism_add_supermanager_nonce', 'nonce' ); ?>
					<button type="submit" name="ytism_add_supermanager" class="ytism-btn ytism-add-supermanager-btn" id="<?php echo esc_attr( $unique_id . '_ytism_add_supermanager' ); ?>">
						<?php esc_html_e( 'Add Super manager', 'ytism' ); ?>
						<span class="ytism-btn-spinner" style="display:none;"></span>
					</button>
				</form>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Shortcode: [ytism_welcome_box]
	 */
	public function shortcode_welcome_box() {
		static $is_running_welcomebox = false;

		if ( $is_running_welcomebox ) {
			return '';
		}

		$is_running_welcomebox = true;

		$current_slug = get_post_field( 'post_name', get_post() );
		$class_name   = 'name-' . $current_slug;

		$output = Template::load( 'welcome-box.php', [ 'class_name' => $class_name ] );

		$is_running_welcomebox = false;

		return $output;
	}

	/**
	 * Shortcode: [ytism_questions]
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string HTML output.
	 */
	public function shortcode_questions( $atts = [] ) {
		static $is_running_questions = false;

		// Allow AJAX requests (do not check is_page() for AJAX).
		$is_ajax = defined( 'DOING_AJAX' ) && DOING_AJAX;

		if ( ( ! is_page() && ! $is_ajax ) || ! is_user_logged_in() || $is_running_questions ) {
			return '';
		}

		$is_running_questions = true;

		$atts = shortcode_atts(
			[
				'step' => 1,
			],
			$atts
		);
		$step = intval( $atts['step'] );

		$output     = __( 'You are not authorized to view this content.', 'ytism' );
		$alias_user = new AliasUser( get_current_user_id() );

		if ( $alias_user && $alias_user->exists() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'    => $alias_user->get_wp_user_id(),
				'user_email' => $alias_user->get_email(),
				'first_name' => $alias_user_data['name'] ?? '',
				'last_name'  => $alias_user_data['lastName'] ?? '',
			];

			$output = Template::load(
				'thank-you/questions.php',
				[
					'alias_user' => $alias_user,
					'userdata'   => $user_object,
					'step'       => $step,
				]
			);
		}

		$is_running_questions = false;

		return $output;
	}

	/**
	 * Shortcode: [ytism_thank_you]
	 */
	public function shortcode_thank_you() {
		static $is_running_thankyou = false;

		// Allow AJAX requests (do not check is_page() for AJAX).
		$is_ajax = defined( 'DOING_AJAX' ) && DOING_AJAX;

		if ( ( ! is_page() && ! $is_ajax ) || ! is_user_logged_in() || $is_running_thankyou ) {
			return '';
		}

		$is_running_thankyou = true;

		$current_user_id = get_current_user_id();
		$user_object     = null;
		$alias_user      = new AliasUser( $current_user_id );

		$output = __( 'You are not authorized to view this content.', 'ytism' );

		if ( $alias_user && $alias_user->exists() ) {
			$alias_user_data = $alias_user->get_userdata();
			$user_object     = [
				'user_id'    => $alias_user->get_wp_user_id(),
				'user_email' => $alias_user->get_email(),
				'first_name' => $alias_user_data['name'] ?? '',
				'last_name'  => $alias_user_data['lastName'] ?? '',
			];

			// get user questions answers.
			$already_answered = false;
			$user_meta        = get_user_meta( $current_user_id, 'ytism_question_answers', true );
			if ( ! empty( $user_meta ) && is_array( $user_meta ) ) {
				$already_answered = true;
			}

			// Additional data for enterprise users.
			$is_enterprise = $alias_user->is_enterprise_user();
			$is_individual = $alias_user->is_individual_user();
			$is_family     = $alias_user->is_family_user();

			if ( $is_enterprise ) {
				$user_object['organization_name'] = $alias_user_data['organizationName'] ?? '';
				$user_object['organization_type'] = $alias_user_data['organizationType'] ?? '';

				$output = Template::load(
					'thank-you/enterprise.php',
					[
						'alias_user' => $alias_user,
						'userdata'   => $user_object,
					]
				);
			} elseif ( $is_family || $is_individual ) {
				// Show questions answers form only if not already answered.
				if ( ! $already_answered ) {
					$output = do_shortcode( '[ytism_questions step="1"]' );
				} else {
					$template = $is_family ? 'thank-you/family.php' : 'thank-you/individual.php';
					$output   = Template::load(
						$template,
						[
							'alias_user' => $alias_user,
							'userdata'   => $user_object,
						]
					);
				}
			}
		}

		$is_running_thankyou = false;

		return $output;
	}

	/**
	 * Handle actions when a subscription becomes active
	 *
	 * @param int   $sub_id      Subscription ID.
	 * @param int   $wp_user_id  WordPress User ID.
	 * @param array $data        Additional data.
	 * @return void
	 */
	public function on_subscription_activate_action( int $sub_id, int $wp_user_id, array $data ) {
		$alias_user = new AliasUser( $wp_user_id );
		if ( ! $alias_user || ! $alias_user->exists() ) {
			Functions::log_debug( 'Alias user not found for WP user ID ' . $wp_user_id );
			return;
		}

		$sub_order_handler  = new \YTISM\Database\Sub_Order();
		$existing_sub_order = $sub_order_handler->get( $sub_id );

		if ( ! $existing_sub_order || null === $existing_sub_order || ! ( $existing_sub_order instanceof \YTISM\Core\Sub_Order ) ) {
			Functions::log_debug( 'Subscription not found for ID ' . $sub_id );
			return;
		}

		if ( empty( $existing_sub_order->last_txn_id ) ) {
			Functions::log_debug( 'No last transaction ID found for subscription ID ' . $sub_id );
			return;
		}

		$is_enterprise = $alias_user->is_enterprise_user();
		$is_individual = $alias_user->is_individual_user();
		$is_family     = $alias_user->is_family_user();

		if ( $is_enterprise ) {
			// Enterprise user creation.
			$alias_user_data   = $alias_user->get_userdata();
			$full_name         = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
			$organization_name = $alias_user_data['organizationName'] ?? '';
			$has_subscription  = $alias_user->has_active_subscription();
			$user_pass         = get_user_meta( $wp_user_id, 'ytism_alias_password', true );
			$password          = null;
			if ( ! empty( $user_pass ) ) {
				$password = Functions::decrypt_str( $user_pass );
			}

			$data = [
				'countryId'             => $alias_user_data['countryId'] ?? 0,
				'countryCode'           => $alias_user_data['phoneCountryCode'] ?? '',
				'organizationName'      => $alias_user_data['organizationName'] ?? '',
				'name'                  => $full_name,
				'seats'                 => $existing_sub_order->qty ?? 1,
				'organizationType'      => $alias_user_data['organizationType'] ?? '',
				'phone'                 => $alias_user_data['phoneNationalNumber'] ?? '',
				'departments'           => $alias_user_data['departmentsId'] ?? [],
				'email'                 => $alias_user->get_email(),
				'password'              => $password,
				'subscriptionStartDate' => gmdate( 'Y-m-d', strtotime( $existing_sub_order->period_start ) ) ?? current_time( 'Y-m-d' ),
				'customerId'            => $existing_sub_order->customer_id ?? '',
				'subscriptionId'        => $existing_sub_order->sub_id ?? '',
				'invoiceId'             => $existing_sub_order->metadata['lastest_invoice_id'] ?? '',
				'paymentIntentId'       => $existing_sub_order->last_txn_id ?? '',
				'price'                 => $existing_sub_order->amount ?? 0,
				'pdfLink'               => $existing_sub_order->metadata['lastest_invoice_pdf'] ?? '',
			];

			// Create user via API.
			$api      = new Api();
			$response = $api->create_enterprise_user( $data );
			Functions::log_debug(
				sprintf(
					'Enterprise user creation REQUEST: %s, RESPONSE: %s',
					wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ),
					wp_json_encode( $response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES )
				)
			);

			if ( $response && is_array( $response ) && isset( $response['data']['organizationId'], $response['data']['contractPersonUserId'] ) ) {
				$org_data     = $response['data'];
				$updated_data = [
					'organizationId'     => $org_data['organizationId'] ?? null,
					'name'               => $org_data['name'] ?? '',
					'email'              => $org_data['contractPerson']['email'] ?? '',
					'phoneNumber'        => $org_data['contractPerson']['phoneNumber'] ?? '',
					'registrationDate'   => $org_data['registrationDate'] ?? '',
					'active'             => $org_data['isActive'] ?? 0,
					'countryId'          => $org_data['countryId'] ?? null,
					'country'            => [
						'countryId'   => $org_data['country']['countryId'] ?? null,
						'countryName' => $org_data['country']['countryName'] ?? '',
					],
					'subscriptionStatus' => $org_data['subscription']['subscriptionStatus'] ?? null,
					'subscriptionType'   => $org_data['organizationType'] ?? '',
					'fullName'           => $org_data['contractPerson']['name'] ?? '',
					'userId'             => $org_data['contractPersonUserId'] ?? null,
					'organization'       => [
						'organizationId' => $org_data['organizationId'] ?? null,
					],
				];
				$is_updated   = $alias_user->update_user( $updated_data );

				if ( $is_updated ) {
					delete_user_meta( $wp_user_id, 'ytism_alias_password' );

					Functions::log_debug(
						sprintf(
							'Updated organization data for alias user ID %d: %s',
							(int) $alias_user->get_id(),
							wp_json_encode( $updated_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES )
						)
					);
				} else {
					Functions::log_debug( 'Failed to update organization data for alias user ID ' . $alias_user->get_id() );
				}
			}
		} elseif ( $is_family || $is_individual ) {
			// Family user creation.
			$alias_user_data = $alias_user->get_userdata();

			$user_pass = get_user_meta( $wp_user_id, 'ytism_alias_password', true );
			$password  = ! empty( $user_pass ) ? Functions::decrypt_str( $user_pass ) : null;

			$language_code = apply_filters( 'wpml_current_language', null );
			if ( ! $language_code ) {
				$language_code = get_bloginfo( 'language' ) ? get_bloginfo( 'language' ) : 'en';
			}
			$language_code = strtoupper( $language_code );
			if ( 'EN' === $language_code ) {
				$language_code = 'US';
			}

			$data = [
				'name'                         => $alias_user_data['name'] ?? '',
				'lastName'                     => $alias_user_data['lastName'] ?? '',
				'email'                        => $alias_user->get_email(),
				'password'                     => $password,
				'monthly'                      => ( 'month' === $existing_sub_order->billing_cycle ) ? 1 : 0,
				'planPaymentAmount'            => $existing_sub_order->amount ?? 0,
				'stripeCustomerId'             => $existing_sub_order->customer_id ?? '',
				'stripeSubscriptionId'         => $existing_sub_order->sub_id ?? '',
				'stripePaymentIntentId'        => $existing_sub_order->metadata['lastest_invoice_id'] ?? '',
				'originalValueWithoutDiscount' => $existing_sub_order->amount ?? 0,
				'language'                     => $language_code,
			];

			if ( $existing_sub_order->qty > 1 ) {
				$data['familyMembers'] = $existing_sub_order->qty;

				// Create user via API.
				$api      = new Api();
				$response = $api->create_family_user( $data );
				Functions::log_debug(
					sprintf(
						'Family user creation REQUEST: %s, RESPONSE: %s',
						wp_json_encode( $data ),
						wp_json_encode( $response )
					)
				);

				if ( $response && is_array( $response ) && isset( $response['data']['user'] ) && is_array( $response['data']['user'] ) && ! empty( $response['data']['user'] ) ) {
					$updated_data = $response['data']['user'];
					if ( $response['data']['user']['userId'] ) {
						$updated_data['familyPrimaryUserId'] = $response['data']['user']['userId'] ?? null;
					}

					$new_token = null;
					if ( isset( $response['data']['token'] ) && ! empty( $response['data']['token'] ) ) {
						$new_token = strval( $response['data']['token'] );
					}

					$is_updated = $alias_user->update_user( $updated_data, $new_token );

					if ( $is_updated ) {
						delete_user_meta( $wp_user_id, 'ytism_alias_password' );

						Functions::log_debug( 'Updated alias user data for alias user ID ' . $alias_user->get_id() );
					} else {
						Functions::log_debug( 'Failed to update alias user data for alias user ID ' . $alias_user->get_id() );
					}
				}
			} else {
				// Create user via API.
				$api      = new Api();
				$response = $api->create_individual_user( $data );
				Functions::log_debug(
					sprintf(
						'Individual user creation REQUEST: %s, RESPONSE: %s',
						wp_json_encode( $data ),
						wp_json_encode( $response )
					)
				);

				if ( $response && is_array( $response ) && isset( $response['data']['user'] ) && is_array( $response['data']['user'] ) && ! empty( $response['data']['user'] ) ) {
					$updated_data = $response['data']['user'];

					$new_token = null;
					if ( isset( $response['data']['token'] ) && ! empty( $response['data']['token'] ) ) {
						$new_token = strval( $response['data']['token'] );
					}

					$is_updated = $alias_user->update_user( $updated_data, $new_token );

					if ( $is_updated ) {
						delete_user_meta( $wp_user_id, 'ytism_alias_password' );

						Functions::log_debug( 'Updated alias user data for alias user ID ' . $alias_user->get_id() );
					} else {
						Functions::log_debug( 'Failed to update alias user data for alias user ID ' . $alias_user->get_id() );
					}
				}
			}
		}
	}

	/**
	 * Shortcode: [ytism_page_link page="my_account|checkout|thank_you|terms|privacy|individual_purchase|family_purchase|enterprise_purchase|auth_page"]
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string URL of the specified page.
	 */
	public function shortcode_page_link( $atts = [] ) {
		$atts = shortcode_atts(
			[
				'page'    => '',
				'refresh' => 'false',
			],
			$atts
		);

		$page    = sanitize_text_field( $atts['page'] );
		$refresh = filter_var( $atts['refresh'], FILTER_VALIDATE_BOOLEAN );

		switch ( $page ) {
			case 'individual_purchase':
				$url = $refresh ? Functions::individual_purchase_page_url( '', [ 't' => time() ] ) : Functions::individual_purchase_page_url();
				break;
			case 'family_purchase':
				$url = $refresh ? Functions::family_purchase_page_url( '', [ 't' => time() ] ) : Functions::family_purchase_page_url();
				break;
			case 'enterprise_purchase':
				$url = $refresh ? Functions::enterprise_purchase_page_url( '', [ 't' => time() ] ) : Functions::enterprise_purchase_page_url();
				break;
			case 'my_account':
				$url = $refresh ? Functions::get_myaccount_page_url( '', [ 't' => time() ] ) : Functions::get_myaccount_page_url();
				break;
			case 'checkout':
				$url = $refresh ? Functions::get_checkout_page_url( '', [ 't' => time() ] ) : Functions::get_checkout_page_url();
				break;
			case 'thank_you':
				$url = $refresh ? Functions::get_thankyou_page_url( '', [ 't' => time() ] ) : Functions::get_thankyou_page_url();
				break;
			case 'terms':
				$url = $refresh ? Functions::get_terms_page_url( '', [ 't' => time() ] ) : Functions::get_terms_page_url();
				break;
			case 'privacy':
				$url = $refresh ? Functions::get_privacy_page_url( '', [ 't' => time() ] ) : Functions::get_privacy_page_url();
				break;
			case 'auth_page':
				$url = $refresh ? Functions::get_auth_page_url( '', [ 't' => time() ] ) : Functions::get_auth_page_url();
				break;
			case 'logout':
				$current_url = '';
				if ( isset( $_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI'] ) ) {
					$http_host   = sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) );
					$request_uri = sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) );
					$current_url = ( is_ssl() ? 'https://' : 'http://' ) . $http_host . $request_uri;
				}
				$redirect_to = ! empty( $current_url ) ? $current_url : home_url();
				if ( $refresh ) {
					$redirect_to = add_query_arg( 't', time(), $redirect_to );
				}
				$url = wp_logout_url( $redirect_to );
				break;
			default:
				$url = '';
				break;
		}

		return esc_url( $url );
	}
}
