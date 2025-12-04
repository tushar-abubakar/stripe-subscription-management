<?php
/**
 * Settings Page Class
 *
 * @package YTISM
 * @subpackage Admin
 */

namespace YTISM\Admin;

use YTISM\Database\Subscription_Handler;
use YTISM\Database\Transaction_Handler;
use YTISM\Database\Log_Handler;
use Stripe\Stripe;
use Stripe\Price;
use Stripe\Product;
use Stripe\Account;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Settings
 *
 * Manages the admin settings page and related functionalities.
 */
class Settings {

	private $option_name = 'ytism_settings';

	public function init() {
		add_action( 'admin_menu', [ $this, 'add_menu' ] );
		add_filter( 'set-screen-option', [ $this, 'set_screen_option' ], 10, 3 );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
		add_action( 'update_option_' . $this->option_name, [ $this, 'on_update_setting' ], 10, 2 );
		add_action( 'transition_post_status', [ $this, 'post_status_changed' ], 10, 3 );
		add_action( 'admin_head', [ $this, 'menu_admin_styles' ] );

		add_action( 'wp_ajax_ytism_test_stripe_api', [ $this, 'handle_test_stripe_api' ] );
	}

	public function add_menu() {
		$main_page = add_menu_page(
			'YouTuneIn Subscription',
			'YouTuneIn',
			'manage_options',
			'ytism-settings',
			[ $this, 'render_page' ],
			'dashicons-admin-generic',
			56
		);

		// Subscriptions submenu
		add_submenu_page(
			'ytism-settings',
			__( 'Subscriptions (new)', 'ytism' ),
			__( 'Subscriptions (new)', 'ytism' ),
			'manage_options',
			'ytism-subscriptions-new',
			[ $this, 'render_new_subscriptions_page' ]
		);

		// Transactions submenu
		add_submenu_page(
			'ytism-settings',
			__( 'Transactions', 'ytism' ),
			__( 'Transactions', 'ytism' ),
			'manage_options',
			'ytism-transactions',
			[ $this, 'render_transactions_page' ]
		);

		// Logs submenu
		add_submenu_page(
			'ytism-settings',
			__( 'Logs', 'ytism' ),
			__( 'Logs', 'ytism' ),
			'manage_options',
			'ytism-logs',
			[ $this, 'render_logs_page' ]
		);

		$subscription_page = add_submenu_page(
			'ytism-settings',
			__( 'Subscriptions', 'ytism' ),
			__( 'Subscriptions', 'ytism' ),
			'manage_options',
			'ytism-subscriptions',
			[ $this, 'render_subscriptions_page' ]
		);

		$subscription_page = add_submenu_page(
			'ytism-settings',
			__( 'Payments', 'ytism' ),
			__( 'Payments', 'ytism' ),
			'manage_options',
			'ytism-payments',
			[ $this, 'render_payments_page' ]
		);

		add_action( "load-$subscription_page", [ $this, 'add_screen_options' ] );

		add_action(
			'admin_head',
			function () {
				?>
			<style>
				@font-face {
					font-family: 'ytism';
					src: url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.eot?98731080' ); ?>'); /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */
					src: url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.eot?98731080#iefix' ); ?>') format('embedded-opentype'),
						url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.woff2?98731080' ); ?>') format('woff2'),
						url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.woff?98731080' ); ?>') format('woff'),
						url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.ttf?98731080' ); ?>') format('truetype'),
						url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.svg?98731080#ytism' ); ?>') format('svg');
					font-weight: normal;
					font-style: normal;
				}
				#toplevel_page_ytism-settings .wp-menu-image::before {
					font-family: "ytism" !important;
					content: "\e800";
					font-style: normal;
					font-weight: normal;
					font-size: 18px;
					speak: none;
				}
				.ytism-test-api-section {
					background: #f9f9f9;
					padding: 15px;
					border: 1px solid #ddd;
					border-radius: 4px;
					margin-top: 10px;
				}
				.ytism-api-test-result {
					margin-top: 10px;
					padding: 10px;
					border-radius: 4px;
				}
				.ytism-api-test-result.success {
					background: #d4edda;
					border-color: #c3e6cb;
					color: #155724;
				}
				.ytism-api-test-result.error {
					background: #f8d7da;
					border-color: #f5c6cb;
					color: #721c24;
				}
				.ytism-status-badge {
					display: inline-block;
					padding: 2px 8px;
					border-radius: 3px;
					font-size: 11px;
					font-weight: bold;
					color: white;
				}
				.ytism-metadata-content {
					margin-top: 5px;
					padding: 8px;
					background: #f9f9f9;
					border: 1px solid #ddd;
					border-radius: 3px;
					max-width: 300px;
				}
				.ytism-metadata-content pre {
					margin: 0;
					font-size: 11px;
					white-space: pre-wrap;
					word-wrap: break-word;
				}
				.ytism-stats-cards {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
					gap: 20px;
					margin: 20px 0;
				}
				.ytism-stat-card {
					background: #fff;
					border: 1px solid #c3c4c7;
					border-radius: 4px;
					padding: 20px;
					box-shadow: 0 1px 1px rgba(0,0,0,0.04);
				}
				.ytism-stat-value {
					font-size: 32px;
					font-weight: 600;
					line-height: 1.2;
					margin-bottom: 8px;
				}
				.ytism-stat-label {
					color: #646970;
					font-size: 14px;
				}
				.ytism-status-badge {
					display: inline-block;
					padding: 3px 8px;
					border-radius: 3px;
					color: #fff;
					font-size: 11px;
					font-weight: 600;
					text-transform: uppercase;
				}
				.ytism-user-info {
					display: inline-block;
					vertical-align: middle;
					margin-left: 10px;
				}
				.ytism-detail-container {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
					gap: 20px;
					margin: 20px 0;
				}
				.ytism-detail-card {
					background: #fff;
					border: 1px solid #c3c4c7;
					padding: 20px;
				}
				.ytism-detail-card h2 {
					margin-top: 0;
					padding-bottom: 10px;
					border-bottom: 1px solid #e1e1e1;
				}
				.ytism-detail-table {
					width: 100%;
					margin-top: 15px;
				}
				.ytism-detail-table th {
					text-align: left;
					padding: 8px 0;
					width: 35%;
					font-weight: 600;
					color: #646970;
				}
				.ytism-detail-table td {
					padding: 8px 0;
				}
				.ytism-detail-section {
					background: #fff;
					border: 1px solid #c3c4c7;
					padding: 20px;
					margin: 20px 0;
				}
				.ytism-timeline {
					position: relative;
					padding-left: 40px;
					margin-top: 20px;
				}
				.ytism-timeline::before {
					content: "";
					position: absolute;
					left: 15px;
					top: 0;
					bottom: 0;
					width: 2px;
					background: #e1e1e1;
				}
				.ytism-timeline-item {
					position: relative;
					margin-bottom: 20px;
				}
				.ytism-timeline-marker {
					position: absolute;
					left: -32px;
					width: 12px;
					height: 12px;
					border-radius: 50%;
					background: #646970;
					border: 2px solid #fff;
					box-shadow: 0 0 0 2px #e1e1e1;
				}
				.ytism-timeline-marker.ytism-success { background: #10b981; }
				.ytism-timeline-marker.ytism-error { background: #ef4444; }
				.ytism-timeline-marker.ytism-warning { background: #f59e0b; }
				.ytism-timeline-marker.ytism-info { background: #3b82f6; }
				.ytism-timeline-content {
					background: #f6f7f7;
					padding: 10px 15px;
					border-radius: 4px;
				}
				.ytism-timeline-time {
					font-size: 12px;
					color: #646970;
					margin-bottom: 5px;
				}
				.ytism-timeline-message p {
					margin: 5px 0 0 0;
					font-size: 13px;
					color: #50575e;
				}
			</style>
				<?php
			}
		);
	}

	public function enqueue_assets( $hook ) {
		$ytism_pages = [
			'toplevel_page_ytism-settings',
			'youtunein_page_ytism-subscriptions',
			'youtunein_page_ytism-subscriptions-new',
			'youtunein_page_ytism-transactions',
			'youtunein_page_ytism-logs',
			'admin_page_ytism-subscription-view',
			'admin_page_ytism-transaction-view',
		];

		// Check if we're on one of our pages
		if ( ! in_array( $hook, $ytism_pages, true ) ) {
			return;
		}

		if ( ! wp_script_is( 'jquery', 'enqueued' ) ) {
			wp_enqueue_script( 'jquery' );
		}
		if ( ! wp_script_is( 'wp-i18n', 'enqueued' ) ) {
			wp_enqueue_script( 'wp-i18n' );
		}

		wp_enqueue_style( 'ytism-admin-select2-style', YTISM_PLUGIN_URL . 'assets/css/select2.min.css', [], '1.0.0' );

		wp_enqueue_script( 'ytism-admin-select2-script', YTISM_PLUGIN_URL . 'assets/js/select2.full.min.js', [ 'jquery' ], '1.0.0', true );

		wp_register_script( 'ytism-admin-script', YTISM_PLUGIN_URL . 'assets/js/admin.js', [ 'jquery', 'wp-i18n' ], '3.1.7', true );

		wp_set_script_translations( 'ytism-admin-script', 'ytism', YTISM_PLUGIN_DIR . '/languages' );

		wp_enqueue_script( 'ytism-admin-script' );

		wp_localize_script(
			'ytism-admin-script',
			'YTISM_ADMIN',
			[
				'ajax_url'       => admin_url( 'admin-ajax.php' ),
				'test_api_nonce' => wp_create_nonce( 'ytism_test_stripe_api' ),
				'option_name'    => $this->option_name,
			]
		);
	}

	public function register_settings() {
		register_setting(
			'ytism_settings_group',
			$this->option_name,
			[
				'sanitize_callback' => [ $this, 'sanitize_settings' ],
			]
		);

		/*
		------------------------
		 * Subscription Plans
		 * ------------------------ */
		add_settings_section(
			'ytism_main_section',
			__( 'Subscription Plans', 'ytism' ),
			'__return_false',
			'ytism_settings'
		);

		add_settings_field(
			'ytism_plans',
			__( 'Plans', 'ytism' ),
			[ $this, 'render_plans_field' ],
			'ytism_settings',
			'ytism_main_section'
		);

		/*
		------------------------
		 * Page Settings
		 * ------------------------ */
		add_settings_section(
			'ytism_pages_section',
			__( 'Page Settings', 'ytism' ),
			'__return_false',
			'ytism_settings'
		);

		add_settings_field(
			'myaccount_page',
			__( 'My Account Page', 'ytism' ),
			[ $this, 'render_myaccount_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		add_settings_field(
			'checkout_page',
			__( 'Checkout Page', 'ytism' ),
			[ $this, 'render_checkout_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		add_settings_field(
			'ordersummary_page',
			__( 'Order Summary Page', 'ytism' ),
			[ $this, 'render_ordersummary_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		add_settings_field(
			'thankyou_page',
			__( 'Thank You Page', 'ytism' ),
			[ $this, 'render_thankyou_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		add_settings_field(
			'terms_page',
			__( 'Terms and Conditions Page', 'ytism' ),
			[ $this, 'render_terms_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		add_settings_field(
			'privacy_page',
			__( 'Privacy Policy Page', 'ytism' ),
			[ $this, 'render_privacy_page_field' ],
			'ytism_settings',
			'ytism_pages_section'
		);

		/*
		------------------------
		 * Stripe Settings
		 * ------------------------ */
		add_settings_section(
			'ytism_stripe_section',
			__( 'Stripe Settings', 'ytism' ),
			'__return_false',
			'ytism_settings'
		);

		add_settings_field(
			'stripe_mode',
			__( 'Mode', 'ytism' ),
			[ $this, 'render_stripe_mode_field' ],
			'ytism_settings',
			'ytism_stripe_section'
		);

		add_settings_field(
			'stripe_publishable_key',
			__( 'Publishable Key', 'ytism' ),
			[ $this, 'render_stripe_publishable_key_field' ],
			'ytism_settings',
			'ytism_stripe_section'
		);

		add_settings_field(
			'stripe_secret_key',
			__( 'Secret Key', 'ytism' ),
			[ $this, 'render_stripe_secret_key_field' ],
			'ytism_settings',
			'ytism_stripe_section'
		);

		add_settings_field(
			'stripe_webhook_secret',
			__( 'Webhook Secret', 'ytism' ),
			[ $this, 'render_stripe_webhook_secret_field' ],
			'ytism_settings',
			'ytism_stripe_section'
		);

		add_settings_field(
			'stripe_api_test',
			__( 'API Test', 'ytism' ),
			[ $this, 'render_stripe_api_test_field' ],
			'ytism_settings',
			'ytism_stripe_section'
		);
	}

	public function sanitize_settings( $input ) {
		$valid             = [ 'individual', 'family', 'enterprise' ];
		$existing_settings = get_option( $this->option_name, [] );

		$used_pages        = [];
		$used_products     = [];
		$validation_errors = [];

		// Handle subscription plans
		foreach ( $valid as $key ) {
			$page_id    = isset( $input[ $key ]['page_id'] ) ? absint( $input[ $key ]['page_id'] ) : 0;
			$product_id = isset( $input[ $key ]['product_id'] ) ? trim( $input[ $key ]['product_id'] ) : '';

			// Check for duplicate pages
			if ( $page_id ) {
				if ( in_array( $page_id, $used_pages, true ) ) {
					$validation_errors[] = sprintf( __( 'Page ID %d is used multiple times. Each plan must have a unique page.', 'ytism' ), $page_id );
					$page_id             = 0;
				} else {
					$used_pages[] = $page_id;
				}
			}

			// Check for duplicate products
			if ( $product_id ) {
				if ( in_array( $product_id, $used_products, true ) ) {
					$validation_errors[] = sprintf( __( 'Product ID %s is used multiple times. Each plan must have a unique product.', 'ytism' ), $product_id );
					$product_id          = '';
				} else {
					$used_products[] = $product_id;
				}
			}

			$existing_settings[ $key ] = [
				'page_id'    => $page_id,
				'product_id' => sanitize_text_field( $product_id ),
			];
		}

		// Handle separate page settings
		$myaccount_page_id    = isset( $input['myaccount_page_id'] ) ? absint( $input['myaccount_page_id'] ) : 0;
		$checkout_page_id     = isset( $input['checkout_page_id'] ) ? absint( $input['checkout_page_id'] ) : 0;
		$ordersummary_page_id = isset( $input['ordersummary_page_id'] ) ? absint( $input['ordersummary_page_id'] ) : 0;
		$thankyou_page_id     = isset( $input['thankyou_page_id'] ) ? absint( $input['thankyou_page_id'] ) : 0;
		$terms_page_id        = isset( $input['terms_page_id'] ) ? absint( $input['terms_page_id'] ) : 0;
		$privacy_page_id      = isset( $input['privacy_page_id'] ) ? absint( $input['privacy_page_id'] ) : 0;

		// Check if myaccount/checkout/ordersummary/thankyou pages conflict with plan pages or each other
		if ( $myaccount_page_id ) {
			if ( in_array( $myaccount_page_id, $used_pages, true ) ) {
				$validation_errors[] = __( 'My Account page conflicts with a plan page. Each page must be unique.', 'ytism' );
				$myaccount_page_id   = 0;
			} else {
				$used_pages[] = $myaccount_page_id;
			}
		}

		if ( $checkout_page_id ) {
			if ( in_array( $checkout_page_id, $used_pages, true ) ) {
				$validation_errors[] = __( 'Checkout page conflicts with another page. Each page must be unique.', 'ytism' );
				$checkout_page_id    = 0;
			} else {
				$used_pages[] = $checkout_page_id;
			}
		}

		if ( $ordersummary_page_id ) {
			if ( in_array( $ordersummary_page_id, $used_pages, true ) ) {
				$validation_errors[]  = __( 'Order Summary page conflicts with another page. Each page must be unique.', 'ytism' );
				$ordersummary_page_id = 0;
			} else {
				$used_pages[] = $ordersummary_page_id;
			}
		}

		if ( $thankyou_page_id ) {
			if ( in_array( $thankyou_page_id, $used_pages, true ) ) {
				$validation_errors[] = __( 'Thank You page conflicts with another page. Each page must be unique.', 'ytism' );
				$thankyou_page_id    = 0;
			} else {
				$used_pages[] = $thankyou_page_id;
			}
		}

		if ( $terms_page_id ) {
			if ( in_array( $terms_page_id, $used_pages, true ) ) {
				$validation_errors[] = __( 'Terms page conflicts with another page. Each page must be unique.', 'ytism' );
				$terms_page_id       = 0;
			} else {
				$used_pages[] = $terms_page_id;
			}
		}

		if ( $privacy_page_id ) {
			if ( in_array( $privacy_page_id, $used_pages, true ) ) {
				$validation_errors[] = __( 'Privacy page conflicts with another page. Each page must be unique.', 'ytism' );
				$privacy_page_id    = 0;
			} else {
				$used_pages[] = $privacy_page_id;
			}
		}

		$existing_settings['myaccount_page_id']    = $myaccount_page_id;
		$existing_settings['checkout_page_id']     = $checkout_page_id;
		$existing_settings['ordersummary_page_id'] = $ordersummary_page_id;
		$existing_settings['thankyou_page_id']     = $thankyou_page_id;
		$existing_settings['terms_page_id']        = $terms_page_id;
		$existing_settings['privacy_page_id']      = $privacy_page_id;

		// Display validation errors
		if ( ! empty( $validation_errors ) ) {
			foreach ( $validation_errors as $error ) {
				add_settings_error( $this->option_name, 'validation_error', $error );
			}
		}

		/* --- Stripe settings sanitization --- */
		$stripe_mode            = in_array( $input['stripe_mode'] ?? 'test', [ 'test','live' ], true ) ? $input['stripe_mode'] : 'test';
		$stripe_publishable_key = sanitize_text_field( $input['stripe_publishable_key'] ?? '' );
		$stripe_secret_key      = sanitize_text_field( $input['stripe_secret_key'] ?? '' );
		$stripe_webhook_secret  = sanitize_text_field( $input['stripe_webhook_secret'] ?? '' );

		// Validate Stripe key formats
		if ( ! empty( $stripe_publishable_key ) ) {
			$expected_prefix = $stripe_mode === 'live' ? 'pk_live_' : 'pk_test_';
			if ( strpos( $stripe_publishable_key, $expected_prefix ) !== 0 ) {
				add_settings_error(
					$this->option_name,
					'invalid_publishable_key',
					sprintf( __( 'Publishable key format is invalid. It should start with "%1$s" for %2$s mode.', 'ytism' ), $expected_prefix, $stripe_mode )
				);
			}
		}

		if ( ! empty( $stripe_secret_key ) ) {
			$expected_prefix = $stripe_mode === 'live' ? 'sk_live_' : 'sk_test_';
			if ( strpos( $stripe_secret_key, $expected_prefix ) !== 0 ) {
				add_settings_error(
					$this->option_name,
					'invalid_secret_key',
					sprintf( __( 'Secret key format is invalid. It should start with "%1$s" for %2$s mode.', 'ytism' ), $expected_prefix, $stripe_mode )
				);
			}
		}

		if ( ! empty( $stripe_webhook_secret ) && strpos( $stripe_webhook_secret, 'whsec_' ) !== 0 ) {
			add_settings_error(
				$this->option_name,
				'invalid_webhook_secret',
				__( 'Webhook secret format is invalid. It should start with "whsec_".', 'ytism' )
			);
		}

		$existing_settings['stripe_mode']            = $stripe_mode;
		$existing_settings['stripe_publishable_key'] = $stripe_publishable_key;
		$existing_settings['stripe_secret_key']      = $stripe_secret_key;
		$existing_settings['stripe_webhook_secret']  = $stripe_webhook_secret;

		// Only show success message if no validation errors
		if ( empty( $validation_errors ) ) {
			add_settings_error(
				$this->option_name,
				'ytism_settings_saved',
				__( 'Settings saved successfully.', 'ytism' ),
				'updated'
			);
		}

		return $existing_settings;
	}

	public function add_screen_options() {
		$option = 'per_page';
		$args   = [
			'label'   => __( 'Subscriptions per page', 'ytism' ),
			'default' => 20,
			'option'  => 'subscriptions_per_page',
		];
		add_screen_option( $option, $args );
	}

	public function set_screen_option( $status, $option, $value ) {
		if ( 'subscriptions_per_page' === $option ) {
			return $value;
		}
		return $status;
	}

	public function render_page() {
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'YouTuneIn Subscription Settings', 'ytism' ); ?></h1>
			<?php settings_errors( $this->option_name ); ?>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'ytism_settings_group' );
				do_settings_sections( 'ytism_settings' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	public function render_subscriptions_page() {
		if ( isset( $_GET['action'] ) ) {
			$this->handle_subscription_action();
			return;
		}

		$list_table = new Subscription_List_Table();
		$list_table->prepare_items();
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline"><?php _e( 'Subscriptions', 'ytism' ); ?></h1>
			<a href="<?php echo admin_url( 'admin.php?page=ytism-settings&action=export' ); ?>" class="page-title-action"><?php _e( 'Export CSV', 'ytism' ); ?></a>
			<form method="get">
				<input type="hidden" name="page" value="ytism-settings">
				<?php $list_table->display(); ?>
			</form>
		</div>
		<?php
	}

	public function render_payments_page() {
		$list_table = new Payment_List_Table();
		$list_table->prepare_items();
		?>
		<div class="wrap">
			<h1><?php _e( 'Payments', 'ytism' ); ?></h1>
			<hr class="wp-header-end">
			
			<form method="get">
				<input type="hidden" name="page" value="ytism-payments">
				<?php $list_table->display(); ?>
			</form>
		</div>
		<?php
	}

	private function handle_subscription_action() {
		$action = sanitize_text_field( $_GET['action'] );
		$id     = isset( $_GET['id'] ) ? intval( $_GET['id'] ) : 0;

		switch ( $action ) {
			case 'view':
				$this->render_subscription_details( $id );
				break;

			case 'cancel':
				if ( ! wp_verify_nonce( $_GET['_wpnonce'] ?? '', 'cancel-subscription-' . $id ) ) {
					wp_die( __( 'Invalid nonce', 'ytism' ) );
				}
				// $this->cancel_subscription($id);
				break;

			case 'export':
				// $this->export_subscriptions();
				break;
		}
	}

	private function render_subscription_details( $id ) {
		$subscriptions_db = \YTISM\Database\Factory::subscription();
		$payments_db      = \YTISM\Database\Factory::payment();
		$events_db        = \YTISM\Database\Factory::event();

		$subscription = $subscriptions_db->get( $id );
		if ( ! $subscription ) {
			wp_die( __( 'Subscription not found', 'ytism' ) );
		}

		$user     = get_user_by( 'ID', $subscription->user_id );
		$payments = $payments_db->get_by_subscription( $id );
		$events   = $events_db->get_subscription_timeline( $id, 50 );
		?>
		<div class="wrap">
			<h1><?php _e( 'Subscription Details', 'ytism' ); ?></h1>
			<a href="<?php echo admin_url( 'admin.php?page=ytism-settings' ); ?>" class="page-title-action"><?php _e( '← Back to List', 'ytism' ); ?></a>
			<hr class="wp-header-end">
			
			<div class="ytism-detail-container">
				<!-- Subscription Info Card -->
				<div class="ytism-detail-card">
					<h2><?php _e( 'Subscription Information', 'ytism' ); ?></h2>
					<table class="ytism-detail-table">
						<tr>
							<th><?php _e( 'Status', 'ytism' ); ?></th>
							<td><?php echo $this->render_status_badge( $subscription->status ); ?></td>
						</tr>
						<tr>
							<th><?php _e( 'Stripe ID', 'ytism' ); ?></th>
							<td>
								<?php if ( $subscription->gateway_subscription_id ) : ?>
									<a href="https://dashboard.stripe.com/subscriptions/<?php echo $subscription->gateway_subscription_id; ?>" target="_blank">
										<?php echo $subscription->gateway_subscription_id; ?>
										<span class="dashicons dashicons-external"></span>
									</a>
								<?php else : ?>
									—
								<?php endif; ?>
							</td>
						</tr>
						<tr>
							<th><?php _e( 'Amount', 'ytism' ); ?></th>
							<td><?php echo $subscription->currency . ' ' . number_format( $subscription->amount, 2 ); ?></td>
						</tr>
						<tr>
							<th><?php _e( 'Billing Period', 'ytism' ); ?></th>
							<td><?php echo $this->format_billing_period( $subscription->billing_period, $subscription->billing_interval ); ?></td>
						</tr>
						<tr>
							<th><?php _e( 'Current Period', 'ytism' ); ?></th>
							<td>
								<?php echo date_i18n( get_option( 'date_format' ), strtotime( $subscription->current_period_start ) ); ?>
								<?php _e( 'to', 'ytism' ); ?>
								<?php echo date_i18n( get_option( 'date_format' ), strtotime( $subscription->current_period_end ) ); ?>
							</td>
						</tr>
						<tr>
							<th><?php _e( 'Created', 'ytism' ); ?></th>
							<td><?php echo date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $subscription->created_at ) ); ?></td>
						</tr>
						<?php if ( $subscription->canceled_at ) : ?>
						<tr>
							<th><?php _e( 'Canceled At', 'ytism' ); ?></th>
							<td><?php echo date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $subscription->canceled_at ) ); ?></td>
						</tr>
						<?php endif; ?>
					</table>
				</div>
				
				<!-- User Info Card -->
				<div class="ytism-detail-card">
					<h2><?php _e( 'Customer Information', 'ytism' ); ?></h2>
					<?php if ( $user ) : ?>
					<table class="ytism-detail-table">
						<tr>
							<th><?php _e( 'Name', 'ytism' ); ?></th>
							<td><?php echo esc_html( $user->display_name ); ?></td>
						</tr>
						<tr>
							<th><?php _e( 'Email', 'ytism' ); ?></th>
							<td><a href="mailto:<?php echo esc_attr( $user->user_email ); ?>"><?php echo esc_html( $user->user_email ); ?></a></td>
						</tr>
						<tr>
							<th><?php _e( 'User ID', 'ytism' ); ?></th>
							<td>
								<a href="<?php echo get_edit_user_link( $user->ID ); ?>">
									#<?php echo $user->ID; ?>
									<span class="dashicons dashicons-external"></span>
								</a>
							</td>
						</tr>
					</table>
					<?php else : ?>
					<p><?php _e( 'User not found', 'ytism' ); ?></p>
					<?php endif; ?>
				</div>
			</div>
			
			<!-- Recent Payments -->
			<div class="ytism-detail-section">
				<h2><?php _e( 'Recent Payments', 'ytism' ); ?></h2>
				<?php if ( ! empty( $payments ) ) : ?>
				<table class="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th><?php _e( 'Date', 'ytism' ); ?></th>
							<th><?php _e( 'Amount', 'ytism' ); ?></th>
							<th><?php _e( 'Status', 'ytism' ); ?></th>
							<th><?php _e( 'Transaction ID', 'ytism' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( array_slice( $payments, 0, 10 ) as $payment ) : ?>
						<tr>
							<td><?php echo date_i18n( get_option( 'date_format' ), strtotime( $payment->created_at ) ); ?></td>
							<td><?php echo $subscription->currency . ' ' . number_format( $payment->amount, 2 ); ?></td>
							<td><?php echo $this->render_status_badge( $payment->status ); ?></td>
							<td>
								<?php if ( $payment->transaction_id ) : ?>
									<code><?php echo substr( $payment->transaction_id, 0, 30 ); ?>...</code>
								<?php else : ?>
									—
								<?php endif; ?>
							</td>
						</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<?php else : ?>
				<p><?php _e( 'No payments found', 'ytism' ); ?></p>
				<?php endif; ?>
			</div>
			
			<!-- Event Timeline -->
			<div class="ytism-detail-section">
				<h2><?php _e( 'Event Timeline', 'ytism' ); ?></h2>
				<?php if ( ! empty( $events ) ) : ?>
				<div class="ytism-timeline">
					<?php foreach ( $events as $event ) : ?>
					<div class="ytism-timeline-item">
						<div class="ytism-timeline-marker <?php echo 'ytism-' . $event->status; ?>"></div>
						<div class="ytism-timeline-content">
							<div class="ytism-timeline-time">
								<?php echo date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $event->created_at ) ); ?>
							</div>
							<div class="ytism-timeline-message">
								<strong><?php echo esc_html( $event->event_code ); ?></strong>
								<p><?php echo esc_html( $event->message ); ?></p>
							</div>
						</div>
					</div>
					<?php endforeach; ?>
				</div>
				<?php else : ?>
				<p><?php _e( 'No events found', 'ytism' ); ?></p>
				<?php endif; ?>
			</div>
		</div>
		<?php
	}

	private function render_status_badge( $status ) {
		$status_colors = [
			'active'          => '#10b981',
			'succeeded'       => '#10b981',
			'trialing'        => '#3b82f6',
			'past_due'        => '#f59e0b',
			'processing'      => '#3b82f6',
			'canceled'        => '#ef4444',
			'failed'          => '#ef4444',
			'incomplete'      => '#6b7280',
			'expired'         => '#991b1b',
			'paused'          => '#8b5cf6',
			'requires_action' => '#f59e0b',
			'initiated'       => '#6b7280',
		];

		$color       = $status_colors[ $status ] ?? '#6b7280';
		$status_text = ucfirst( str_replace( '_', ' ', $status ) );

		return sprintf(
			'<span class="ytism-status-badge" style="background-color: %s;">%s</span>',
			$color,
			esc_html( $status_text )
		);
	}

	private function format_billing_period( $period, $interval ) {
		$periods = [
			'day'     => _n( 'day', 'days', $interval, 'ytism' ),
			'week'    => _n( 'week', 'weeks', $interval, 'ytism' ),
			'month'   => _n( 'month', 'months', $interval, 'ytism' ),
			'quarter' => _n( 'quarter', 'quarters', $interval, 'ytism' ),
			'year'    => _n( 'year', 'years', $interval, 'ytism' ),
		];

		$period_text = $periods[ $period ] ?? $period;

		if ( $interval > 1 ) {
			/* translators: 1: interval number, 2: billing period (e.g. months) */
			return sprintf( esc_attr__( 'Every %1$d %2$s', 'ytism' ), absint( $interval ), esc_attr( $period_text ) );
		}

		/* translators: %s: billing period (e.g. month, week, year) */
		return sprintf( esc_attr__( 'Every %s', 'ytism' ), esc_attr( $period_text ) );
	}


	/*
	--------------------
	 * Plan Fields
	 * -------------------- */
	public function render_plans_field() {
		$stripe_products = $this->get_stripe_subscription_products();

		$plans  = get_option( $this->option_name, [] );
		$groups = [
			'individual' => __( 'Individual Plan', 'ytism' ),
			'family'     => __( 'Family Plan', 'ytism' ),
			'enterprise' => __( 'Corporate Plan', 'ytism' ),
		];

		$used_pages    = [];
		$used_products = [];

		foreach ( $groups as $k => $name ) {
			if ( isset( $plans[ $k ]['page_id'] ) ) {
				$used_pages[ $k ] = (int) $plans[ $k ]['page_id'];
			}
			if ( isset( $plans[ $k ]['product_id'] ) ) {
				$used_products[ $k ] = $plans[ $k ]['product_id'];
			}
		}

		foreach ( $groups as $key => $label ) {
			$page_id    = isset( $plans[ $key ]['page_id'] ) ? (int) $plans[ $key ]['page_id'] : 0;
			$product_id = isset( $plans[ $key ]['product_id'] ) ? $plans[ $key ]['product_id'] : '';

			echo '<h3>' . esc_html( $label ) . '</h3>';

			// Page select
			echo '<p><strong>' . __( 'Select Page', 'ytism' ) . '</strong><br />';
			echo '<select name="' . esc_attr( $this->option_name . '[' . $key . '][page_id]' ) . '" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
			echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

			$pages = get_pages(
				[
					'post_type'   => 'page',
					'post_status' => 'publish',
				]
			);
			foreach ( $pages as $page ) {
				$selected = selected( $page_id, $page->ID, false );
				$disabled = '';
				foreach ( $used_pages as $k => $used_id ) {
					if ( $k !== $key && $used_id == $page->ID ) {
						$disabled = 'disabled';
						break;
					}
				}
				printf(
					'<option value="%d" %s %s>%s</option>',
					$page->ID,
					$selected,
					$disabled,
					esc_html( $page->post_title )
				);
			}
			echo '</select></p>';

			// Product select
			echo '<p><strong>' . __( 'Select Product', 'ytism' ) . '</strong><br />';
			echo '<select name="' . esc_attr( $this->option_name . '[' . $key . '][product_id]' ) . '" 
                    class="ytism-product-select" 
                    data-placeholder="' . esc_attr__( 'Select a subscription product', 'ytism' ) . '" 
                    data-allow_clear="true">';
			echo '<option value="">' . esc_html__( 'Select a subscription product', 'ytism' ) . '</option>';
			foreach ( $stripe_products as $pid => $pname ) {
				$selected = selected( $product_id, $pid, false );
				$disabled = '';
				foreach ( $used_products as $k => $used_pid ) {
					if ( $k !== $key && $used_pid === $pid ) {
						$disabled = 'disabled';
						break;
					}
				}
				printf(
					'<option value="%s" %s %s>%s</option>',
					esc_attr( $pid ),
					$selected,
					$disabled,
					esc_html( $pname . ' - (' . $pid . ')' )
				);
			}
			echo '</select></p>';
		}
	}

	/*
	--------------------
	 * Page Fields
	 * -------------------- */
	public function render_myaccount_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['myaccount_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[myaccount_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use for user account management.', 'ytism' ) . '</p>';
	}

	public function render_checkout_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['checkout_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[checkout_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use for checkout.', 'ytism' ) . '</p>';
	}

	public function render_ordersummary_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['ordersummary_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[ordersummary_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use for order summaries.', 'ytism' ) . '</p>';
	}

	public function render_thankyou_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['thankyou_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[thankyou_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use as the thank you page after purchase.', 'ytism' ) . '</p>';
	}

	public function render_terms_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['terms_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[terms_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use as the terms page.', 'ytism' ) . '</p>';
	}

	public function render_privacy_page_field() {
		$options = get_option( $this->option_name, [] );
		$page_id = $options['privacy_page_id'] ?? 0;

		echo '<select name="' . esc_attr( $this->option_name ) . '[privacy_page_id]" class="ytism-page-select" data-placeholder="' . esc_attr__( 'Select a page', 'ytism' ) . '">';
		echo '<option value="">' . esc_html__( 'Select a page', 'ytism' ) . '</option>';

		$pages = get_pages();
		foreach ( $pages as $page ) {
			printf(
				'<option value="%d" %s>%s</option>',
				$page->ID,
				selected( $page_id, $page->ID, false ),
				esc_html( $page->post_title )
			);
		}
		echo '</select>';
		echo '<p class="description">' . esc_html__( 'Select the page to use as the privacy page.', 'ytism' ) . '</p>';
	}

	/**
	 * Get only Stripe products that have at least one recurring price
	 * (i.e. can be used in subscriptions). 1-hour cache.
	 *
	 * @return array product_id => product_name
	 */
	private function get_stripe_subscription_products() {
		$cached = get_transient( 'ytism_stripe_subscription_products' );
		if ( false !== $cached ) {
			return $cached;
		}

		$backup = get_option( 'ytism_stripe_subscription_products_backup', [] );

		$options    = get_option( 'ytism_settings', [] );
		$secret_key = $options['stripe_secret_key'] ?? '';

		if ( empty( $secret_key ) ) {
			return [];
		}

		Stripe::setApiKey( $secret_key );

		try {
			$product_ids = [];
			$prices      = Price::all(
				[
					'active' => true,
					'limit'  => 100,
					'expand' => [ 'data.product' ],
				]
			);

			foreach ( $prices->autoPagingIterator() as $price ) {
				if ( isset( $price->recurring ) && $price->recurring ) {
					$product_ids[] = is_object( $price->product ) ? $price->product->id : $price->product;
				}
			}

			$product_ids = array_unique( $product_ids );

			$subscription_products = [];
			foreach ( $product_ids as $pid ) {
				$product = Product::retrieve( $pid );
				if ( $product->active ) {
					$subscription_products[ $product->id ] = $product->name;
				}
			}

			set_transient( 'ytism_stripe_subscription_products', $subscription_products, HOUR_IN_SECONDS );
			update_option( 'ytism_stripe_subscription_products_backup', $subscription_products, false );

			return $subscription_products;

		} catch ( \Exception $e ) {
			error_log( 'Stripe subscription product fetch error: ' . $e->getMessage() );
			return $backup;
		}
	}

	/*
	--------------------
	 * Stripe Fields
	 * -------------------- */
	public function render_stripe_mode_field() {
		$options = get_option( $this->option_name, [] );
		$mode    = $options['stripe_mode'] ?? 'test';
		?>
		<select name="<?php echo esc_attr( $this->option_name ); ?>[stripe_mode]">
			<option value="test" <?php selected( $mode, 'test' ); ?>><?php esc_html_e( 'Test', 'ytism' ); ?></option>
			<option value="live" <?php selected( $mode, 'live' ); ?>><?php esc_html_e( 'Live', 'ytism' ); ?></option>
		</select>
		<p class="description"><?php esc_html_e( 'Select Stripe environment.', 'ytism' ); ?></p>
		<?php
	}

	public function render_stripe_publishable_key_field() {
		$options = get_option( $this->option_name, [] );
		?>
		<input type="text"
			name="<?php echo esc_attr( $this->option_name ); ?>[stripe_publishable_key]"
			value="<?php echo esc_attr( $options['stripe_publishable_key'] ?? '' ); ?>"
			class="regular-text" />
		<p class="description"><?php esc_html_e( 'Your Stripe publishable key.', 'ytism' ); ?></p>
		<?php
	}

	public function render_stripe_secret_key_field() {
		$options = get_option( $this->option_name, [] );
		?>
		<div style="display: flex; align-items: center; gap: 10px;">
			<input type="password"
				id="stripe_secret_key"
				name="<?php echo esc_attr( $this->option_name ); ?>[stripe_secret_key]"
				value="<?php echo esc_attr( $options['stripe_secret_key'] ?? '' ); ?>"
				class="regular-text" />
			<button type="button" class="button button-secondary" id="toggle-secret-key">
				<span class="dashicons dashicons-visibility"></span>
			</button>
		</div>
		<p class="description"><?php esc_html_e( 'Your Stripe secret key.', 'ytism' ); ?></p>
		<?php
	}

	public function render_stripe_webhook_secret_field() {
		$options     = get_option( $this->option_name, [] );
		$webhook_url = home_url( '/wp-json/ytism/v1/stripe/webhook' );
		?>
		<div class="ytism-webhook-field">
			<div style="display: flex; align-items: center; gap: 10px;">
				<input type="password"
					id="stripe_webhook_secret"
					name="<?php echo esc_attr( $this->option_name ); ?>[stripe_webhook_secret]"
					value="<?php echo esc_attr( $options['stripe_webhook_secret'] ?? '' ); ?>"
					class="regular-text" />
				<button type="button" class="button button-secondary" id="toggle-webhook-secret">
					<span class="dashicons dashicons-visibility"></span>
				</button>
			</div>
			
			<div class="webhook-instructions" style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-left: 4px solid #007cba; border-radius: 4px;">
				<h4 style="margin-top: 0;"><?php esc_html_e( 'Webhook Configuration Instructions', 'ytism' ); ?></h4>
				
				<p><strong><?php esc_html_e( 'Webhook URL:', 'ytism' ); ?></strong></p>
				<code style="background: #fff; padding: 5px 8px; border: 1px solid #ddd; border-radius: 3px; display: inline-block; margin-bottom: 10px;"><?php echo esc_html( $webhook_url ); ?></code>
				
				<p><strong><?php esc_html_e( 'Required Events to Listen:', 'ytism' ); ?></strong></p>
				<ul style="margin: 10px 0 10px 20px;">
					<li><code>customer.subscription.created</code> - When a new subscription is created</li>
					<li><code>customer.subscription.updated</code> - When subscription details change</li>
					<li><code>customer.subscription.deleted</code> - When a subscription is canceled</li>
					<li><code>invoice.payment_succeeded</code> - When payment is successful</li>
					<li><code>invoice.payment_failed</code> - When payment fails</li>
					<li><code>customer.created</code> - When a new customer is created</li>
				</ul>
				
				<p><strong><?php esc_html_e( 'Setup Steps:', 'ytism' ); ?></strong></p>
				<ol style="margin: 10px 0 0 20px;">
					<li><?php esc_html_e( 'Go to your Stripe Dashboard → Developers → Webhooks', 'ytism' ); ?></li>
					<li><?php esc_html_e( 'Click "Add endpoint"', 'ytism' ); ?></li>
					<li><?php esc_html_e( 'Add the webhook URL above', 'ytism' ); ?></li>
					<li><?php esc_html_e( 'Select the events listed above', 'ytism' ); ?></li>
					<li><?php esc_html_e( 'Copy the signing secret and paste it in the field above', 'ytism' ); ?></li>
				</ol>
			</div>
		</div>
		<p class="description"><?php esc_html_e( 'Stripe webhook signing secret for security verification.', 'ytism' ); ?></p>
		<?php
	}

	public function render_stripe_api_test_field() {
		?>
		<div class="ytism-test-api-section">
			<p><?php esc_html_e( 'Test your Stripe API configuration to ensure everything is working correctly.', 'ytism' ); ?></p>
			<button type="button" id="ytism-test-stripe-api" class="button button-secondary">
				<?php esc_html_e( 'Test Stripe API Connection', 'ytism' ); ?>
			</button>
			<div id="ytism-api-test-result" class="ytism-api-test-result" style="display:none;"></div>
		</div>
		<p class="description"><?php esc_html_e( 'Click the button above to test your API configuration.', 'ytism' ); ?></p>
		<?php
	}

	/**
	 * Handle AJAX request to test Stripe API
	 */
	public function handle_test_stripe_api() {
		// Verify nonce
		if ( ! wp_verify_nonce( $_POST['nonce'] ?? '', 'ytism_test_stripe_api' ) ) {
			wp_send_json_error( [ 'message' => __( 'Security check failed.', 'ytism' ) ] );
		}

		// Check user permissions
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( [ 'message' => __( 'Insufficient permissions.', 'ytism' ) ] );
		}

		$publishable_key = sanitize_text_field( $_POST['publishable_key'] ?? '' );
		$secret_key      = sanitize_text_field( $_POST['secret_key'] ?? '' );
		$webhook_secret  = sanitize_text_field( $_POST['webhook_secret'] ?? '' );
		$mode            = sanitize_text_field( $_POST['mode'] ?? 'test' );

		$results         = [];
		$overall_success = true;

		// Test Publishable Key
		if ( empty( $publishable_key ) ) {
			$results[]       = __( 'Publishable key is empty.', 'ytism' );
			$overall_success = false;
		} else {
			$expected_prefix = $mode === 'live' ? 'pk_live_' : 'pk_test_';
			if ( strpos( $publishable_key, $expected_prefix ) === 0 ) {
				$results[] = __( 'Publishable key format is correct.', 'ytism' );
			} else {
				/* translators: 1: expected key prefix (e.g. "pk_live_"), 2: Stripe mode (e.g. live or test) */
				$results[]       = sprintf( __( 'Publishable key should start with "%1$s" for %2$s mode.', 'ytism' ), $expected_prefix, $mode );
				$overall_success = false;
			}
		}

		// Test Secret Key with actual API validation
		if ( empty( $secret_key ) ) {
			$results[]       = __( 'Secret key is empty.', 'ytism' );
			$overall_success = false;
		} else {
			$expected_prefix = $mode === 'live' ? 'sk_live_' : 'sk_test_';
			if ( strpos( $secret_key, $expected_prefix ) === 0 ) {
				$results[] = __( 'Secret key format is correct.', 'ytism' );

				// Test actual API connection
				try {
					Stripe::setApiKey( $secret_key );
					$account = Account::retrieve();

					if ( $account && $account->id ) {
						/* translators: %s: Stripe account ID */
						$results[] = sprintf( __( 'API connection successful. Account ID: %s', 'ytism' ), $account->id );

						// Check if account matches the mode
						$is_live_account = ! $account->livemode ? false : true;
						$expected_live   = $mode === 'live';

						if ( $is_live_account === $expected_live ) {
							/* translators: %s: Stripe account mode (e.g. live or test) */
							$results[] = sprintf( __( 'Account mode matches selected mode (%s).', 'ytism' ), $mode );
						} else {
							$results[] = sprintf(
								__( 'Account is in %1$s mode but you selected %2$s mode.', 'ytism' ),
								$is_live_account ? 'live' : 'test',
								$mode
							);
						}

						// Test if we can fetch products (additional validation)
						try {
							$products  = Product::all( [ 'limit' => 1 ] );
							$results[] = __( 'Product API access confirmed.', 'ytism' );
						} catch ( \Exception $e ) {
							$results[] = sprintf( __( 'Product API access limited: %s', 'ytism' ), $e->getMessage() );
						}
					} else {
						$results[]       = __( 'API connection failed: Invalid account response.', 'ytism' );
						$overall_success = false;
					}
				} catch ( \Exception $e ) {
					$results[]       = sprintf( __( 'API connection failed: %s', 'ytism' ), $e->getMessage() );
					$overall_success = false;
				}
			} else {
				$results[]       = sprintf( __( 'Secret key should start with "%1$s" for %2$s mode.', 'ytism' ), $expected_prefix, $mode );
				$overall_success = false;
			}
		}

		// Test Webhook Secret
		if ( empty( $webhook_secret ) ) {
			$results[] = __( 'Webhook secret is empty. This is optional but recommended for security.', 'ytism' );
		} elseif ( strpos( $webhook_secret, 'whsec_' ) === 0 ) {
				$results[] = __( 'Webhook secret format is correct.', 'ytism' );

				// Additional webhook secret validation
			if ( strlen( $webhook_secret ) < 20 ) {
				$results[] = __( 'Webhook secret seems too short. Please verify it\'s correct.', 'ytism' );
			} else {
				$results[] = __( 'Webhook secret length looks valid.', 'ytism' );
			}
		} else {
			$results[]       = __( 'Webhook secret should start with "whsec_".', 'ytism' );
			$overall_success = false;
		}

		$message = '<strong>' . __( 'API Test Results:', 'ytism' ) . '</strong><br>' . implode( '<br>', $results );

		if ( $overall_success ) {
			wp_send_json_success( [ 'message' => $message ] );
		} else {
			wp_send_json_error( [ 'message' => $message ] );
		}
	}

	/**
	 * When a page is unpublished or deleted, check if it's used in settings and clear it if so.
	 */
	public function post_status_changed( $new_status, $old_status, $post ) {
		if ( 'page' === $post->post_type && 'publish' !== $new_status ) {
			$options = get_option( $this->option_name, [] );
			$updated = false;

			// Check plans.
			$valid_keys = [ 'individual', 'family', 'enterprise' ];
			foreach ( $valid_keys as $key ) {
				if ( isset( $options[ $key ]['page_id'] ) && (int) $options[ $key ]['page_id'] === (int) $post->ID ) {
					$options[ $key ]['page_id'] = 0;
					$updated                    = true;
				}
			}

			// Check myaccount page.
			if ( isset( $options['myaccount_page_id'] ) && (int) $options['myaccount_page_id'] === (int) $post->ID ) {
				$options['myaccount_page_id'] = 0;
				update_option( 'ytism_flush_rewrite_rules', false );
				$updated = true;
			}

			// Check checkout page.
			if ( isset( $options['checkout_page_id'] ) && (int) $options['checkout_page_id'] === (int) $post->ID ) {
				$options['checkout_page_id'] = 0;
				$updated                     = true;
			}

			// Check ordersummary page.
			if ( isset( $options['ordersummary_page_id'] ) && (int) $options['ordersummary_page_id'] === (int) $post->ID ) {
				$options['ordersummary_page_id'] = 0;
				$updated                         = true;
			}

			// Check thankyou page.
			if ( isset( $options['thankyou_page_id'] ) && (int) $options['thankyou_page_id'] === (int) $post->ID ) {
				$options['thankyou_page_id'] = 0;
				$updated                     = true;
			}

			// Check terms page.
			if ( isset( $options['terms_page_id'] ) && (int) $options['terms_page_id'] === (int) $post->ID ) {
				$options['terms_page_id'] = 0;
				$updated                  = true;
			}

			// Check privacy page.
			if ( isset( $options['privacy_page_id'] ) && (int) $options['privacy_page_id'] === (int) $post->ID ) {
				$options['privacy_page_id'] = 0;
				$updated                    = true;
			}

			if ( $updated ) {
				update_option( $this->option_name, $options );

				$settings_link = '<a href="' . esc_url( admin_url( 'admin.php?page=ytism-settings' ) ) . '">'
								. esc_html__( 'Settings', 'ytism' )
								. '</a>';

				$message = sprintf(
					esc_html__( 'A page you were using for subscription settings has been unpublished. The setting has been cleared. Please update your %s.', 'ytism' ),
					$settings_link
				);

				add_action(
					'admin_notices',
					function () use ( $message ) {
						echo '<div class="notice notice-warning is-dismissible"><p>' . wp_kses_post( $message ) . '</p></div>';
					}
				);
			}
		}
	}

	/**
	 * Menu style
	 */
	public function menu_admin_styles() {
		$screen = get_current_screen();
		if ( 'nav-menus' === $screen->id ) {
			?>
			<style>
				.field-icon,
				.field-visibility {
					margin: 10px 0;
				}
				.field-icon input,
				.field-visibility select {
					width: 100%;
				}
				.field-icon .description,
				.field-visibility .description {
					font-style: italic;
					color: #666;
				}
			</style>
			<?php
		}
	}

	/**
	 * Clear all Stripe product related transients whenever settings are updated.
	 * If myaccount page deleted then also delete rewrite rules option
	 *
	 * @param mixed $old_value
	 * @param mixed $new_value
	 */
	public function on_update_setting( $old_value, $new_value ) {
		$old_page_id = intval( $old_value['myaccount_page_id'] ?? 0 );
		$new_page_id = intval( $new_value['myaccount_page_id'] ?? 0 );

		$page_id_to_remove = $new_page_id ?: $old_page_id;

		// If myaccount page changed or removed, check if we need to flush rewrite rules
		if ( ! $page_id_to_remove || get_post_status( $page_id_to_remove ) !== 'publish' ) {
			flush_rewrite_rules();
		}

		// Always clear Stripe product cache
		delete_transient( 'ytism_stripe_subscription_products' );
	}

	public function render_new_subscriptions_page() {
		$list_table = new Subscriptions_List_Table_New();
		$list_table->prepare_items();
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Subscriptions', 'ytism' ); ?></h1>
			<hr class="wp-header-end">
			<form method="get">
				<input type="hidden" name="page" value="ytism-subscriptions">
				<?php $list_table->display(); ?>
			</form>
		</div>
		<?php
	}

	public function render_transactions_page() {
		$list_table = new Transactions_List_Table();
		$list_table->prepare_items();
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Transactions', 'ytism' ); ?></h1>
			<hr class="wp-header-end">
			<form method="get">
				<input type="hidden" name="page" value="ytism-transactions">
				<?php $list_table->display(); ?>
			</form>
		</div>
		<?php
	}

	public function render_logs_page() {
		$list_table = new Logs_List_Table();
		$list_table->prepare_items();
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Event Logs', 'ytism' ); ?></h1>
			<hr class="wp-header-end">
			<form method="get">
				<input type="hidden" name="page" value="ytism-logs">
				<?php $list_table->display(); ?>
			</form>
		</div>
		<?php
	}

	public function render_subscription_view_page() {
		if ( ! isset( $_GET['id'] ) ) {
			wp_die( __( 'Invalid subscription ID', 'ytism' ) );
		}

		$id          = intval( $_GET['id'] );
		$sub_handler = new Subscription_Handler();
		$txn_handler = new Transaction_Handler();

		$subscription = $sub_handler->get( $id );

		if ( ! $subscription ) {
			wp_die( __( 'Subscription not found', 'ytism' ) );
		}

		$timeline     = $sub_handler->get_timeline( $id );
		$stats        = $txn_handler->get_subscription_stats( $id );
		$transactions = $txn_handler->get_by_subscription( $id );
		$user         = get_user_by( 'id', $subscription->user_id );

		$back_url = add_query_arg( 'page', 'ytism-subscriptions', admin_url( 'admin.php' ) );
		?>
		<div class="wrap ytism-subscription-view">
			<h1 class="wp-heading-inline">
				<?php printf( __( 'Subscription #%d', 'ytism' ), $id ); ?>
				<a href="<?php echo esc_url( $back_url ); ?>" class="page-title-action"><?php esc_html_e( '← Back to List', 'ytism' ); ?></a>
			</h1>
			<hr class="wp-header-end">
			
			<div class="ytism-view-grid">
				<!-- Subscription Info Card -->
				<div class="ytism-card">
					<h2><?php esc_html_e( 'Subscription Information', 'ytism' ); ?></h2>
					<table class="form-table">
						<tr>
							<th><?php esc_html_e( 'Status', 'ytism' ); ?></th>
							<td><?php echo $this->get_status_badge( $subscription->status ); ?></td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Customer', 'ytism' ); ?></th>
							<td>
								<?php if ( $user ) : ?>
									<a href="<?php echo get_edit_user_link( $subscription->user_id ); ?>">
										<?php echo esc_html( $user->display_name ); ?>
									</a>
									<br><small><?php echo esc_html( $user->user_email ); ?></small>
								<?php else : ?>
									<?php esc_html_e( 'Unknown', 'ytism' ); ?>
								<?php endif; ?>
							</td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Gateway', 'ytism' ); ?></th>
							<td>
								<strong><?php echo esc_html( ucfirst( $subscription->gateway ) ); ?></strong>
								<br><code><?php echo esc_html( $subscription->gateway_sub_id ); ?></code>
							</td>
						</tr>
						<?php if ( $subscription->customer_id ) : ?>
						<tr>
							<th><?php esc_html_e( 'Customer ID', 'ytism' ); ?></th>
							<td><code><?php echo esc_html( $subscription->customer_id ); ?></code></td>
						</tr>
						<?php endif; ?>
						<?php if ( $subscription->plan_id ) : ?>
						<tr>
							<th><?php esc_html_e( 'Plan', 'ytism' ); ?></th>
							<td><?php echo esc_html( $subscription->plan_id ); ?></td>
						</tr>
						<?php endif; ?>
						<tr>
							<th><?php esc_html_e( 'Billing Cycle', 'ytism' ); ?></th>
							<td>
								<?php
								printf(
									esc_html__( 'Every %1$d %2$s', 'ytism' ),
									$subscription->billing_interval,
									$subscription->billing_cycle
								);
								?>
							</td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Quantity', 'ytism' ); ?></th>
							<td><?php echo esc_html( $subscription->qty ); ?></td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Current Period', 'ytism' ); ?></th>
							<td>
								<?php
								echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $subscription->period_start ) ) );
								echo ' - ';
								echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $subscription->period_end ) ) );
								?>
							</td>
						</tr>
						<?php if ( $subscription->next_billing_at ) : ?>
						<tr>
							<th><?php esc_html_e( 'Next Billing', 'ytism' ); ?></th>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $subscription->next_billing_at ) ) ); ?></td>
						</tr>
						<?php endif; ?>
						<?php if ( $subscription->trial_start_at ) : ?>
						<tr>
							<th><?php esc_html_e( 'Trial Period', 'ytism' ); ?></th>
							<td>
								<?php
								printf(
									esc_html__( '%1$s to %2$s', 'ytism' ),
									date_i18n( get_option( 'date_format' ), strtotime( $subscription->trial_start_at ) ),
									date_i18n( get_option( 'date_format' ), strtotime( $subscription->trial_end_at ) )
								);
								?>
							</td>
						</tr>
						<?php endif; ?>
						<tr>
							<th><?php esc_html_e( 'Created', 'ytism' ); ?></th>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $subscription->created_at ) ) ); ?></td>
						</tr>
					</table>
				</div>
				
				<!-- Statistics Card -->
				<div class="ytism-card">
					<h2><?php esc_html_e( 'Statistics', 'ytism' ); ?></h2>
					<table class="form-table">
						<tr>
							<th><?php esc_html_e( 'Total Transactions', 'ytism' ); ?></th>
							<td><strong><?php echo esc_html( $stats->total_transactions ); ?></strong></td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Successful', 'ytism' ); ?></th>
							<td><span class="ytism-badge ytism-badge-success"><?php echo esc_html( $stats->successful ); ?></span></td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Failed', 'ytism' ); ?></th>
							<td><span class="ytism-badge ytism-badge-error"><?php echo esc_html( $stats->failed ); ?></span></td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Total Revenue', 'ytism' ); ?></th>
							<td><strong><?php echo esc_html( number_format( $stats->total_revenue, 2 ) ); ?></strong></td>
						</tr>
					</table>
				</div>
			</div>
			
			<!-- Timeline -->
			<div class="ytism-card ytism-timeline-card">
				<h2><?php esc_html_e( 'Timeline', 'ytism' ); ?></h2>
				<div class="ytism-timeline">
					<?php foreach ( $timeline as $event ) : ?>
						<div class="ytism-timeline-item ytism-status-<?php echo esc_attr( $event['status'] ); ?>">
							<div class="ytism-timeline-marker"></div>
							<div class="ytism-timeline-content">
								<div class="ytism-timeline-date">
									<?php echo esc_html( date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $event['date'] ) ) ); ?>
								</div>
								<h4><?php echo esc_html( $event['title'] ); ?></h4>
								<p><?php echo esc_html( $event['description'] ); ?></p>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			</div>
			
			<!-- Transactions Table -->
			<div class="ytism-card">
				<h2><?php esc_html_e( 'All Transactions', 'ytism' ); ?></h2>
				<table class="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'ID', 'ytism' ); ?></th>
							<th><?php esc_html_e( 'Type', 'ytism' ); ?></th>
							<th><?php esc_html_e( 'Amount', 'ytism' ); ?></th>
							<th><?php esc_html_e( 'Status', 'ytism' ); ?></th>
							<th><?php esc_html_e( 'Date', 'ytism' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php if ( empty( $transactions ) ) : ?>
							<tr>
								<td colspan="5"><?php esc_html_e( 'No transactions found.', 'ytism' ); ?></td>
							</tr>
						<?php else : ?>
							<?php foreach ( $transactions as $txn ) : ?>
								<tr>
									<td><strong>#<?php echo esc_html( $txn->ID ); ?></strong></td>
									<td><?php echo esc_html( ucfirst( str_replace( '_', ' ', $txn->type ) ) ); ?></td>
									<td>
										<strong><?php echo esc_html( number_format( $txn->amount, 2 ) ); ?></strong>
										<?php echo esc_html( strtoupper( $txn->currency ) ); ?>
									</td>
									<td><?php echo $this->get_status_badge( $txn->status ); ?></td>
									<td>
										<?php
										$date = $txn->processed_at ?: $txn->created_at;
										echo esc_html( date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $date ) ) );
										?>
									</td>
								</tr>
							<?php endforeach; ?>
						<?php endif; ?>
					</tbody>
				</table>
			</div>
		</div>
		<?php
	}

	private function get_status_badge( $status ) {
		$status = $status ?? 'unknown';  // Add null coalescing

		$class_map = [
			'active'    => 'success',
			'trialing'  => 'info',
			'succeeded' => 'success',
			'pending'   => 'warning',
			'failed'    => 'error',
			'canceled'  => 'error',
			'expired'   => 'error',
			'past_due'  => 'warning',
			'refunded'  => 'warning',
			'disputed'  => 'error',
		];

		$class = isset( $class_map[ $status ] ) ? $class_map[ $status ] : 'default';
		$label = ucfirst( str_replace( '_', ' ', $status ) );

		return sprintf(
			'<span class="ytism-badge ytism-badge-%s">%s</span>',
			esc_attr( $class ),
			esc_html( $label )
		);
	}
}