<?php
namespace YTISM\Public;

use Stripe\StripeClient;
use YTISM\Helpers\Functions;
use YTISM\Database\Factory;
use YTISM\Database\Subscription;
use YTISM\Core\AliasUser;
use YTISM\Core\Api;
use YTISM\Helpers\Stripe_Error_Codes;
use libphonenumber\PhoneNumberUtil;
use libphonenumber\NumberParseException;
use WP_Error;
use Exception;
use WP_REST_Response;
use WP_REST_Request;


if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Front_Functions {
	private $stripe;
	private $payments_table;

	public function __construct() {
		$stripe_secret_key = Functions::get_settings( 'stripe_secret_key' );

		if ( ! empty( $stripe_secret_key ) ) {
			$this->stripe = new \Stripe\StripeClient( $stripe_secret_key );
			\Stripe\Stripe::setApiKey( $stripe_secret_key );
		}

		global $wpdb;
		$this->payments_table = $wpdb->prefix . 'ytism_payments';
	}

	public function init() {
		add_shortcode( 'stripe_subscripti_catalog', [ $this, 'render_subscription_catalog' ] );

		add_action( 'wp_ajax_nopriv_ytism_add_supermanager', array( $this, 'add_supermanager' ) );
		add_action( 'wp_ajax_ytism_add_supermanager', array( $this, 'add_supermanager' ) );

		add_action( 'wp_ajax_nopriv_ytism_redeem_promocode', array( $this, 'redeem_promocode' ) );
		add_action( 'wp_ajax_ytism_redeem_promocode', array( $this, 'redeem_promocode' ) );

		add_action( 'wp_ajax_nopriv_ytism_calculate_price', array( $this, 'calculate_price' ) );
		add_action( 'wp_ajax_ytism_calculate_price', array( $this, 'calculate_price' ) );

		add_action( 'wp_ajax_ytism_download_invoice', array( $this, 'download_invoice' ) );
		add_action( 'wp_ajax_nopriv_ytism_download_invoice', array( $this, 'download_invoice' ) );

		add_action( 'wp_ajax_ytism_cancel_payment', array( $this, 'cancel_payment' ) );
		add_action( 'wp_ajax_nopriv_ytism_cancel_payment', array( $this, 'cancel_payment' ) );

		add_action( 'wp_ajax_ytism_submit_question_answers', array( $this, 'submit_question_answers' ) );
		add_action( 'wp_ajax_nopriv_ytism_submit_question_answers', array( $this, 'submit_question_answers' ) );
	}

	/**
	 * Add Super Manager via AJAX
	 *
	 * @return void
	 */
	public function add_supermanager() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_add_supermanager_nonce' ) ) {
			$return = [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];

			if ( $return['success'] ) {
				wp_send_json_success( $return );
			} else {
				wp_send_json_error( $return );
			}
		}

		$phone_util   = PhoneNumberUtil::getInstance();
		$first_name   = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name    = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$email        = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$phone_number = isset( $_POST['phone_number_full'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number_full'] ) ) : ( isset( $_POST['phone_number'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number'] ) ) : '' );
		$terms        = isset( $_POST['terms'] ) ? (bool) $_POST['terms'] : false;
		$errors       = [];

		$filtered = apply_filters(
			'ytism_add_supermanager_data',
			[
				'first_name'   => $first_name,
				'last_name'    => $last_name,
				'email'        => $email,
				'phone_number' => $phone_number,
				'terms'        => $terms,
				'errors'       => [],
				'response'     => null,
				'stage'        => 'before_validation',
			]
		);

		// overwrite if filtered changed.
		$first_name   = $filtered['first_name'];
		$last_name    = $filtered['last_name'];
		$email        = $filtered['email'];
		$phone_number = $filtered['phone_number'];
		$terms        = $filtered['terms'];

		if ( empty( $first_name ) ) {
			$errors['first_name'] = __( 'First name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $first_name ) ) {
			$errors['first_name'] = __( 'Please enter a valid first name.', 'ytism' );
		}
		if ( empty( $last_name ) ) {
			$errors['last_name'] = __( 'Last name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $last_name ) ) {
			$errors['last_name'] = __( 'Please enter a valid last name.', 'ytism' );
		}
		if ( empty( $email ) || ! is_email( $email ) ) {
			$errors['email'] = __( 'Valid email address is required.', 'ytism' );
		}

		$country_code    = null;
		$national_number = null;
		if ( empty( $phone_number ) ) {
			$errors['phone_number'] = __( 'Phone number is required.', 'ytism' );
		} else {
			try {
				if ( strpos( $phone_number, '+' ) === 0 ) {
					$parsed_number = $phone_util->parse( $phone_number, $this->default_country );
				} else {
					$parsed_number = $phone_util->parse( $phone_number );
				}

				if ( $phone_util->isValidNumber( $parsed_number ) ) {
					$country_code    = $parsed_number->getCountryCode();
					$national_number = $parsed_number->getNationalNumber();
				} else {
					$errors['phone_number'] = __( 'Invalid phone number.', 'ytism' );
				}
			} catch ( NumberParseException $e ) {
				$errors['phone_number'] = __( 'Invalid phone number format.', 'ytism' );
			}
		}
		if ( ! $terms ) {
			$errors['terms'] = __( 'You must agree to the terms.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			$return = apply_filters(
				'ytism_add_supermanager_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];

			if ( $return['success'] ) {
				wp_send_json_success( $return );
			} else {
				wp_send_json_error( $return );
			}
		}

		$alias_user       = new AliasUser( get_current_user_id() );
		$organization_id  = '';
		$has_subscription = false;

		if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() && $alias_user->is_enterprise_user() ) {
			$alias_user_data  = $alias_user->get_userdata();
			$organization_id  = $alias_user_data['organization']['organizationId'] ?? '';
			$has_subscription = $alias_user->has_active_subscription();
		}

		if ( ! $has_subscription || empty( $organization_id ) ) {
			$return = apply_filters(
				'ytism_add_supermanager_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'You must have an active Enterprise subscription to add a Super Manager.', 'ytism' ),
							'errors'  => [],
						],
						'stage'    => 'no_active_subscription',
					]
				)
			)['response'];

			if ( $return['success'] ) {
				wp_send_json_success( $return );
			} else {
				wp_send_json_error( $return );
			}
		}

		$total_supermanagers = intval( get_user_meta( get_current_user_id(), 'ytism_total_supermanagers', true ) );
		$max_supermanagers   = intval( Functions::get_settings( 'enterprise_max_supermanagers', 5 ) );
		if ( $total_supermanagers >= $max_supermanagers ) {
			$return = apply_filters(
				'ytism_add_supermanager_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => sprintf(
								/* translators: %d: maximum number of super managers allowed. */
								__( 'You have reached the maximum number of super managers allowed for your plan. You can add maximum %d users.', 'ytism' ),
								$max_supermanagers
							),
							'errors'  => [],
						],
						'stage'    => 'max_supermanagers_reached',
					]
				)
			)['response'];

			if ( $return['success'] ) {
				wp_send_json_success( $return );
			} else {
				wp_send_json_error( $return );
			}
		}

		// Create super manager via API.
		$api      = new Api();
		$response = $api->create_super_manager(
			[
				'organizationId' => $organization_id,
				'firstName'      => $first_name,
				'lastName'       => $last_name,
				'email'          => $email,
				'countryCode'    => $country_code,
				'phoneNumber'    => $national_number,
			]
		);

		$response_data = is_array( $response ) && isset( $response['data'] ) ? $response['data'] : [];

		if ( is_array( $response_data ) && isset( $response_data['totalSuperManagers'] ) ) {
			$total = intval( $response_data['totalSuperManagers'] );
			update_user_meta( get_current_user_id(), 'ytism_total_supermanagers', $total );

			if ( $total >= $max_supermanagers ) {
				$message = $total === $max_supermanagers
					? __( 'Super Manager added successfully. You have reached the maximum number of Super Managers allowed for your plan.', 'ytism' )
					: sprintf(
						/* translators: %d: maximum number of super managers allowed. */
						_n( 'Super Manager added successfully. You now have %d Super Manager.', 'Super Manager added successfully. You now have %d Super Managers.', $total, 'ytism' ),
						$total
					);
			} else {
				$message = sprintf(
					/* translators: %d: remaining number of super managers that can be added. */
					_n( 'Super Manager added successfully. You can add %d more super manager.', 'Super Manager added successfully. You can add %d more super managers.', ( $max_supermanagers - $total ), 'ytism' ),
					$max_supermanagers - $total
				);
			}

			$return = apply_filters(
				'ytism_add_supermanager_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => true,
							'message' => $message,
							'errors'  => [],
						],
						'stage'    => 'supermanager_added',
					]
				)
			)['response'];
		} else {
			$message = $response_data['message'] ?? __( 'An error occurred while adding the Super Manager. Please try again later.', 'ytism' );

			$return = apply_filters(
				'ytism_add_supermanager_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $message,
							'errors'  => [],
						],
						'stage'    => 'api_error',
					]
				)
			)['response'];
		}

		if ( $return['success'] ) {
			wp_send_json_success( $return );
		} else {
			wp_send_json_error( $return );
		}

		wp_die();
	}

	public function redeem_promocode() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_apply_promocode_nonce' ) ) {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
				]
			);
		}

		$promo_code = isset( $_POST['promo_code'] ) ? sanitize_text_field( wp_unslash( $_POST['promo_code'] ) ) : '';
		$email      = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';

		$filtered = apply_filters(
			'ytism_redeem_promocode_data',
			[
				'promo_code' => $promo_code,
				'email'      => $email,
				'response'   => null,
				'stage'      => 'before_validation',
			]
		);

		// overwrite if filtered changed.
		$promo_code = $filtered['promo_code'];
		$email      = $filtered['email'];

		$api      = new Api();
		$response = $api->validate_redeem_code( $promo_code, $email );

		$return = apply_filters(
			'ytism_redeem_promocode_data',
			array_merge(
				$filtered,
				[
					'response' => $response,
					'stage'    => 'after_api_call',
				]
			)
		)['response'];

		if ( $return['success'] ) {
			wp_send_json_success( $return );
		} else {
			wp_send_json_error( $return );
		}

		wp_die();
	}

	public function calculate_price() {
		check_ajax_referer( 'stripe_price_calculation_nonce', 'nonce' );

		$price_id = sanitize_text_field( $_POST['price_id'] ?? '' );
		$quantity = intval( $_POST['quantity'] ?? 0 );
		$currency = sanitize_text_field( $_POST['currency'] ?? '' );
		$plan     = sanitize_text_field( $_POST['plan'] ?? '' );

		// Validate plan and quantity in one pass.
		$plan_rules = [
			'individual' => function ( $q ) {
				return $q === 1; },
			'family'     => function ( $q ) {
				return $q >= 2 && $q <= 5; },
			'enterprise' => function ( $q ) {
				return $q >= 1; },
		];

		if ( empty( $plan ) || ! isset( $plan_rules[ $plan ] ) || ! $plan_rules[ $plan ]( $quantity ) ) {
			$messages = [
				'individual' => __( 'Individual plan allows only 1 user.', 'ytism' ),
				'family'     => __( 'Family plan allows between 2 to 5 users.', 'ytism' ),
				'enterprise' => __( 'Enterprise plan requires at least 2 users.', 'ytism' ),
			];
			wp_send_json_error(
				[
					'message' => $messages[ $plan ] ?? __( 'Invalid plan type or quantity.', 'ytism' ),
				]
			);
		}

		if ( ! $price_id || $quantity < 1 || ! $currency ) {
			wp_send_json_error(
				[
					'message' => __( 'Invalid parameters provided.', 'ytism' ),
				]
			);
		}

		$product = new \YTISM\Core\Product( $plan, false );
		if ( ! $product instanceof \YTISM\Core\Product || $product->has_error() ) {
			wp_send_json_error(
				[
					'message' => __( 'Error retrieving product details.', 'ytism' ),
				]
			);
		}

		$price = $product->get_price( $price_id );
		if ( ! $price instanceof \YTISM\Core\Price || $price->has_error() ) {
			wp_send_json_error(
				[
					'message' => __( 'Error retrieving price details.', 'ytism' ),
				]
			);
		}

		$calculated_amounts = $price->calculate_total_for_currency( $quantity, $currency );
		if ( is_wp_error( $calculated_amounts ) ) {
			wp_send_json_error(
				[
					'message' => sprintf( __( 'Error calculating price: %s', 'ytism' ), $calculated_amounts->get_error_message() ),
				]
			);
		}

		wp_send_json_success(
			[
				'price_per_unit_display'  => $calculated_amounts['price_per_unit'],
				'subtotal_display'        => $calculated_amounts['subtotal'],
				'tax_fees_display'        => $calculated_amounts['tax_fees'],
				'total_display'           => $calculated_amounts['total'],
				'price_description'       => $calculated_amounts['price_description'],
				'recurring_interval'      => $calculated_amounts['recurring_interval'],
				'recurring_interval_i18n' => $calculated_amounts['recurring_interval_i18n'],
				'zero_price'              => $calculated_amounts['zero_price'],
				'price_name'              => $price->get_name(),
			]
		);
		wp_die();
	}

	public function create_subscription() {
		check_ajax_referer( 'ytism_create_subscription_nonce', 'nonce' );

		if ( ! is_user_logged_in() ) {
			wp_send_json_error( [ 'message' => __( 'You must be logged in to subscribe.', 'ytism' ) ] );
			return;
		}

		$price_id = sanitize_text_field( $_POST['price_id'] ?? '' );
		$quantity = max( 1, intval( $_POST['quantity'] ?? 1 ) );
		$currency = strtolower( sanitize_text_field( $_POST['currency'] ?? 'usd' ) );
		$plan     = sanitize_text_field( $_POST['plan'] ?? '' );

		// Validate parameters early.
		$valid_plans = [ 'individual', 'family', 'enterprise' ];
		if ( ! $price_id || $quantity < 1 || ! $currency || ! in_array( $plan, $valid_plans, true ) ) {
			wp_send_json_error(
				[
					'message'    => __( 'Missing or invalid subscription parameters. Please select a valid plan, quantity, and currency before proceeding.', 'ytism' ),
					'error_type' => 'invalid_parameters',
				]
			);
			return;
		}

		if ( ! $this->stripe ) {
			wp_send_json_error(
				[
					'message'    => __( 'Payment system not configured. Please contact support.', 'ytism' ),
					'error_type' => 'system',
				]
			);
			return;
		}

		// Plan rules.
		$plan_rules    = [
			'individual' => fn( $q ) => $q === 1,
			'family'     => fn( $q ) => $q >= 2 && $q <= 5,
			'enterprise' => fn( $q ) => $q >= 20 && $q <= 50,
		];
		$plan_messages = [
			'individual' => __( 'Individual plan allows only 1 user.', 'ytism' ),
			'family'     => __( 'Family plan allows between 2 to 5 users.', 'ytism' ),
			'enterprise' => __( 'Enterprise plan allows between 20 to 50 users.', 'ytism' ),
		];

		if ( ! isset( $plan_rules[ $plan ] ) || ! $plan_rules[ $plan ]( $quantity ) ) {
			wp_send_json_error(
				[
					'message'    => $plan_messages[ $plan ] ?? __( 'Invalid plan type or quantity.', 'ytism' ),
					'error_type' => 'invalid_quantity',
				]
			);
			return;
		}

		$wp_user_id = get_current_user_id();
		$full_name  = $user_email = $organization_name = null;
		$has_trial  = false;

		// AliasUser validation.
		$alias_user = new AliasUser( $wp_user_id );
		$alias_ok  = $alias_user && $alias_user->exists();

		if ( ! $alias_ok ) {
			wp_send_json_error(
				[
					'message'    => __( 'User data not found. Please ensure your profile is complete.', 'ytism' ),
					'error_type' => 'user_not_found',
				]
			);
			return;
		}

		// Validate price id associated with user's plan.
		$product = new \YTISM\Core\Product( $plan, false );
		if ( ! $product || ! $product instanceof \YTISM\Core\Product || $product->has_error() ) {
			wp_send_json_error(
				[
					'message'    => __( 'Error retrieving product details.', 'ytism' ),
					'error_type' => 'product',
				]
			);
			return;
		}

		$price = $product->get_price( $price_id );
		if ( ! $price || ! $price instanceof \YTISM\Core\Price || $price->has_error() ) {
			wp_send_json_error(
				[
					'message'    => __( 'Error retrieving price details.', 'ytism' ),
					'error_type' => 'price',
				]
			);
			return;
		}

		if ( $plan === 'enterprise' ) {
			if ( $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() && ! $alias_user->is_individual_user() ) {
				$alias_user_data     = $alias_user->get_userdata();
				$full_name         = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email        = $alias_user->get_email();
				$organization_name = $alias_user_data['organizationName'] ?? '';

				if ( $alias_user->has_active_subscription() ) {
					wp_send_json_error(
						[
							'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Enterprise plan.', 'ytism' ),
							'error_type' => 'existing_subscription',
						]
					);
					return;
				}
			} else {
				wp_send_json_error(
					[
						'message'    => __( 'User data not found or invalid for Enterprise plan.', 'ytism' ),
						'error_type' => 'user_data',
					]
				);
				return;
			}
		} elseif ( $plan === 'family' ) {
			if ( $alias_user->is_individual_user() && ! $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() ) {
				$alias_user_data = $alias_user->get_userdata();
				$full_name     = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email    = $alias_user->get_email();

				if ( $alias_user->has_active_subscription() ) {
					wp_send_json_error(
						[
							'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Family plan.', 'ytism' ),
							'error_type' => 'existing_subscription',
						]
					);
					return;
				}
			} else {
				wp_send_json_error(
					[
						'message'    => __( 'User data not found or invalid for Family plan.', 'ytism' ),
						'error_type' => 'user_data',
					]
				);
				return;
			}
		} elseif ( $plan === 'individual' ) {
			if ( $price->get_recurring_interval() === 'year' ) {
				$has_trial = true;
			}
			if ( $alias_user->is_individual_user() && ! $alias_user->is_enterprise_user() && ! $alias_user->is_family_user() ) {
				$alias_user_data = $alias_user->get_userdata();
				$full_name     = trim( ( $alias_user_data['name'] ?? '' ) . ' ' . ( $alias_user_data['lastName'] ?? '' ) );
				$user_email    = $alias_user->get_email();

				if ( $alias_user->has_active_subscription() ) {
					wp_send_json_error(
						[
							'message'    => __( 'You already have an active subscription. Please cancel it before subscribing to the Individual plan.', 'ytism' ),
							'error_type' => 'existing_subscription',
						]
					);
					return;
				}
			} else {
				wp_send_json_error(
					[
						'message'    => __( 'User data not found or invalid for Individual plan.', 'ytism' ),
						'error_type' => 'user_data',
					]
				);
				return;
			}
		}

		if ( ! is_email( $user_email ) ) {
			wp_send_json_error(
				[
					'message'    => __( 'Valid email not found for user. Please update your profile with a valid email address.', 'ytism' ),
					'error_type' => 'email',
				]
			);
			return;
		}

		$customer      = null;
		$customer_data = get_user_meta( $wp_user_id, 'ytism_stripe_customer_data', true );
		$customer_id   = ( is_array( $customer_data ) && ! empty( $customer_data[ $currency ] ) ) ? $customer_data[ $currency ] : null;

		// Get existing customer.
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

		// Search existing customer by email and metadata.
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

		// Create new customer if not found.
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

				wp_send_json_error(
					[
						'message'    => __( 'Failed to create customer. Please try again.', 'ytism' ),
						'error_type' => 'customer_creation',
					]
				);
				return;
			}
		}

		if ( empty( $customer->id ) ) {
			wp_send_json_error(
				[
					'message'    => __( 'Customer not found or could not be created. Please contact support.', 'ytism' ),
					'error_type' => 'customer_creation',
				]
			);
			return;
		}

		// Save customer ID to user meta.
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
				/*
				$trial_minutes = 10;
				$trial_seconds = $trial_minutes * 60;
				$current_time = time();
				$trial_end = $current_time + $trial_seconds;
				$stripe_subs_data['trial_end'] = $trial_end;
				*/

				$stripe_subs_data['trial_period_days'] = 7;
				$stripe_subs_data['expand'][]          = 'pending_setup_intent';
				$stripe_subs_data['trial_settings']    = [ 'end_behavior' => [ 'missing_payment_method' => 'cancel' ] ]; // Crucial to avoid auto-conversion to active
			}

			$stripe_subs = $this->stripe->subscriptions->create( $stripe_subs_data );

			$items = $stripe_subs->items->data ?? [];
			if ( ! $stripe_subs || ! isset( $stripe_subs->id ) || ! $items || count( $items ) === 0 ) {
				wp_send_json_error(
					[
						'message'    => __( 'Subscription has no items. Please contact support.', 'ytism' ),
						'error_type' => 'no_items',
					]
				);
				return;
			}

			if ( count( $items ) > 1 ) {
				wp_send_json_error(
					[
						'message'    => __( 'Multiple subscription items are not supported.', 'ytism' ),
						'error_type' => 'multiple_items',
					]
				);
				return;
			}

			$latest_invoice = $stripe_subs->latest_invoice;
			if ( ! $latest_invoice || ! isset( $latest_invoice->id ) ) {
				wp_send_json_error(
					[
						'message'    => __( 'Failed to retrieve invoice for subscription. Please contact support.', 'ytism' ),
						'error_type' => 'invoice_creation',
					]
				);
				return;
			}

			$client_secret = $latest_invoice->confirmation_secret->client_secret ?? null;
			if ( $stripe_subs->status === 'trialing' ) {
				$client_secret = $stripe_subs->pending_setup_intent->client_secret ?? null;
			}

			if ( ! $client_secret ) {
				wp_send_json_error(
					[
						'message'    => __( 'Failed to initiate payment. Please try again.', 'ytism' ),
						'error_type' => 'invalid_client_secret',
					]
				);
				return;
			}

			$intent = $this->get_intent_from_client_secret( $client_secret );
			if ( ! $intent || is_wp_error( $intent ) || ! isset( $intent->id ) ) {
				wp_send_json_error(
					[
						'message'    => __( 'Failed to initiate payment. Please try again.', 'ytism' ),
						'error_type' => 'invalid_intent',
					]
				);
				return;
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
				wp_send_json_error(
					[
						'message'    => __( 'Failed to retrieve subscription period. Please contact support.', 'ytism' ),
						'error_type' => 'invalid_period',
					]
				);
				return;
			}
			if ( ! $current_period_start ) {
				$current_period_start = time();
			}

			/**
			 * Create subscription record in local DB
			 */
			$sub_handler       = new \YTISM\Database\Subscription_Handler();
			$txn_handler       = new \YTISM\Database\Transaction_Handler();
			$sub_order_handler = new \YTISM\Database\Sub_Order();

			$trail_start = null;
			$trial_end   = null;
			if ( $stripe_subs->status === 'trialing' ) {
				if ( $stripe_subs->trial_start ) {
					$trail_start = date( 'Y-m-d H:i:s', $stripe_subs->trial_start );
				} else {
					$trail_start = date( 'Y-m-d H:i:s', $current_period_start );
				}
				if ( $stripe_subs->trial_end ) {
					$trial_end = date( 'Y-m-d H:i:s', $stripe_subs->trial_end );
				} else {
					$trial_end = date( 'Y-m-d H:i:s', $current_period_end );
				}
			}

			$sub_order_id = $sub_order_handler->create(
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
					'amount'           => Functions::format_stripe_amount( $latest_invoice->total, $latest_invoice->currency ),
					'currency'         => strtoupper( $latest_invoice->currency ),
					'period_start'     => date( 'Y-m-d H:i:s', $current_period_start ),
					'period_end'       => date( 'Y-m-d H:i:s', $current_period_end ),
					'next_billing_at'  => date( 'Y-m-d H:i:s', $current_period_end ),
					'trial_start_at'   => $trail_start,
					'trial_end_at'     => $trial_end,
					'billing_cycle'    => $billing_period,
					'billing_interval' => $billing_interval,
					'metadata'         => [
						'has_trial' => ( $stripe_subs->status === 'trialing' ) ? true : false,
					],
				],
				$stripe_subs->created ?? time()
			);

			if ( ! $sub_order_id || is_wp_error( $sub_order_id ) ) {
				// rollback entire subscription.
				try {
					$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
				} catch ( \Stripe\Exception\ApiErrorException $e ) {
					Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
				}

				wp_send_json_error(
					[
						'message'    => $sub_order_id instanceof \WP_Error ? $sub_order_id->get_error_message() : __( 'Failed to create subscription order. Please contact support.', 'ytism' ),
						'error_type' => 'subscription_order',
					]
				);
				return;
			}

			$sub_id = $sub_handler->create(
				[
					'user_id'          => $wp_user_id,
					'gateway_sub_id'   => $stripe_subs->id,
					'gateway'          => 'stripe',
					'status'           => 'incomplete',
					'plan_id'          => $stripe_subs->plan->id ?? null,
					'customer_id'      => $stripe_subs->customer ?? null,
					'qty'              => $stripe_subs->quantity ?? $quantity,
					'period_start'     => date( 'Y-m-d H:i:s', $current_period_start ),
					'period_end'       => date( 'Y-m-d H:i:s', $current_period_end ),
					'next_billing_at'  => date( 'Y-m-d H:i:s', $current_period_end ),
					'trial_start_at'   => $trail_start,
					'trial_end_at'     => $trial_end,
					'billing_cycle'    => $billing_period,
					'billing_interval' => $billing_interval,
					'metadata'         => wp_json_encode(
						[
							'has_trial' => ( $stripe_subs->status === 'trialing' ) ? true : false,
						]
					),
				]
			);

			if ( $sub_id ) {
				// Create payment record.
				$txn_id = $txn_handler->create(
					[
						'sub_id'            => $sub_id,
						'gateway'           => 'stripe',
						'gateway_txn_id'    => $latest_invoice->id,
						'gateway_intent_id' => $intent->id,
						'status'            => 'pending',
						'type'              => 'initial',
						'amount'            => Functions::format_stripe_amount( $latest_invoice->total, $latest_invoice->currency ),
						'currency'          => strtoupper( $latest_invoice->currency ),
						'payment_method_id' => null,
						'processed_at'      => null,
						'gateway_data'      => wp_json_encode(
							[
								'subscription_id'  => $stripe_subs->id,
								'intent_id'        => $intent->id,
								'has_trial'        => ( $stripe_subs->status === 'trialing' ) ? true : false,
								'invoice_pdf_link' => $latest_invoice->invoice_pdf,
							]
						),
					]
				);

				if ( $txn_id ) {
					$sub_handler->update(
						$sub_id,
						[
							'last_txn_id' => $txn_id,
						]
					);

					// Add metadata to payment intent/setup intent.
					if ( $stripe_subs->status !== 'trialing' ) {
						try {
							$this->stripe->paymentIntents->update(
								$intent->id,
								[
									'metadata' => [
										'wp_user_id'   => (string) $wp_user_id,
										'sub_order_id' => (string) $sub_order_id,
										'sub_id'       => (string) $sub_id,
										'txn_id'       => (string) $txn_id,
									],
								]
							);
						} catch ( \Stripe\Exception\ApiErrorException $e ) {
							Functions::log_debug( 'Stripe payment intent metadata update error: ' . $e->getMessage() );

							// rollback entire subscription.
							$txn_handler->delete( $txn_id );
							$sub_handler->delete( $sub_id );
							try {
								$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
							} catch ( \Stripe\Exception\ApiErrorException $e ) {
								Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );

								wp_send_json_error(
									[
										'message'    => __( 'Failed to create payment record. Please contact support.', 'ytism' ),
										'error_type' => 'payment_intent_metadata',
									]
								);
								return;
							}
						}
					} else {
						try {
							$this->stripe->setupIntents->update(
								$intent->id,
								[
									'metadata' => [
										'wp_user_id'   => (string) $wp_user_id,
										'sub_order_id' => (string) $sub_order_id,
										'sub_id'       => (string) $sub_id,
										'txn_id'       => (string) $txn_id,
									],
								]
							);
						} catch ( \Stripe\Exception\ApiErrorException $e ) {
							Functions::log_debug( 'Stripe setup intent metadata update error: ' . $e->getMessage() );

							// rollback entire subscription.
							$txn_handler->delete( $txn_id );
							$sub_handler->delete( $sub_id );
							try {
								$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
							} catch ( \Stripe\Exception\ApiErrorException $e ) {
								Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
							}

							wp_send_json_error(
								[
									'message'    => __( 'Failed to create payment record. Please contact support.', 'ytism' ),
									'error_type' => 'setup_intent_metadata',
								]
							);
							return;
						}
					}

					// Send success response.
					$description = ( $stripe_subs->status === 'trialing' )
						? sprintf( __( 'Your subscription order is created with a 7-day free trial. To activate your subscription, please set up your payment method. You will not be charged until the trial ends, after which %s will be automatically charged.', 'ytism' ), Functions::format_stripe_price( $latest_invoice->total, $latest_invoice->currency ) )
						: __( 'Your subscription order is created and is awaiting payment. Please complete your payment to activate your subscription and enjoy full access.', 'ytism' );

					// cancel setup intent for testing.
					// $this->stripe->setupIntents->cancel($intent->id, []);.

					wp_send_json_success(
						[
							'sub_order_id'     => $sub_order_id,
							'order_id'         => $sub_id,
							'intent_id'        => $intent->id,
							'payment_id'       => $txn_id,
							'client_secret'    => $client_secret,
							'has_trial'        => ( $stripe_subs->status === 'trialing' ) ? true : false,
							'trial_expires_at' => $trial_end,
							'plan'             => $plan,
							'invoice'          => [
								'invoice_id'   => $latest_invoice->id,
								'amount_due'   => Functions::format_stripe_price( $latest_invoice->total, $latest_invoice->currency ),
								'currency'     => strtoupper( $latest_invoice->currency ),
								'due_date'     => date_i18n( get_option( 'date_format' ), $latest_invoice->due_date ?? time() ),
								'account_name' => $latest_invoice->account_name ?? get_bloginfo( 'name' ),
								'description'  => $latest_invoice->description ?? $description,
							],
						]
					);
					return;
				} else {
					$sub_handler->delete( $sub_id );
					try {
						$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
					} catch ( \Stripe\Exception\ApiErrorException $e ) {
						Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
					}

					wp_send_json_error(
						[
							'message'    => __( 'Failed to create payment record. Please contact support.', 'ytism' ),
							'error_type' => 'db_error',
						]
					);
					return;
				}
			} else {
				// Rollback Stripe subscription if DB insert fails.
				try {
					$this->stripe->subscriptions->cancel( $stripe_subs->id, [] );
				} catch ( \Stripe\Exception\ApiErrorException $e ) {
					Functions::log_debug( 'Stripe subscription rollback error: ' . $e->getMessage() );
				}

				wp_send_json_error(
					[
						'message'    => __( 'Failed to create order record. Please contact support.', 'ytism' ),
						'error_type' => 'db_error',
					]
				);
				return;
			}
		} catch ( \Stripe\Exception\ApiErrorException $e ) {
			Functions::log_debug( 'Stripe subscription creation error: ' . $e->getMessage() );

			wp_send_json_error(
				[
					'message'    => __( 'Payment service error: ', 'ytism' ) . $e->getMessage(),
					'error_type' => 'subscription_creation',
				]
			);
			return;
		} catch ( Exception $e ) {
			Functions::log_debug( 'General error during subscription creation: ' . $e->getMessage() );

			wp_send_json_error(
				[
					'message'    => __( 'An unexpected error occurred. Please try again.', 'ytism' ),
					'error_type' => 'general',
				]
			);
			return;
		}

		wp_send_json_error(
			[
				'message'    => __( 'An unexpected error occurred. Please try again later.', 'ytism' ),
				'error_type' => 'general',
			]
		);

		wp_die();
	}

	public function download_invoice() {
		try {
			check_ajax_referer( 'ytism_download_invoice_nonce', 'nonce' );

			if ( ! is_user_logged_in() ) {
				wp_die( __( 'Authentication required.', 'ytism' ) );
			}

			if ( ! $this->stripe ) {
				wp_die( __( 'Payment system not configured.', 'ytism' ) );
			}

			$invoice_id = sanitize_text_field( $_GET['invoice_id'] ?? '' );
			if ( empty( $invoice_id ) ) {
				wp_die( __( 'Invalid invoice ID.', 'ytism' ) );
			}

			try {
				$invoice = $this->stripe->invoices->retrieve( $invoice_id );
				if ( ! empty( $invoice->invoice_pdf ) ) {
					wp_redirect( $invoice->invoice_pdf );
					exit;
				} else {
					wp_die( __( 'PDF not available for this invoice.', 'ytism' ) );
				}
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'Invoice retrieval error: ' . $e->getMessage() );
				wp_die( __( 'Failed to retrieve invoice. Please try again.', 'ytism' ) );
			}
		} catch ( \Exception $e ) {
			Functions::log_debug( 'Download invoice error: ' . $e->getMessage() );
			wp_die( __( 'Failed to download invoice. Please contact support.', 'ytism' ) );
		}
	}

	public function cancel_payment() {
		check_ajax_referer( 'ytism_cancel_subscription_nonce', 'nonce' );

		if ( ! is_user_logged_in() ) {
			wp_send_json_error( [ 'message' => __( 'You must be logged in to perform this action.', 'ytism' ) ] );
			return;
		}

		$sub_order_id = isset( $_POST['sub_order_id'] ) ? intval( $_POST['sub_order_id'] ) : 0;
		if ( $sub_order_id <= 0 ) {
			wp_send_json_error( [ 'message' => __( 'Invalid parameters provided.', 'ytism' ) ] );
			return;
		}

		$sub_order_handler = new \YTISM\Database\Sub_Order();
		$existing_order    = $sub_order_handler->get( $sub_order_id );

		if ( ! $existing_order || null === $existing_order || ! ( $existing_order instanceof \YTISM\Core\Sub_Order ) || 'incomplete' !== $existing_order->sub_status || get_current_user_id() !== (int) $existing_order->user_id || ! in_array( $existing_order->last_txn_status, [ 'pending', 'failed' ], true ) ) {
			wp_send_json_error( [ 'message' => __( 'No incomplete order found for the provided order.', 'ytism' ) ] );
			return;
		}

		$deleted_order = $sub_order_handler->delete( $existing_order->ID );

		// Also cancel subscription in stripe if exists.
		if ( $this->stripe && ! empty( $existing_order->sub_id ) ) {
			try {
				$this->stripe->subscriptions->cancel( $existing_order->sub_id, [] );
			} catch ( \Stripe\Exception\ApiErrorException $e ) {
				Functions::log_debug( 'Stripe subscription cancellation error: ' . $e->getMessage() );
			}
		}

		if ( is_wp_error( $deleted_order ) ) {
			wp_send_json_error( [ 'message' => __( 'Error cancelling the payment. Please try again.', 'ytism' ) ] );
			return;
		}

		wp_send_json_success( [ 'message' => __( 'Payment cancelled successfully.', 'ytism' ) ] );
		wp_die();
	}

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

	public function submit_question_answers() {
		if ( ! is_user_logged_in() ) {
			wp_send_json_error( [ 'message' => __( 'You must be logged in to submit your answers.', 'ytism' ) ] );
			wp_die();
		}

		$step = intval( $_POST['step'] ?? 0 );
		if ( ! isset( $_POST['_wpnonce'] ) || ! wp_verify_nonce( $_POST['_wpnonce'], "ytism_questions_part_{$step}" ) ) {
			wp_send_json_error( [ 'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ) ] );
			wp_die();
		}

		$action    = sanitize_text_field( $_POST['submit_action'] ?? '' );
		$user_meta = get_user_meta( get_current_user_id(), 'ytism_question_answers', true );
		$user_meta = is_array( $user_meta ) ? $user_meta : [
			'meditator'      => '',
			'binaural_beats' => '',
			'goals'          => [],
			'about_app'      => [],
		];

		if ( $action === 'submit' ) {
			foreach ( [ 'meditator', 'binaural_beats' ] as $field ) {
				if ( isset( $_POST[ $field ] ) ) {
					$user_meta[ $field ] = sanitize_text_field( $_POST[ $field ] );
				}
			}
			foreach ( [ 'goals', 'about_app' ] as $field ) {
				if ( isset( $_POST[ $field ] ) && is_array( $_POST[ $field ] ) ) {
					$user_meta[ $field ] = array_map( 'sanitize_text_field', $_POST[ $field ] );
				}
			}
		}

		// Save or update user meta.
		update_user_meta( get_current_user_id(), 'ytism_question_answers', $user_meta );

		$next_step = $step + 1;
		if ( $step === 1 || $step === 2 ) {
			ob_start();
			echo do_shortcode( "[ytism_questions step=\"{$next_step}\"]" );
			$response_html = ob_get_clean();
			$message       = __( 'Proceeding to the next step.', 'ytism' );
		} else {
			ob_start();
			echo do_shortcode( '[ytism_thank_you]' );
			$response_html = ob_get_clean();
			$message       = ( $action === 'submit' )
				? __( 'Your answers have been submitted successfully.', 'ytism' )
				: __( 'No action taken.', 'ytism' );
		}

		$response = [
			'message'       => $message,
			'response_html' => $response_html,
		];

		if ( $step >= 3 ) {
			$response['redirect_url'] = Functions::get_thankyou_page_url( '', [ 't' => time() ] );
		}

		wp_send_json_success( $response );
		wp_die();
	}


	public function render_subscription_catalog() {

		ob_start();

		echo '<pre>';
		/*$sub_order_handler = new \YTISM\Database\Sub_Order();
		$existing_sub_order = $sub_order_handler->get( 2 );

		if ( $existing_sub_order && $existing_sub_order instanceof \YTISM\Core\Sub_Order ) {
			//$arr_data = $existing_sub_order->to_array();

			


			var_dump( $existing_sub_order );
			//var_dump( $arr_data );



		}
			*/

		var_dump( Functions::get_user_ip() );
		var_dump( Functions::get_user_location() );
		var_dump( Functions::get_user_country() );

		$user_currency = Functions::get_user_currency( 'USD' );
		$product       = new \YTISM\Core\Product( 'individual', false, $user_currency );
		$initial_currency = $product->get_initiate_checkout_currency();
		var_dump( $user_currency );
		var_dump( $initial_currency );

		foreach ( $product->get_prices() as $price_index => $price ) {
			/* Skip invalid price objects early. */
			if ( ! $price || ! $price instanceof \YTISM\Core\Price || $price->has_error() ) {
				continue;
			}
			
			$calculated_amounts = $price->calculate_total_for_currency( 1, $initial_currency );

			var_dump( $calculated_amounts );
			var_dump( $price->get_object() );
		}

		

		/*$update = $sub_order_handler->update(
			14,
			[
				'last_txn_status' => 'success',
			]
		);

		if ( is_wp_error( $update ) ) {
			var_dump( $update->get_error_message() );
		} else {
			var_dump( $update );
		}*/

		echo '</pre>';

		return ob_get_clean();
	}
}
