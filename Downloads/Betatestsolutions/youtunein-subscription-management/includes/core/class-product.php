<?php
namespace YTISM\Core;
use WP_Error;

/**
 * Product class to handle Stripe Product and associated Prices
 * @package YTISM\Core
 * @author  Abubakar Wazih Tushar
 * @since   1.0.0
 * 
 * Usage:
 * $product = new Product('individual');  // 'individual', 'family', or 'enterprise'
 * $currencies = $product->get_available_currencies();
 */
class Product {
    /**
     * @var object|WP_Error  Valid Stripe product object or WP_Error if invalid/fetch failed.
     */
    private $product_object;
    private $currency = null;

    /**
     * Product constructor.
     *
     * @param string $type    Product type: 'individual', 'family', or 'enterprise'.
     * @param bool   $refresh Force refresh from Stripe.
     */
    public function __construct( string $type, bool $refresh = false, string $currency = null ) {
        $allowed = [ 'individual', 'family', 'enterprise' ];
        if ( ! in_array( $type, $allowed, true ) ) {
            $this->product_object = new WP_Error(
                'invalid_product_type',
                sprintf(
                    __( 'Invalid product type "%s". Allowed types: %s', 'ytism' ),
                    esc_html( $type ),
                    implode( ', ', $allowed )
                )
            );
            return;
        }
        
        $this->currency = $currency ? strtolower($currency) : null;

        try {
            $spm = Stripe_Product_Manager::instance();
            $product = $spm->get_product_by_type( $type, $refresh );

            if ( ! is_object( $product ) || empty( $product->id ) ) {
                $this->product_object = new WP_Error(
                    'invalid_product_object',
                    __( 'The product data returned from Stripe is invalid.', 'ytism' )
                );
                return;
            }

            $this->product_object = $product;

        } catch ( \Throwable $e ) {
            $this->product_object = new WP_Error(
                'product_fetch_error',
                sprintf(
                    __( 'Error fetching product data: %s', 'ytism' ),
                    $e->getMessage()
                )
            );
        }

        $available_currencies = $this->get_available_currencies();
        if ( $this->currency && in_array( strtolower($this->currency), $available_currencies, true ) ) {
            $this->currency = strtolower($this->currency);
        } else {
            foreach ( $available_currencies as $index => $currency_code ) {
                if ( isset( $this->product_object->default_price->currency ) && $this->product_object->default_price->currency === $currency_code ) {
                    $this->currency = $currency_code;
                    break;
                }
                if ( $index === 0 ) {
                    $this->currency = $currency_code;
                }
            }
        }
    }

    /**
     * Get the validated product object or WP_Error.
     *
     * @return object|WP_Error
     */
    public function get_object() {
        return $this->product_object;
    }

    /**
     * Check if the product object is a WP_Error.
     *
     * @return bool
     */
    public function has_error(): bool {
        return is_wp_error( $this->product_object );
    }

    /**
     * Convenience method: Get error message if any.
     *
     * @return string|null
     */
    public function get_error_message(): ?string {
        return $this->has_error()
            ? $this->product_object->get_error_message()
            : null;
    }

    /**
     * Get Product ID
     */
    public function get_id(): ?string {
        return $this->has_error() ? null : ( $this->product_object->id ?? null );
    }

    /**
     * Get Product Name
     */
    public function get_name(): ?string {
        return $this->has_error() ? null : ( $this->product_object->name ?? null );
    }

    /**
     * Get Product Description
     */
    public function get_description(): ?string {
        return $this->has_error() ? null : ( $this->product_object->description ?? null );
    }

    /**
     * Get all available currencies for this product
     *
     * @return array
     */
    public function get_available_currencies() {
        $currencies = [];

        foreach ( $this->get_prices() as $price ) {
            $price_currencies = $price->get_available_currencies();
            $currencies = array_merge( $currencies, $price_currencies );
        }

        $currencies = array_unique( $currencies );
        sort( $currencies );
        return $currencies;
    }

    /**
     * Get all Price objects for this product
     *
     * @return Price[]
     */
    public function get_prices() {
        $prices = [];
        if ( ! $this->product_object || ! property_exists( $this->product_object, 'prices' ) || ! is_array( $this->product_object->prices ) ) {
            return [];
        }

        foreach ( $this->product_object->prices as $price_object ) {
            $price = new Price( $price_object );
            if ( $price->has_error() ) {
                continue;
            }
            $prices[] = $price;
        }

        return $prices;
    }

    /**
     * Get Price object by Price ID
     *
     * @param string $price_id
     * @return Price|null
     */
    public function get_price( string $price_id ) {
        foreach ( $this->get_prices() as $price ) {
            if ( $price->get_id() === $price_id ) {
                return $price;
            }
        }

        return null;
    }

    /**
     * Get the default Price object for this product
     *
     * @return Price|null
     */
    public function get_default_price() {
        if ( ! $this->product_object || ! property_exists( $this->product_object, 'default_price' ) ) {
            return null;
        }

        foreach ( $this->get_prices() as $price ) {
            if ( $price->get_id() === ( $this->product_object->default_price->id ?? null ) ) {
                return $price;
            }
        }
        return null;
    }

    /**
     * Get the Price object for initiating checkout
     * Prefers the price in $this->currency if set, otherwise falls back to default price
     *
     * @return Price|null
     */
    public function get_initiate_checkout_currency() {
        return $this->currency;
    }
}