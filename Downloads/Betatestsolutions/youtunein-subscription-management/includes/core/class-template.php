<?php
namespace YTISM\Core;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Template {
    /**
     * Locate a template file.
     *
     * @param string $template_name  The filename, e.g. 'individual-plan.php'
     * @return string
     */
    public static function locate( $template_name ) {
        $theme_path   = trailingslashit( get_stylesheet_directory() ) . 'ytism/templates/' . $template_name;
        $parent_path  = trailingslashit( get_template_directory() ) . 'ytism/templates/' . $template_name;
        $plugin_path  = YTISM_PLUGIN_DIR . 'views/' . $template_name;

        if ( file_exists( $theme_path ) ) {
            return $theme_path;
        } elseif ( file_exists( $parent_path ) ) {
            return $parent_path;
        }

        return $plugin_path;
    }

    /**
     * Load a template
     */
    public static function load( $template_name, $args = [] ) {
        static $is_loading_template = [];

        if ( isset( $is_loading_template[ $template_name ] ) && $is_loading_template[ $template_name ] ) {
            return;
        }

        $is_loading_template[ $template_name ] = true;

        $template = self::locate( $template_name );

        if ( ! empty( $args ) && is_array( $args ) ) {
            extract( $args, EXTR_SKIP );
        }

        if ( file_exists( $template ) ) {
            include $template;
        }

        $is_loading_template[ $template_name ] = false;
    }

}
