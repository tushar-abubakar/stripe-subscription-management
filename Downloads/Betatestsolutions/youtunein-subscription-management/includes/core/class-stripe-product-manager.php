<?php
namespace YTISM\Core;
use Exception;
use Stripe\StripeClient;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Stripe_Product_Manager {

    private static $instance = null;
    private $client;
    private $option_name = 'ytism_settings';
    private $settings;
    private $tracked_products = [];

    /**
     * Singleton instance
     */
    public static function instance() {
        if ( self::$instance === null ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {
        $this->init_client_from_settings();

        // Build product list
        $this->build_tracked_products();

        // Hooks
        add_action( 'update_option_' . $this->option_name, [ $this, 'maybe_refresh_products' ], 10, 2 );
    }

    /**
     * Initialize Stripe client from settings
     */
    private function init_client_from_settings( $settings = null ) {
        $this->settings = $settings ?? get_option( $this->option_name, [] );

        $secret_key = $this->settings['stripe_secret_key'] ?? '';
        if ( ! empty( $secret_key ) ) {
            $this->client = new StripeClient( $secret_key );
        }
    }

    /**
     * Build tracked products array
     */
    private function build_tracked_products() {
        $this->tracked_products = array_filter([
            'individual' => $this->settings['individual']['product_id'] ?? '',
            'family'     => $this->settings['family']['product_id'] ?? '',
            'enterprise'  => $this->settings['enterprise']['product_id'] ?? '',
        ]);
    }

    public function get_tracked_products(): array {
        return $this->tracked_products;
    }

    /**
     * Refresh products when settings change
     */
    public function maybe_refresh_products( $old_value, $value ) {
        $this->init_client_from_settings( $value );
        $this->build_tracked_products();

        $keys = [ 'individual', 'family', 'enterprise' ];

        foreach ( $keys as $key ) {
            $old_id = $old_value[ $key ]['product_id'] ?? '';
            $new_id = $value[ $key ]['product_id'] ?? '';

            if ( $new_id && $new_id !== $old_id ) {
                $this->fetch_and_store_product( $new_id );
            }

            if ( $new_id && ! get_option( "ytim_product_{$new_id}" ) ) {
                $this->fetch_and_store_product( $new_id );
            }

            if($old_id && ($new_id !== $old_id || empty($new_id))){
                delete_option("ytim_product_{$old_id}");
            }
        }
    }

    /**
     * Maybe refresh a single product if it's tracked
     */
    public function maybe_refresh_product(string $product_id) {
        if (in_array($product_id, $this->tracked_products, true)) {
            $this->fetch_and_store_product($product_id);
            delete_transient('ytism_stripe_subscription_products');
        }
    }

    /**
     * Maybe delete product
     */
    public function maybe_delete_product(string $product_id) {
        if (in_array($product_id, $this->tracked_products, true)) {
            delete_option("ytim_product_{$product_id}");
            delete_transient('ytism_stripe_subscription_products');
        }
    }

    /**
     * Fetch and store product + prices from Stripe
     */
    private function fetch_and_store_product( string $product_id ) {
        if ( ! $this->client ) {
            return;
        }

        try {
            $product = $this->client->products->retrieve($product_id, ['expand' => ['default_price']]);

            if (empty($product) || ($product->deleted ?? false) || !$product->id) {
                delete_option("ytim_product_{$product_id}");
                return;
            }

            $prices = $this->client->prices->all([
                'product' => $product_id,
                'type' => 'recurring',
                'limit' => 100,
                'expand' => ['data.tiers', 'data.recurring', 'data.currency_options'],
            ]);

            if ( empty( $prices->data ) ) {
                $product->prices = [];
                update_option( "ytim_product_{$product_id}", wp_json_encode( $product ) );
                return;
            }

            foreach ($prices->data as $price) {
                $currency_options = $price->currency_options ?? [];

                if ( $price->billing_scheme !== 'tiered' || empty($currency_options) || ! $price->id ) {
                    continue;
                }

                $expanded_prices = [];
                foreach ($currency_options->toArray() as $currency => $cdata) {
                    if (!isset($cdata['tiers'])) {
                        $expanded_prices[] = "currency_options.$currency.tiers";
                    }
                }
                
                if ( !empty($expanded_prices) ) {
                    $currency_price = $this->client->prices->retrieve($price->id, [
                        'expand' => $expanded_prices
                    ]);
                    foreach ($currency_price->currency_options->toArray() as $currency => $cdata) {
                        $currency_options[$currency] = $cdata;
                    }
                }
                $price->currency_options = $currency_options;
            }
            $product->prices = $prices->data;

            update_option( "ytim_product_{$product_id}", wp_json_encode( $product ) );
        } catch ( Exception $e ) {
            error_log( __( 'Stripe_Product_Manager fetch error: ', 'ytism' ) . $e->getMessage() );
        }
    }

    /**
     * Get cached product
     */
    public function get_product( string $product_id, bool $refresh = false ): ?object {
        $raw = get_option( "ytim_product_{$product_id}" );
        if ( $refresh || ! $raw ) {
            $this->fetch_and_store_product( $product_id );
            $raw = get_option( "ytim_product_{$product_id}" );
        }
        return $raw ? json_decode( $raw ) : null;
    }

    /**
     * Get product by type
     */
    public function get_product_by_type( string $type, bool $refresh = false ): ?object {
        $product_id = $this->settings[ $type ]['product_id'] ?? '';
        return $product_id ? $this->get_product( $product_id, $refresh ) : null;
    }

    /**
     * Get individual product
     */
    public function get_individual_product( bool $refresh = false ): ?object {
        return $this->get_product_by_type( 'individual', $refresh );
    }
}