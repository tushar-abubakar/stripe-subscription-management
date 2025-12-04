<?php
/**
 * Subscription Order Class
 *
 * @package YTISM
 * @subpackage Core
 */

namespace YTISM\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Sub_Order_Object
 *
 * Represents a subscription order record as an object.
 */
class Sub_Order {
	public ?int $ID = null;
	public ?string $gateway = null;
	public ?string $sub_id = null;
	public ?int $user_id = null;
	public ?array $plan_items = null;
	public ?string $customer_id = null;
	public ?string $sub_status = null;
	public ?string $last_txn_id = null;
	public ?string $last_txn_status = null;
	public ?array $last_payment_method = null;
	public ?int $qty = null;
	public ?float $amount = null;
	public ?string $currency = null;
	public ?string $period_start = null;
	public ?string $period_end = null;
	public ?string $next_billing_at = null;
	public ?string $trial_start_at = null;
	public ?string $trial_end_at = null;
	public ?string $activated_at = null;
	public ?string $canceled_at = null;
	public ?string $billing_cycle = null;
	public ?int $billing_interval = null;
	public ?array $metadata = null;
	public ?string $created_at = null;
	public ?string $updated_at = null;

	/**
	 * Constructor
	 *
	 * @param array|object $data Raw database row data.
	 */
	public function __construct( $data ) {
		foreach ( $data as $key => $value ) {
			if ( property_exists( $this, $key ) ) {
				$this->$key = $value;
			}
		}
	}

	/**
	 * Convert object to array
	 *
	 * @return array
	 */
	public function to_array(): array {
		return get_object_vars( $this );
	}
}