<?php
/**
 * Main Plugin Class
 *
 * @package YTISM
 */

namespace YTISM\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Main Plugin Class - Singleton Pattern
 */
final class Plugin {

	/**
	 * Single instance
	 *
	 * @var Plugin|null
	 */
	private static ?Plugin $instance = null;

	/**
	 * Option name for settings
	 *
	 * @var string
	 */
	private static string $option_name = 'ytism_settings';

	/**
	 * Auth slug for rewrite rules
	 *
	 * @var string
	 */
	private static string $auth_slug = 'ytism-alias-auth';

	/**
	 * Minimum DB versions (MariaDB 10.2.7+ supports JSON natively)
	 */
	private const MIN_MYSQL_VERSION   = '5.7.8';
	private const MIN_MARIADB_VERSION = '10.2.7';

	/**
	 * Get singleton instance
	 */
	public static function instance(): Plugin {
		return self::$instance ??= new self();
	}

	/**
	 * Private constructor
	 */
	private function __construct() {
		// Keep lightweight.
	}

	/**
	 * Initialize plugin
	 *
	 * @return void
	 */
	public function init(): void {
		// Load translations.
		load_plugin_textdomain( 'ytism', false, dirname( plugin_basename( YTISM_PLUGIN_FILE ) ) . '/languages' );

		// Plugin action links.
		add_filter( 'plugin_action_links_' . plugin_basename( YTISM_PLUGIN_FILE ), array( $this, 'plugin_action_links' ) );

		if ( class_exists( 'YTISM\\Core\\Menu' ) ) {
			$menu = new \YTISM\Core\Menu();
			$menu->init();
		}

		if ( is_admin() ) {
			// Admin specific initializations.
			$this->init_admin();
		}

		$this->init_frontend();
	}

	/**
	 * Initialize admin
	 *
	 * @return void
	 */
	private function init_admin(): void {
		if ( class_exists( 'YTISM\\Admin\\Settings' ) ) {
			$settings = new \YTISM\Admin\Settings();
			$settings->init();
		}
	}

	/**
	 * Initialize frontend
	 *
	 * @return void
	 */
	private function init_frontend(): void {
		if ( class_exists( 'YTISM\\Public\\Services' ) ) {
			$services = new \YTISM\Public\Services();
			$services->init();
		}

		if ( class_exists( 'YTISM\\Public\\Auth' ) ) {
			$auth = new \YTISM\Public\Auth();
			$auth->init();
		}

		if ( class_exists( 'YTISM\\Public\\Front_Functions' ) ) {
			$functions = new \YTISM\Public\Front_Functions();
			$functions->init();
		}
	}

	/**
	 * Plugin action links
	 *
	 * @param array<string, string> $links Array of plugin action links.
	 * @return array<string, string>
	 */
	public function plugin_action_links( array $links ): array {
		$settings_link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( admin_url( 'admin.php?page=ytism-subscription' ) ),
			esc_html__( 'Settings', 'ytism' )
		);
		array_unshift( $links, $settings_link );
		return $links;
	}

	// ===============================================.
	// ACTIVATION.
	// ===============================================.

	/**
	 * Plugin activation
	 *
	 * @return void
	 */
	public static function activate(): void {
		// Check requirements.
		$error = self::check_requirements();

		if ( true !== $error ) {
			// Clean output buffers before wp_die.
			while ( ob_get_level() > 0 ) {
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				@ob_end_clean();
			}

			// Now wp_die (this PREVENTS activation).
			wp_die(
				'<p><strong>' . esc_html__( 'Plugin Activation Failed', 'ytism' ) . '</strong></p><p>' . esc_html( $error ) . '</p>',
				esc_html__( 'YouTuneIn Subscription Management', 'ytism' ),
				array(
					'back_link' => true,
					'response'  => 200,
				)
			);
		}

		// Requirements met - proceed with activation.
		self::create_tables();
		self::set_default_settings();
		self::create_default_pages();
		self::add_rewrite_rules();
		flush_rewrite_rules();
	}

	/**
	 * Check requirements - returns true or error message
	 *
	 * @return bool|string
	 */
	private static function check_requirements(): bool|string {
		$min_php = '8.0.0';
		$min_wp  = '6.0.0';

		// Check PHP version.
		if ( version_compare( PHP_VERSION, $min_php, '<' ) ) {
			return sprintf(
				// translators: %1$s: minimum PHP version required, %2$s: detected PHP version.
				__( 'YouTuneIn Subscription Management requires PHP %1$s or higher. Your server is running PHP %2$s.', 'ytism' ),
				$min_php,
				PHP_VERSION
			);
		}

		// Check WordPress.
		$wp_version = get_bloginfo( 'version' );
		if ( version_compare( $wp_version, $min_wp, '<' ) ) {
			return sprintf(
				// translators: %1$s: minimum WP version required, %2$s: detected WP version.
				__( 'YouTuneIn Subscription Management requires WordPress %1$s or higher. Your site runs %2$s.', 'ytism' ),
				$min_wp,
				$wp_version
			);
		}

		// Check database.
		$db_error = self::check_db_version();
		if ( true !== $db_error ) {
			return $db_error;
		}

		return true;
	}

	/**
	 * Check database version
	 *
	 * @return bool|string
	 */
	private static function check_db_version(): bool|string {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$version_str = $wpdb->get_var( 'SELECT VERSION()' );

		if ( empty( $version_str ) || ! is_string( $version_str ) ) {
			return __( 'Could not detect database version.', 'ytism' );
		}

		$version_lower = strtolower( $version_str );

		// MariaDB detection.
		if ( strpos( $version_lower, 'mariadb' ) !== false ) {
			if ( preg_match( '/(\d+\.\d+\.\d+)/', $version_str, $m ) ) {
				$version = $m[1];
			} elseif ( preg_match( '/(\d+\.\d+)/', $version_str, $m ) ) {
				$version = $m[1] . '.0';
			} else {
				$version = '0.0.0';
			}

			if ( version_compare( $version, self::MIN_MARIADB_VERSION, '<' ) ) {
				return sprintf(
					// translators: %1$s: minimum MariaDB version required, %2$s: detected MariaDB version string.
					__( 'YouTuneIn Subscription Management requires MariaDB %1$s or higher (for JSON support). Detected: %2$s', 'ytism' ),
					self::MIN_MARIADB_VERSION,
					$version_str
				);
			}

			return true;
		}

		// MySQL detection.
		if ( preg_match( '/(\d+\.\d+\.\d+)/', $version_str, $m ) ) {
			$version = $m[1];
		} elseif ( preg_match( '/(\d+\.\d+)/', $version_str, $m ) ) {
			$version = $m[1] . '.0';
		} else {
			$version = '0.0.0';
		}

		if ( version_compare( $version, self::MIN_MYSQL_VERSION, '<' ) ) {
			return sprintf(
				// translators: %1$s: minimum MySQL version required, %2$s: detected MySQL version string.
				__( 'YouTuneIn Subscription Management requires MySQL %1$s or higher (for JSON support). Detected: %2$s', 'ytism' ),
				self::MIN_MYSQL_VERSION,
				$version_str
			);
		}

		return true;
	}

	/**
	 * Create database tables
	 *
	 * @return void
	 */
	private static function create_tables(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset_collate = $wpdb->get_charset_collate();

		// Alias users table.
		$alias_users_table = $wpdb->prefix . 'ytism_alias_users';
		$sql1              = "CREATE TABLE {$alias_users_table} (
            ID BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            wp_user_id BIGINT(20) UNSIGNED NOT NULL,
            alias_user_id BIGINT(20) UNSIGNED DEFAULT NULL,
            login_token TEXT DEFAULT NULL,
            userdata JSON DEFAULT NULL,
            last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ID),
            UNIQUE KEY ux_wp_user (wp_user_id),
            UNIQUE KEY ux_alias_user (alias_user_id),
            KEY idx_last_sync (last_sync)
        ) {$charset_collate};";

		dbDelta( $sql1 );

		// Subscriptions table.
		$subs_table = $wpdb->prefix . 'ytism_sub_orders';
		$sql2       = "CREATE TABLE {$subs_table} (
			ID BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			user_id BIGINT(20) UNSIGNED NOT NULL,
			gateway VARCHAR(50) NOT NULL,
			sub_id VARCHAR(100) NOT NULL,
			plan_items JSON DEFAULT NULL,
			customer_id VARCHAR(100) NOT NULL,
			sub_status ENUM('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'paused', 'expired') NOT NULL DEFAULT 'incomplete',
			last_txn_id VARCHAR(100) DEFAULT NULL,
			last_txn_status ENUM('pending', 'processing', 'succeeded', 'failed', 'requires_action', 'canceled', 'refunded', 'disputed', 'completed') DEFAULT 'pending',
			last_payment_method JSON DEFAULT NULL,
			qty INT(10) UNSIGNED NOT NULL DEFAULT 1,
			amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			currency CHAR(3) NOT NULL DEFAULT 'USD',
			period_start DATETIME NOT NULL,
			period_end DATETIME NOT NULL,
			next_billing_at DATETIME DEFAULT NULL,
			trial_start_at DATETIME DEFAULT NULL,
			trial_end_at DATETIME DEFAULT NULL,
			activated_at DATETIME DEFAULT NULL,
			canceled_at DATETIME DEFAULT NULL,
			billing_cycle ENUM('day','week','month','year') NOT NULL DEFAULT 'month',
			billing_interval TINYINT(2) UNSIGNED NOT NULL DEFAULT 1,
			metadata JSON DEFAULT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (ID),
			UNIQUE KEY ux_gateway_sub (gateway, sub_id),
			KEY idx_user_status (user_id, sub_status),
			KEY idx_next_billing (next_billing_at),
			KEY idx_customer (gateway, customer_id),
			KEY idx_trial_end (trial_end_at),
			KEY idx_sub_status (sub_status),
			KEY idx_txn_id (gateway, last_txn_id)
		) {$charset_collate};";

		dbDelta( $sql2 );

		// Events table.
		$events_table = $wpdb->prefix . 'ytism_sub_order_log';
		$sql3         = "CREATE TABLE {$events_table} (
			ID BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			ref_id BIGINT(20) UNSIGNED NOT NULL,
			ref_type ENUM('subscription','charge','customer','invoice','checkout','payment_intent','setup_intent','payment_method','payout','transaction') NOT NULL,
			ref_status VARCHAR(100) NOT NULL,
			event_uid VARCHAR(100) NOT NULL,
			severity ENUM('info','success','warning','error','critical') DEFAULT 'info',
			message TEXT NOT NULL,
			data JSON DEFAULT NULL,
			retry_count TINYINT(2) UNSIGNED DEFAULT 0,
			user_id BIGINT(20) UNSIGNED DEFAULT NULL,
			ip VARCHAR(45) DEFAULT NULL,
			user_agent VARCHAR(255) DEFAULT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (ID),
			UNIQUE KEY ux_ref (ref_id, ref_type, ref_status, event_uid),
			KEY idx_uid (event_uid),
			KEY idx_severity (severity),
			KEY idx_created (created_at),
			KEY idx_user (user_id),
			KEY idx_ref_id (ref_id),
			CONSTRAINT fk_log_subscription FOREIGN KEY (ref_id) REFERENCES {$subs_table} (ID) ON DELETE CASCADE ON UPDATE CASCADE
		) {$charset_collate};";

		dbDelta( $sql3 );

		update_option( 'ytism_db_version', YTISM_PLUGIN_VER );
	}

	/**
	 * Set default settings
	 *
	 * @return void
	 */
	private static function set_default_settings(): void {
		$settings = (array) get_option( self::$option_name, array() );

		$defaults = array(
			'version'   => YTISM_PLUGIN_VER,
			'auth_slug' => self::$auth_slug,
		);

		$settings = array_replace_recursive( $defaults, $settings );
		update_option( self::$option_name, $settings );
	}

	/**
	 * Extract shortcode name from content string
	 *
	 * @param string $content The content string to search for a shortcode.
	 * @return string
	 */
	private static function extract_shortcode_name( string $content ): string {
		if ( preg_match( '/\[([^\s\]]+)/', $content, $matches ) ) {
			return $matches[1];
		}
		return '';
	}

	/**
	 * Create default pages
	 *
	 * @return void
	 */
	private static function create_default_pages(): void {
		$settings = (array) get_option( self::$option_name, array() );

		$pages = [
			'individual'   => array(
				'title'   => 'Individual Purchase',
				'slug'    => 'purchase-individual-plan',
				'content' => '[ytism_purchase_form plan="individual"]',
			),
			'family'       => array(
				'title'   => 'Family Purchase',
				'slug'    => 'purchase-family-plan',
				'content' => '[ytism_purchase_form plan="family"]',
			),
			'enterprise'   => array(
				'title'   => 'Enterprise Purchase',
				'slug'    => 'purchase-enterprise-plan',
				'content' => '[ytism_purchase_form plan="enterprise"]',
			),
			'checkout'     => array(
				'title'   => 'Checkout',
				'slug'    => 'subscription-checkout',
				'content' => '[ytism_checkout]',
			),
			'myaccount'    => array(
				'title'   => 'My Account',
				'slug'    => 'my-account',
				'content' => '[ytism_account_dashboard]',
			),
			'ordersummary' => array(
				'title'   => 'Order Summary',
				'slug'    => 'order-summary',
				'content' => '[ytism_order_summary]',
			),
			'thankyou'     => array(
				'title'   => 'Thank You',
				'slug'    => 'thank-you',
				'content' => '[ytism_thank_you]',
			),
		];

		foreach ( $pages as $key => $page ) {
			$is_plan_page = in_array( $key, array( 'individual', 'family', 'enterprise' ), true );

			if ( $is_plan_page ) {
				if ( ! isset( $settings[ $key ]['page_id'] ) || empty( $settings[ $key ]['page_id'] ) ) {
					$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
					$page_id  = 0;

					// Check if existing page has the required shortcode.
					if ( $existing && $existing instanceof \WP_Post && 'publish' === $existing->post_status && has_shortcode( $existing->post_content, self::extract_shortcode_name( $page['content'] ) ) ) {
						$page_id = (int) $existing->ID;
					} else {
						// Create new page since existing one doesn't have the shortcode.
						$page_id = wp_insert_post(
							array(
								'post_title'   => wp_strip_all_tags( $page['title'] ),
								'post_name'    => sanitize_title( $page['slug'] ),
								'post_content' => $page['content'],
								'post_status'  => 'publish',
								'post_type'    => 'page',
								'post_author'  => absint( get_current_user_id() ),
							)
						);

						if ( is_wp_error( $page_id ) ) {
							continue;
						}

						$page_id = (int) $page_id;
					}

					if ( $page_id > 0 ) {
						$settings[ $key ]['page_id'] = $page_id;

						// Initialize product_id if not set.
						if ( ! isset( $settings[ $key ]['product_id'] ) ) {
							$settings[ $key ]['product_id'] = '';
						}
					}
				}
			} else {
				$setting_key = $key . '_page_id';

				if ( ! isset( $settings[ $setting_key ] ) || empty( $settings[ $setting_key ] ) ) {
					$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
					$page_id  = 0;

					// Check if existing page has the required shortcode.
					if ( $existing && $existing instanceof \WP_Post && 'publish' === $existing->post_status && has_shortcode( $existing->post_content, self::extract_shortcode_name( $page['content'] ) ) ) {
						$page_id = (int) $existing->ID;
					} else {
						// Create new page since existing one doesn't have the shortcode.
						$page_id = wp_insert_post(
							array(
								'post_title'   => wp_strip_all_tags( $page['title'] ),
								'post_name'    => sanitize_title( $page['slug'] ),
								'post_content' => $page['content'],
								'post_status'  => 'publish',
								'post_type'    => 'page',
								'post_author'  => absint( get_current_user_id() ),
							)
						);

						if ( is_wp_error( $page_id ) ) {
							continue;
						}

						$page_id = (int) $page_id;
					}

					if ( $page_id > 0 ) {
						$settings[ $setting_key ] = $page_id;
					}
				}
			}
		}

		update_option( self::$option_name, $settings );
	}

	/**
	 * Add rewrite rules for custom routes
	 *
	 * @return void
	 */
	private static function add_rewrite_rules(): void {
		// Auth routes.
		add_rewrite_rule( '^' . self::$auth_slug . '/?$', 'index.php?ytism_alias_auth=login', 'top' );
		add_rewrite_rule( '^' . self::$auth_slug . '/register/?$', 'index.php?ytism_alias_auth=register', 'top' );
		add_rewrite_rule( '^' . self::$auth_slug . '/verify-email/?$', 'index.php?ytism_alias_auth=verify-email', 'top' );
		add_rewrite_rule( '^' . self::$auth_slug . '/forget-password/?$', 'index.php?ytism_alias_auth=forget-password', 'top' );
		add_rewrite_rule( '^' . self::$auth_slug . '/reset-password/?$', 'index.php?ytism_alias_auth=reset-password', 'top' );
		add_rewrite_rule( '^' . self::$auth_slug . '/verify-otp/?$', 'index.php?ytism_alias_auth=verify-otp', 'top' );
		add_rewrite_tag( '%ytism_alias_auth%', '([^&]+)' );

		// My Account routes (all translations).
		$settings          = (array) get_option( self::$option_name, array() );
		$myaccount_page_id = (int) ( $settings['myaccount_page_id'] ?? 0 );

		if ( $myaccount_page_id > 0 ) {
			$page_ids = array( $myaccount_page_id );
			// WPML support: get all translations of the myaccount page.
			if ( function_exists( 'wpml_object_id' ) ) {
				$languages = apply_filters( 'wpml_active_languages', null, array( 'skip_missing' => 0 ) );
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

			$slugs = array();
			if ( ! empty( $page_ids ) ) {
				$pages = get_posts(
					array(
						'post_type'   => 'page',
						'post_status' => 'publish',
						'post__in'    => $page_ids,
						'numberposts' => -1,
					)
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
		}

		update_option( 'ytism_flush_rewrite_rules', true );
		flush_rewrite_rules();
	}

	// ===============================================.
	// DEACTIVATION.
	// ===============================================.

	/**
	 * Plugin deactivation
	 *
	 * @return void
	 */
	public static function deactivate(): void {
		flush_rewrite_rules();
	}

	/**
	 * Clear cron events
	 *
	 * @return void
	 */
	private static function clear_cron_events(): void {
		$timestamp = wp_next_scheduled( 'ytism_daily_status_check' );
		if ( false !== $timestamp ) {
			wp_unschedule_event( (int) $timestamp, 'ytism_daily_status_check' );
		}
		wp_clear_scheduled_hook( 'ytism_daily_status_check' );
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone(): void {}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 * @throws \Exception If an attempt is made to unserialize the singleton instance.
	 */
	public function __wakeup(): void {
		throw new \Exception( 'Cannot unserialize singleton' );
	}
}
