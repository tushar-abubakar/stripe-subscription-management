<?php
/**
 * Subscription Order CRUD Handler
 *
 * @package YTISM\Database
 */

namespace YTISM\Database;

use YTISM\Helpers\Functions;
use YTISM\Core\Sub_Order as Sub_Order_Object;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Sub_Order
 *
 * Handles CRUD operations for subscription orders with event logging.
 */
class Sub_Order {
	/**
	 * WordPress database object
	 *
	 * @var wpdb
	 */
	protected $wpdb;

	/**
	 * Subscription order table name
	 *
	 * @var string
	 */
	protected $order_table;

	/**
	 * Subscription order log table name
	 *
	 * @var string
	 */
	protected $log_table;

	/**
	 * JSON fields that need encoding/decoding
	 *
	 * @var array
	 */
	protected array $json_fields = [ 'plan_items', 'last_payment_method', 'metadata' ];

	/**
	 * Last created order ID
	 *
	 * @var int|null
	 */
	protected ?int $last_order_id = null;

	/**
	 * Last created log ID
	 *
	 * @var int|null
	 */
	protected ?int $last_log_id = null;

	/**
	 * Last error encountered
	 *
	 * @var WP_Error|null
	 */
	protected ?WP_Error $last_error = null;

	/**
	 * Pending changes to be saved
	 *
	 * @var array
	 */
	protected array $pending_changes = [];

	/**
	 * Current order being modified
	 *
	 * @var int|null
	 */
	protected ?int $current_order_id = null;

	/**
	 * Constructor
	 */
	public function __construct() {
		global $wpdb;
		$this->wpdb        = $wpdb;
		$this->order_table = $this->wpdb->prefix . 'ytism_sub_orders';
		$this->log_table   = $this->wpdb->prefix . 'ytism_sub_order_log';
	}

	/**
	 * Create a new subscription order record.
	 *
	 * @param array $data Subscription order data.
	 * @return self|WP_Error Returns self for method chaining or WP_Error on failure.
	 */
	public function create( array $data ): self|WP_Error {
		// Reset error state.
		$this->last_error = null;

		$defaults = [
			'gateway'             => 'stripe',
			'sub_id'              => '',
			'user_id'             => get_current_user_id(),
			'plan_items'          => [],
			'customer_id'         => '',
			'sub_status'          => 'incomplete',
			'last_txn_id'         => null,
			'last_txn_status'     => 'pending',
			'last_payment_method' => [],
			'qty'                 => 1,
			'amount'              => 0.00,
			'currency'            => 'USD',
			'period_start'        => current_time( 'mysql' ),
			'period_end'          => null,
			'next_billing_at'     => null,
			'trial_start_at'      => null,
			'trial_end_at'        => null,
			'activated_at'        => null,
			'canceled_at'         => null,
			'billing_cycle'       => 'month',
			'billing_interval'    => 1,
			'metadata'            => [],
			'created_at'          => current_time( 'mysql' ),
			'updated_at'          => current_time( 'mysql' ),
		];

		$data = wp_parse_args( $data, $defaults );

		foreach ( $this->json_fields as $field ) {
			if ( ! is_array( $data[ $field ] ) && ! empty( $data[ $field ] ) ) {
				return new WP_Error( "invalid_{$field}", ucfirst( $field ) . ' must be an array' );
			}
			$data[ $field ] = wp_json_encode( ! empty( $data[ $field ] ) ? $data[ $field ] : [] );
		}

		$inserted = $this->wpdb->insert(
			$this->order_table,
			$data,
			[
				'%s',
				'%s',
				'%d',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%d',
				'%f',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%d',
				'%s',
				'%s',
				'%s',
			]
		);

		if ( false === $inserted ) {
			return new WP_Error( 'db_insert_error', $this->wpdb->last_error );
		}

		$this->last_order_id = $this->wpdb->insert_id;

		return $this;
	}

	/**
	 * Add log entry for the last created order.
	 * Can be chained after create() or called independently.
	 *
	 * @param array $log_data Log data. Required keys: 'message'. Optional: 'event_uid', 'ref_type', 'ref_status', 'severity', 'data'.
	 * @return self Returns self for method chaining.
	 */
	public function add_log( array $log_data ): self {
		if ( null === $this->last_order_id ) {
			$this->last_error = new WP_Error( 'no_order_id', 'No order ID available. Call create() first or set order ID manually.' );
			return $this;
		}

		// Set defaults based on last created order.
		$defaults = [
			'ref_type'   => $log_data['ref_type'] ?? 'subscription',
			'ref_id'     => $this->last_order_id,
			'ref_status' => $log_data['ref_status'] ?? 'subscription.created',
			'event_uid'  => $log_data['event_uid'] ?? (string) time(),
			'severity'   => $log_data['severity'] ?? 'info',
			'message'    => '',
			'data'       => $log_data['data'] ?? [],
		];

		$log_data = wp_parse_args( $log_data, $defaults );

		// Validate required message.
		if ( empty( $log_data['message'] ) ) {
			$this->last_error = new WP_Error( 'missing_message', 'Log message is required.' );
			return $this;
		}

		$log_id = $this->create_log( $log_data );

		if ( ! $log_id || is_wp_error( $log_id ) ) {
			$this->last_error = is_wp_error( $log_id ) ? $log_id : new WP_Error( 'log_creation_failed', 'Failed to create log entry.' );
			Functions::log_debug( 'Failed to create event log: ' . $this->last_error->get_error_message() );
			return $this;
		}

		$this->last_log_id = $log_id;
		return $this;
	}

	/**
	 * Set the order ID for logging operations.
	 *
	 * @param int $order_id Order ID.
	 * @return self
	 */
	public function set_order_id( int $order_id ): self {
		$this->last_order_id = $order_id;
		return $this;
	}

	/**
	 * Get the last created order ID.
	 *
	 * @return int|null
	 */
	public function get_last_order_id(): ?int {
		return $this->last_order_id;
	}

	/**
	 * Get the last created log ID.
	 *
	 * @return int|null
	 */
	public function get_last_log_id(): ?int {
		return $this->last_log_id;
	}

	/**
	 * Check if the last operation had an error.
	 *
	 * @return bool True if there was an error, false otherwise.
	 */
	public function has_error(): bool {
		return null !== $this->last_error;
	}

	/**
	 * Get the last error.
	 *
	 * @return WP_Error|null
	 */
	public function get_error(): ?WP_Error {
		return $this->last_error;
	}

	/**
	 * Get the last error message.
	 *
	 * @return string Empty string if no error.
	 */
	public function get_error_message(): string {
		return $this->last_error ? $this->last_error->get_error_message() : '';
	}

	/**
	 * Get the last error code.
	 *
	 * @return string Empty string if no error.
	 */
	public function get_error_code(): string {
		return $this->last_error ? $this->last_error->get_error_code() : '';
	}

	/**
	 * Clear the last error.
	 *
	 * @return self
	 */
	public function clear_error(): self {
		$this->last_error = null;
		return $this;
	}

	/**
	 * Get subscription order by ID.
	 *
	 * @param int $id Subscription ID.
	 * @return Sub_Order_Object|null Subscription object or null on failure.
	 */
	public function get( int $id ): ?Sub_Order_Object {
		$cache_group = 'ytism_' . $this->order_table;
		$cache_key   = sprintf( 'record_%d_object', $id );

		// Try to get cached data.
		$row = wp_cache_get( $cache_key, $cache_group );
		if ( false !== $row && $row instanceof Sub_Order_Object ) {
			return $row;
		}

		$row = $this->wpdb->get_row(
			$this->wpdb->prepare( 'SELECT * FROM ' . esc_sql( $this->order_table ) . ' WHERE ID = %d', $id ),
			ARRAY_A
		);

		if ( ! $row || empty( $row ) ) {
			return null;
		}

		// Decode JSON fields.
		foreach ( $this->json_fields as $field ) {
			if ( isset( $row[ $field ] ) && is_string( $row[ $field ] ) ) {
				$decoded       = json_decode( $row[ $field ], true );
				$row[ $field ] = $decoded !== null ? $decoded : [];
			}
		}

		// Create object.
		$order_object = new Sub_Order_Object( $row );

		// Cache result for 5 minutes.
		wp_cache_set( $cache_key, $order_object, $cache_group, 5 * MINUTE_IN_SECONDS );

		return $order_object;
	}

	/**
	 * Get subscription order by gateway and sub_id.
	 *
	 * @param string $gateway Gateway name.
	 * @param string $sub_id  Subscription ID.
	 * @return Sub_Order_Object|null
	 */
	public function get_by_gateway_id( string $gateway, string $sub_id ): ?Sub_Order_Object {
		$cache_group = 'ytism_' . $this->order_table;
		$cache_key   = sprintf( 'gateway_%s_%s_object', $gateway, $sub_id );

		// Try to get cached data.
		$cached = wp_cache_get( $cache_key, $cache_group );
		if ( false !== $cached && $cached instanceof Sub_Order_Object ) {
			return $cached;
		}

		$row = $this->wpdb->get_row(
			$this->wpdb->prepare(
				'SELECT * FROM ' . esc_sql( $this->order_table ) . ' WHERE gateway = %s AND sub_id = %s',
				$gateway,
				$sub_id
			),
			ARRAY_A
		);

		if ( ! $row || empty( $row ) ) {
			return null;
		}

		// Decode JSON fields.
		foreach ( $this->json_fields as $field ) {
			if ( isset( $row[ $field ] ) && is_string( $row[ $field ] ) ) {
				$decoded       = json_decode( $row[ $field ], true );
				$row[ $field ] = $decoded !== null ? $decoded : [];
			}
		}

		$order_object = new Sub_Order_Object( $row );

		// Cache result for 5 minutes.
		wp_cache_set( $cache_key, $order_object, $cache_group, 5 * MINUTE_IN_SECONDS );

		return $order_object;
	}

	/**
	 * Get event log by event_uid.
	 *
	 * @param string $event_uid Event UID.
	 * @return object|null Database row or null if not found.
	 */
	public function get_log_by_uid( string $event_uid ): ?object {
		$cache_key   = sprintf( 'ytism_log_uid_%s', $event_uid );
		$cache_group = 'ytism_logs';

		// Try to get from cache first.
		$row = wp_cache_get( $cache_key, $cache_group );
		if ( false !== $row ) {
			return $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );
		}

		$sql = $this->wpdb->prepare(
			'SELECT * FROM ' . esc_sql( $this->log_table ) . ' WHERE event_uid = %s LIMIT 1',
			$event_uid
		);

		$row = $this->wpdb->get_row( $sql, OBJECT );

		if ( ! $row ) {
			return null;
		}

		// Decode JSON fields.
		$row = $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );

		// Cache result for 5 minutes.
		wp_cache_set( $cache_key, $row, $cache_group, 5 * MINUTE_IN_SECONDS );

		return $row;
	}

	/**
	 * Get the last event log by ref_id, ref_type, and ref_status.
	 *
	 * @param int    $ref_id     Reference ID.
	 * @param string $ref_type   Reference type.
	 * @param string $ref_status Reference status.
	 * @return object|null Database row or null if not found.
	 */
	public function get_last_log( int $ref_id, string $ref_type, string $ref_status ): ?object {
		$cache_key   = sprintf( 'ytism_last_log_%d_%s_%s', $ref_id, $ref_type, $ref_status );
		$cache_group = 'ytism_logs';

		// Try to get from cache first.
		$row = wp_cache_get( $cache_key, $cache_group );
		if ( false !== $row ) {
			return $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );
		}

		$sql = $this->wpdb->prepare(
			'SELECT * FROM ' . esc_sql( $this->log_table ) . ' WHERE ref_id = %d AND ref_type = %s AND ref_status = %s ORDER BY created_at DESC LIMIT 1',
			$ref_id,
			$ref_type,
			$ref_status
		);

		$row = $this->wpdb->get_row( $sql, OBJECT );

		if ( ! $row ) {
			return null;
		}

		// Decode JSON fields.
		$row = $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );

		// Cache result for 5 minutes.
		wp_cache_set( $cache_key, $row, $cache_group, 5 * MINUTE_IN_SECONDS );

		return $row;
	}

	/**
	 * Get all event logs by ref_id and ref_type.
	 *
	 * @param int    $ref_id   Reference ID.
	 * @param string $ref_type Reference type.
	 * @param int    $limit    Limit. Default 50.
	 * @param int    $offset   Offset. Default 0.
	 * @return array Array of log objects.
	 */
	public function get_logs( int $ref_id, string $ref_type, int $limit = 50, int $offset = 0 ): array {
		$results = $this->wpdb->get_results(
			$this->wpdb->prepare(
				'SELECT * FROM ' . esc_sql( $this->log_table ) . ' WHERE ref_id = %d AND ref_type = %s ORDER BY created_at DESC LIMIT %d OFFSET %d',
				$ref_id,
				$ref_type,
				$limit,
				$offset
			),
			OBJECT
		);

		if ( empty( $results ) ) {
			return [];
		}

		// Decode JSON fields for each result.
		foreach ( $results as &$row ) {
			$row = $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );
		}

		return $results;
	}

	/**
	 * Get all event logs by ref_id, ref_type, and ref_status.
	 *
	 * @param int    $ref_id     Reference ID.
	 * @param string $ref_type   Reference type.
	 * @param string $ref_status Reference status.
	 * @param int    $limit      Limit. Default 50.
	 * @param int    $offset     Offset. Default 0.
	 * @return array Array of log objects.
	 */
	public function get_logs_by_status( int $ref_id, string $ref_type, string $ref_status, int $limit = 50, int $offset = 0 ): array {
		$results = $this->wpdb->get_results(
			$this->wpdb->prepare(
				'SELECT * FROM ' . esc_sql( $this->log_table ) . ' WHERE ref_id = %d AND ref_type = %s AND ref_status = %s ORDER BY created_at DESC LIMIT %d OFFSET %d',
				$ref_id,
				$ref_type,
				$ref_status,
				$limit,
				$offset
			),
			OBJECT
		);

		if ( empty( $results ) ) {
			return [];
		}

		// Decode JSON fields for each result.
		foreach ( $results as &$row ) {
			$row = $this->maybe_decode_json_fields( $row, 'OBJECT', [ 'data' ] );
		}

		return $results;
	}

	/**
	 * Set transaction data (staged, not saved until save() is called).
	 *
	 * @param int   $id       Order ID.
	 * @param array $txn_data Transaction data.
	 * @return self Returns self for method chaining.
	 */
	public function set_transaction( int $id, array $txn_data ): self {
		$this->current_order_id = $id;
		$this->last_order_id    = $id;

		// Allowed transaction fields.
		$allowed_fields = [ 'last_txn_id', 'last_txn_status', 'last_payment_method' ];

		foreach ( $allowed_fields as $field ) {
			if ( isset( $txn_data[ $field ] ) ) {
				$this->pending_changes[ $field ] = $txn_data[ $field ];
			}
		}

		return $this;
	}

	/**
	 * Update transaction data for a subscription order.
	 *
	 * @param int   $id       Order ID.
	 * @param array $txn_data Transaction data to update.
	 * @return self|WP_Error Returns self for method chaining or WP_Error on failure.
	 */
	public function update_transaction( int $id, array $txn_data ): self|WP_Error {
		// Reset error state.
		$this->last_error    = null;
		$this->last_order_id = $id;

		// Get existing order.
		$existing = $this->get( $id );
		if ( ! $existing ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		// Allowed transaction fields.
		$allowed_fields = [ 'last_txn_id', 'last_txn_status', 'last_payment_method' ];
		$update_data    = [];

		foreach ( $allowed_fields as $field ) {
			if ( isset( $txn_data[ $field ] ) ) {
				$update_data[ $field ] = $txn_data[ $field ];
			}
		}

		if ( empty( $update_data ) ) {
			return new WP_Error( 'no_data', 'No valid transaction fields provided for update.' );
		}

		// Maybe update the order.
		$result = $this->maybe_update( $id, $update_data );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return $this;
	}

	/**
	 * Set subscription data (staged, not saved until save() is called).
	 *
	 * @param int   $id       Order ID.
	 * @param array $sub_data Subscription data.
	 * @return self Returns self for method chaining.
	 */
	public function set_subscription( int $id, array $sub_data ): self {
		$this->current_order_id = $id;
		$this->last_order_id    = $id;

		// Allowed subscription fields.
		$allowed_fields = [
			'sub_status',
			'period_start',
			'period_end',
			'next_billing_at',
			'trial_start_at',
			'trial_end_at',
			'activated_at',
			'canceled_at',
			'billing_cycle',
			'billing_interval',
			'qty',
			'amount',
			'currency',
			'plan_items',
		];

		foreach ( $allowed_fields as $field ) {
			if ( isset( $sub_data[ $field ] ) ) {
				$this->pending_changes[ $field ] = $sub_data[ $field ];
			}
		}

		return $this;
	}

	/**
	 * Update subscription data for a subscription order.
	 *
	 * @param int   $id       Order ID.
	 * @param array $sub_data Subscription data to update.
	 * @return self|WP_Error Returns self for method chaining or WP_Error on failure.
	 */
	public function update_subscription( int $id, array $sub_data ): self|WP_Error {
		// Reset error state.
		$this->last_error    = null;
		$this->last_order_id = $id;

		// Get existing order.
		$existing = $this->get( $id );
		if ( ! $existing ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		// Allowed subscription fields.
		$allowed_fields = [
			'sub_status',
			'period_start',
			'period_end',
			'next_billing_at',
			'trial_start_at',
			'trial_end_at',
			'activated_at',
			'canceled_at',
			'billing_cycle',
			'billing_interval',
			'qty',
			'amount',
			'currency',
			'plan_items',
		];

		$update_data = [];
		foreach ( $allowed_fields as $field ) {
			if ( isset( $sub_data[ $field ] ) ) {
				$update_data[ $field ] = $sub_data[ $field ];
			}
		}

		if ( empty( $update_data ) ) {
			return new WP_Error( 'no_data', 'No valid subscription fields provided for update.' );
		}

		// Update the order.
		$result = $this->maybe_update( $id, $update_data );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return $this;
	}

	/**
	 * Add or update a metadata value.
	 *
	 * @param int    $id    Order ID.
	 * @param string $key   Metadata key.
	 * @param mixed  $value Metadata value.
	 * @return bool|WP_Error True on success, WP_Error on failure.
	 */
	public function add_meta( int $id, string $key, $value ): bool|WP_Error {
		$order = $this->get( $id );
		if ( ! $order ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		$metadata         = $order->metadata ?? [];
		$metadata[ $key ] = $value;

		$result = $this->update( $id, [ 'metadata' => $metadata ] );
		return ! is_wp_error( $result );
	}

	/**
	 * Update a metadata value (alias for add_meta).
	 *
	 * @param int    $id    Order ID.
	 * @param string $key   Metadata key.
	 * @param mixed  $value Metadata value.
	 * @return bool|WP_Error True on success, WP_Error on failure.
	 */
	public function update_meta( int $id, string $key, $value ): bool|WP_Error {
		return $this->add_meta( $id, $key, $value );
	}

	/**
	 * Set metadata (staged, not saved until save() is called).
	 *
	 * @param int    $id    Order ID (optional if already set via set_transaction/set_subscription).
	 * @param string $key   Metadata key.
	 * @param mixed  $value Metadata value.
	 * @return self Returns self for method chaining.
	 */
	public function set_meta( int $id = null, string $key = null, $value = null ): self {
		// Allow multiple call patterns:
		// 1. set_meta(id, key, value)
		// 2. set_meta(key, value) - uses current_order_id
		// 3. set_meta([key => value, ...]) - batch set.

		if ( is_array( $id ) && null === $key ) {
			// Pattern 3: Batch set metadata.
			$metadata = $id;
			$id       = $this->current_order_id;

			if ( null === $id ) {
				$this->last_error = new WP_Error( 'no_order_id', 'No order ID set. Call set_transaction() or set_subscription() first.' );
				return $this;
			}

			if ( ! isset( $this->pending_changes['metadata'] ) ) {
				$order                             = $this->get( $id );
				$this->pending_changes['metadata'] = $order ? ( $order->metadata ?? [] ) : [];
			}

			foreach ( $metadata as $k => $v ) {
				$this->pending_changes['metadata'][ $k ] = $v;
			}
		} elseif ( is_string( $id ) && null !== $key && null === $value ) {
			// Pattern 2: set_meta(key, value).
			$value = $key;
			$key   = $id;
			$id    = $this->current_order_id;

			if ( null === $id ) {
				$this->last_error = new WP_Error( 'no_order_id', 'No order ID set. Call set_transaction() or set_subscription() first.' );
				return $this;
			}

			if ( ! isset( $this->pending_changes['metadata'] ) ) {
				$order                             = $this->get( $id );
				$this->pending_changes['metadata'] = $order ? ( $order->metadata ?? [] ) : [];
			}

			$this->pending_changes['metadata'][ $key ] = $value;
		} else {
			// Pattern 1: set_meta(id, key, value).
			if ( null !== $id ) {
				$this->current_order_id = $id;
				$this->last_order_id    = $id;
			}

			if ( null === $this->current_order_id ) {
				$this->last_error = new WP_Error( 'no_order_id', 'No order ID provided.' );
				return $this;
			}

			if ( ! isset( $this->pending_changes['metadata'] ) ) {
				$order                             = $this->get( $this->current_order_id );
				$this->pending_changes['metadata'] = $order ? ( $order->metadata ?? [] ) : [];
			}

			if ( null !== $key ) {
				$this->pending_changes['metadata'][ $key ] = $value;
			}
		}

		return $this;
	}

	/**
	 * Get a metadata value.
	 *
	 * @param int    $id      Order ID.
	 * @param string $key     Metadata key.
	 * @param mixed  $default Default value if key doesn't exist.
	 * @return mixed Metadata value or default.
	 */
	public function get_meta( int $id, string $key, $default = null ) {
		$order = $this->get( $id );
		if ( ! $order ) {
			return $default;
		}

		$metadata = $order->metadata ?? [];
		return $metadata[ $key ] ?? $default;
	}

	/**
	 * Delete a metadata value.
	 *
	 * @param int    $id  Order ID.
	 * @param string $key Metadata key.
	 * @return bool|WP_Error True on success, WP_Error on failure.
	 */
	public function delete_meta( int $id, string $key ): bool|WP_Error {
		$order = $this->get( $id );
		if ( ! $order ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		$metadata = $order->metadata ?? [];
		if ( ! isset( $metadata[ $key ] ) ) {
			return true; // Already doesn't exist.
		}

		unset( $metadata[ $key ] );

		$result = $this->update( $id, [ 'metadata' => $metadata ] );
		return ! is_wp_error( $result );
	}

	/**
	 * Delete a record by ID.
	 *
	 * @param int $id Record ID.
	 * @return int|false Number of rows deleted or false on failure.
	 */
	public function delete( int $id ): int|false {
		return $this->wpdb->delete(
			$this->order_table,
			[ 'ID' => $id ],
			[ '%d' ]
		);
	}

	/**
	 * Clear all metadata.
	 *
	 * @param int $id Order ID.
	 * @return bool|WP_Error True on success, WP_Error on failure.
	 */
	public function clear_meta( int $id ): bool|WP_Error {
		$result = $this->update( $id, [ 'metadata' => [] ] );
		return ! is_wp_error( $result );
	}

	/**
	 * Check if a metadata key exists.
	 *
	 * @param int    $id  Order ID.
	 * @param string $key Metadata key.
	 * @return bool True if key exists, false otherwise.
	 */
	public function has_meta( int $id, string $key ): bool {
		$order = $this->get( $id );
		if ( ! $order ) {
			return false;
		}

		$metadata = $order->metadata ?? [];
		return isset( $metadata[ $key ] );
	}

	/**
	 * Get all metadata.
	 *
	 * @param int $id Order ID.
	 * @return array|null Metadata array or null if order not found.
	 */
	public function get_all_meta( int $id ): ?array {
		$order = $this->get( $id );
		if ( ! $order ) {
			return null;
		}

		return $order->metadata ?? [];
	}

	/**
	 * Update an existing subscription order by ID.
	 *
	 * @param int   $id   Subscription order ID.
	 * @param array $data Subscription order data to update.
	 * @return int|WP_Error Updated subscription order ID on success, WP_Error on failure.
	 */
	public function update( int $id, array $data ): int|WP_Error {
		// Fields not allowed to be updated.
		$restricted_fields = [ 'gateway', 'sub_id' ];
		foreach ( $restricted_fields as $field ) {
			if ( array_key_exists( $field, $data ) ) {
				unset( $data[ $field ] );
			}
		}

		if ( empty( $data ) ) {
			return new WP_Error( 'no_data', 'No updatable fields provided for update.' );
		}

		// Validate and encode JSON fields.
		foreach ( $this->json_fields as $field ) {
			if ( isset( $data[ $field ] ) ) {
				if ( ! is_array( $data[ $field ] ) && ! empty( $data[ $field ] ) ) {
					return new WP_Error( "invalid_{$field}", ucfirst( $field ) . ' must be an array.' );
				}
				$data[ $field ] = wp_json_encode( ! empty( $data[ $field ] ) ? $data[ $field ] : [] );
			}
		}

		// First get and verify if record exists.
		$existing = $this->get( $id );
		if ( ! $existing ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		// Update timestamp.
		$data['updated_at'] = current_time( 'mysql' );

		// Build format array dynamically for proper query binding.
		$format = [];
		foreach ( $data as $key => $value ) {
			if ( is_int( $value ) ) {
				$format[] = '%d';
			} elseif ( is_float( $value ) ) {
				$format[] = '%f';
			} elseif ( is_null( $value ) ) {
				$format[]     = '%s';
				$data[ $key ] = null;
			} else {
				$format[] = '%s';
			}
		}

		$updated = $this->wpdb->update(
			$this->order_table,
			$data,
			[ 'ID' => $id ],
			$format,
			[ '%d' ]
		);

		if ( false === $updated ) {
			return new WP_Error( 'db_update_error', $this->wpdb->last_error );
		}

		// Clear cache.
		$cache_group = 'ytism_' . $this->order_table;
		$cache_key   = sprintf( 'record_%d_object', $id );
		wp_cache_delete( $cache_key, $cache_group );

		$this->last_order_id = $id;

		return $id;
	}

	/**
	 * Save all pending changes to the database.
	 *
	 * @return self|WP_Error Returns self for method chaining or WP_Error on failure.
	 */
	public function save(): self|WP_Error {
		if ( null === $this->current_order_id ) {
			return new WP_Error( 'no_order_id', 'No order ID set. Nothing to save.' );
		}

		if ( empty( $this->pending_changes ) ) {
			return $this; // Nothing to save.
		}

		// Save all pending changes at once.
		$result = $this->maybe_update( $this->current_order_id, $this->pending_changes );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Clear pending changes after successful save.
		$this->pending_changes = [];

		return $this;
	}

	/**
	 * Create event log
	 *
	 * @param array $data Event log data.
	 * @return int|WP_Error|false Event log ID on success, WP_Error on failure.
	 */
	public function create_log( array $data ): int|WP_Error|false {
		$defaults = [
			'ref_type'    => '',
			'ref_id'      => 0,
			'ref_status'  => '',
			'event_uid'   => (string) time(),
			'severity'    => 'info',
			'message'     => '',
			'data'        => [],
			'retry_count' => 0,
			'user_id'     => get_current_user_id(),
			'ip'          => Functions::get_user_ip(),
			'user_agent'  => Functions::get_user_agent(),
			'created_at'  => current_time( 'mysql' ),
			'updated_at'  => current_time( 'mysql' ),
		];

		$data = wp_parse_args( $data, $defaults );

		if ( ! is_int( $data['ref_id'] ) || $data['ref_id'] <= 0 ) {
			return new WP_Error( 'invalid_ref_id', 'ref_id must be a positive integer.' );
		}

		// Validate ref_type: start with letter or underscore, then letters, numbers, underscores only.
		$ref_type = trim( (string) $data['ref_type'] );
		if ( empty( $ref_type ) || preg_match( '/\s/', $ref_type ) || ! preg_match( '/^[a-zA-Z_][a-zA-Z0-9_]*$/', $ref_type ) ) {
			return new WP_Error( 'invalid_ref_type', 'ref_type must be a non-empty string without spaces, starting with a letter or underscore, and containing only letters, numbers, and underscores.' );
		}
		$data['ref_type'] = $ref_type;

		// Validate ref_status.
		$ref_status = trim( (string) $data['ref_status'] );
		if ( empty( $ref_status ) || preg_match( '/\s/', $ref_status ) ) {
			return new WP_Error( 'invalid_ref_status', 'ref_status must be a non-empty string without spaces.' );
		}

		if ( ! preg_match( '/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/', $ref_status ) ) {
			return new WP_Error( 'invalid_ref_status', 'ref_status must start with a letter or underscore and contain only letters, numbers, underscores, and dots (dots not at start or end).' );
		}

		// Check if ref_status already starts with ref_type + '.'.
		if ( strpos( $ref_status, $ref_type . '.' ) !== 0 ) {
			$ref_status = $ref_type . '.' . $ref_status;
		}
		$data['ref_status'] = $ref_status;

		// Ensure event_uid is a non-empty string.
		$event_uid = trim( (string) $data['event_uid'] );
		if ( empty( $event_uid ) ) {
			return new WP_Error( 'invalid_event_uid', 'event_uid must be a non-empty string.' );
		}
		$data['event_uid'] = $event_uid;

		// JSON encode specified fields.
		if ( ! is_array( $data['data'] ) ) {
			return new WP_Error( 'invalid_data', ucfirst( 'data' ) . ' must be an array' );
		}
		$data['data'] = wp_json_encode( $data['data'] );

		// Check if log exists.
		$existing_log = $this->get_log_by_ref( (int) $data['ref_id'], $data['ref_type'], $data['ref_status'], $data['event_uid'], 'OBJECT' );
		if ( $existing_log ) {
			return $existing_log->ID;
		}

		$inserted = $this->wpdb->insert(
			$this->log_table,
			$data,
			[
				'%s',
				'%d',
				'%s',
				'%s',
				'%s',
				'%s',
				'%s',
				'%d',
				'%d',
				'%s',
				'%s',
				'%s',
				'%s',
			]
		);

		if ( false === $inserted ) {
			return new WP_Error( 'db_insert_error', $this->wpdb->last_error );
		}

		return $this->wpdb->insert_id;
	}

	/**
	 * Get log by event ref_id, ref_type, ref_status, event_uid.
	 *
	 * @param int    $ref_id      Reference ID.
	 * @param string $ref_type    Reference type.
	 * @param string $ref_status    Reference code.
	 * @param string $event_uid   Event UID.
	 * @param string $return_type Return type. Default 'OBJECT'.
	 *
	 * @return array|object|null Database row.
	 */
	public function get_log_by_ref( int $ref_id, string $ref_type, string $ref_status, string $event_uid, string $return_type = 'OBJECT' ): array|object|null {
		$allowed_return_types = [ 'OBJECT', 'ARRAY_A', 'ARRAY_N' ];
		if ( ! in_array( $return_type, $allowed_return_types, true ) ) {
			return null;
		}

		$cache_key   = sprintf( 'ytism_log_%d_%s_%s_%s_%s', $ref_id, $ref_type, $ref_status, $event_uid, $return_type );
		$cache_group = 'ytism_logs';

		// Try to get from cache first.
		$row = wp_cache_get( $cache_key, $cache_group );
		if ( false !== $row ) {
			return $this->maybe_decode_json_fields( $row, $return_type, [ 'data' ] );
		}

		$sql = $this->wpdb->prepare(
			'SELECT * FROM ' . esc_sql( $this->log_table ) . ' WHERE ref_id = %d AND ref_type = %s AND ref_status = %s AND event_uid = %s',
			$ref_id,
			$ref_type,
			$ref_status,
			$event_uid
		);

		$row = $this->wpdb->get_row( $sql, ( 'ARRAY_A' === $return_type ? ARRAY_A : OBJECT ) );

		if ( $row ) {
			wp_cache_set( $cache_key, $row, $cache_group, 5 * MINUTE_IN_SECONDS );
		}

		return $this->maybe_decode_json_fields( $row, $return_type, [ 'data' ] );
	}

	/**
	 * Maybe update a subscription order
	 *
	 * @param int   $id   Order ID.
	 * @param array $data Data to update.
	 * @return int|WP_Error Order ID on success, WP_Error on failure.
	 */
	public function maybe_update( int $id, array $data ): int|WP_Error {
		$existing = $this->get( $id );
		if ( ! $existing ) {
			return new WP_Error( 'not_found', 'Subscription order not found.' );
		}

		// Validate JSON fields.
		foreach ( $this->json_fields as $field ) {
			if ( isset( $data[ $field ] ) ) {
				if ( ! is_array( $data[ $field ] ) && ! empty( $data[ $field ] ) ) {
					return new WP_Error( "invalid_{$field}", ucfirst( $field ) . ' must be an array.' );
				}
			}
		}

		// Determine what needs to be updated.
		$needs_update = Functions::array_changes_only_recursive(
			[
				'user_id'             => $existing->user_id,
				'plan_items'          => $existing->plan_items,
				'customer_id'         => $existing->customer_id,
				'sub_status'          => $existing->sub_status,
				'last_txn_id'         => $existing->last_txn_id,
				'last_txn_status'     => $existing->last_txn_status,
				'last_payment_method' => $existing->last_payment_method,
				'qty'                 => $existing->qty,
				'amount'              => $existing->amount,
				'currency'            => $existing->currency,
				'period_start'        => $existing->period_start,
				'period_end'          => $existing->period_end,
				'next_billing_at'     => $existing->next_billing_at,
				'trial_start_at'      => $existing->trial_start_at,
				'trial_end_at'        => $existing->trial_end_at,
				'activated_at'        => $existing->activated_at,
				'canceled_at'         => $existing->canceled_at,
				'billing_cycle'       => $existing->billing_cycle,
				'billing_interval'    => $existing->billing_interval,
				'metadata'            => $existing->metadata,
			],
			$data
		);

		if ( empty( $needs_update ) ) {
			return $id;
		}

		$update_result = $this->update( $id, $needs_update );
		if ( is_wp_error( $update_result ) ) {
			return $update_result;
		}

		return $id;
	}

	/**
	 * Discard all pending changes without saving.
	 *
	 * @return self
	 */
	public function discard(): self {
		$this->pending_changes  = [];
		$this->current_order_id = null;
		return $this;
	}

	/**
	 * Get pending changes (for debugging or preview).
	 *
	 * @return array
	 */
	public function get_pending_changes(): array {
		return $this->pending_changes;
	}

	/**
	 * Check if there are pending changes.
	 *
	 * @return bool
	 */
	public function has_pending_changes(): bool {
		return ! empty( $this->pending_changes );
	}
	
	/**
	 * Get subscriptions by user ID with limit and offset.
	 *
	 * @param int $user_id User ID.
	 * @param int $limit   Limit.
	 * @param int $offset  Offset.
	 * @return Sub_Order_Object[]
	 */
	public function get_by_user( int $user_id, int $limit = 50, int $offset = 0 ): array {
		$results = $this->wpdb->get_results(
			$this->wpdb->prepare(
				"SELECT * FROM {$this->order_table} WHERE user_id = %d ORDER BY created_at DESC LIMIT %d OFFSET %d",
				$user_id,
				$limit,
				$offset
			),
			ARRAY_A
		);

		$orders = [];
		foreach ( $results as $row ) {
			// Decode JSON fields.
			foreach ( $this->json_fields as $field ) {
				if ( isset( $row[ $field ] ) && is_string( $row[ $field ] ) ) {
					$row[ $field ] = json_decode( $row[ $field ], true ) ?? [];
				}
			}
			$orders[] = new Sub_Order_Object( $row );
		}

		return $orders;
	}

	/**
	 * Get subscriptions by status with limit and offset.
	 *
	 * @param string $status Status.
	 * @param int    $limit  Limit.
	 * @param int    $offset Offset.
	 * @return Sub_Order_Object[]
	 */
	public function get_by_status( string $status, int $limit = 50, int $offset = 0 ): array {
		$results = $this->wpdb->get_results(
			$this->wpdb->prepare(
				"SELECT * FROM {$this->order_table} WHERE sub_status = %s ORDER BY created_at DESC LIMIT %d OFFSET %d",
				$status,
				$limit,
				$offset
			),
			ARRAY_A
		);

		$orders = [];
		foreach ( $results as $row ) {
			// Decode JSON fields.
			foreach ( $this->json_fields as $field ) {
				if ( isset( $row[ $field ] ) && is_string( $row[ $field ] ) ) {
					$row[ $field ] = json_decode( $row[ $field ], true ) ?? [];
				}
			}
			$orders[] = new Sub_Order_Object( $row );
		}

		return $orders;
	}


	/**
	 * Decode JSON fields on given row or object.
	 * Only specified fields are decoded.
	 *
	 * @param object|array|null $row
	 * @param string            $return_type One of 'OBJECT', 'ARRAY_A'
	 * @param array             $json_fields List of fields to decode JSON
	 * @return object|array|null
	 */
	protected function maybe_decode_json_fields( $row, string $return_type = 'OBJECT', array $json_fields = [] ) {
		if ( ! $row || empty( $json_fields ) ) {
			return $row;
		}

		foreach ( $json_fields as $field ) {
			if ( $return_type === 'ARRAY_A' ) {
				if ( isset( $row[ $field ] ) ) {
					$decoded       = json_decode( $row[ $field ], true );
					$row[ $field ] = is_array( $decoded ) ? $decoded : [];
				} else {
					$row[ $field ] = [];
				}
			} elseif ( $return_type === 'OBJECT' ) {
				if ( isset( $row->$field ) ) {
					$decoded     = json_decode( $row->$field, true );
					$row->$field = is_array( $decoded ) ? $decoded : [];
				} else {
					$row->$field = [];
				}
			}
		}

		return $row;
	}
}
