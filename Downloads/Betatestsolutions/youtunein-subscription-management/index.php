<?php
/**
 * Plugin Name: Stripe Subscription Management
 * Description: Subscription plugin with admin settings, plan management, and frontend display with WP-ML translation support.
 * Author: Abubakar Wazih Tushar
 * Version: 3.0.0
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Text Domain: ytism
 * License: GPL v2 or later
 *
 * @package YTISM
 * @author  Abubakar Wazih Tushar
 * @since   1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

defined( 'YTISM_PLUGIN_VER' ) || define( 'YTISM_PLUGIN_VER', '3.0.0' );
defined( 'YTISM_PLUGIN_FILE' ) || define( 'YTISM_PLUGIN_FILE', __FILE__ );
defined( 'YTISM_PLUGIN_DIR' ) || define( 'YTISM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
defined( 'YTISM_PLUGIN_URL' ) || define( 'YTISM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Minimum requirements check.
if ( version_compare( PHP_VERSION, '8.0', '<' ) ) {
	add_action(
		'admin_notices',
		function () {
			echo '<div class="error"><p>';
			echo esc_html__( 'YouTuneIn Subscription Management requires PHP 8.0 or higher.', 'ytism' );
			echo '</p></div>';
		}
	);
	return;
}

// Load Composer autoloader.
require_once YTISM_PLUGIN_DIR . 'vendor/autoload.php';

// Simple autoloader.
spl_autoload_register(
	function ( $class_name ) {
		if ( strpos( $class_name, 'YTISM\\' ) !== 0 ) {
			return;
		}

		$path     = str_replace( 'YTISM\\', '', $class_name );
		$path     = str_replace( '\\', '/', $path );
		$parts    = explode( '/', $path );
		$filename = 'class-' . strtolower( str_replace( '_', '-', array_pop( $parts ) ) ) . '.php';
		$dir      = strtolower( implode( '/', $parts ) );
		$file     = YTISM_PLUGIN_DIR . 'includes/' . $dir . '/' . $filename;

		if ( file_exists( $file ) ) {
			require_once $file;
		}
	}
);

// Initialize the plugin.
add_action(
	'plugins_loaded',
	function () {
		// Initialize the main plugin class.
		\YTISM\Core\Plugin::instance()->init();

		// Custom action hook after plugin initialization.
		do_action( 'ytism_activated' );
	}
);

// Activation hook.
register_activation_hook(
	YTISM_PLUGIN_FILE,
	function () {
		\YTISM\Core\Plugin::instance()->activate();
	}
);

// Deactivation hook.
register_deactivation_hook(
	YTISM_PLUGIN_FILE,
	function () {
		\YTISM\Core\Plugin::instance()->deactivate();
	}
);
