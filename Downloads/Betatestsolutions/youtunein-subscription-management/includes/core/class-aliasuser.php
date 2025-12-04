<?php
namespace YTISM\Core;

use YTISM\Database\Factory;
use YTISM\Helpers\Functions;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class AliasUser {
	private $ID;
	private $wp_user_id;
	private $alias_user_id;
	private $userdata;
	private $last_sync;
	private $login_token;

	private static $table;
	private static $cache = [];

	/**
	 * Construct using WP user ID
	 */
	public function __construct( $wp_user_id = null ) {
		$wp_user_id = (int) $wp_user_id;

		// If no valid wp_user_id supplied, do not query the DB here.
		if ( $wp_user_id <= 0 ) {
			return;
		}

		// Cached version.
		if ( isset( self::$cache['wp'][ $wp_user_id ] ) ) {
			$this->copy_from( self::$cache['wp'][ $wp_user_id ] );
			return;
		}

		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM ' . self::table() . ' WHERE wp_user_id = %d LIMIT 1',
				$wp_user_id
			)
		);

		if ( ! $row ) {
			return;
		}

		$decoded = json_decode( $row->userdata, true );
		$valid   = self::validate_userdata( $decoded );
		if ( is_wp_error( $valid ) ) {
			return;
		}

		$this->populate_from_row( $row, $decoded );
	}

	/**
	 * Load alias user directly by alias_user_id
	 */
	public static function load_by_alias_id( $alias_user_id ) {
		$alias_user_id = (int) $alias_user_id;

		if ( empty( $alias_user_id ) ) {
			return null;
		}

		if ( isset( self::$cache['alias'][ $alias_user_id ] ) ) {
			return self::$cache['alias'][ $alias_user_id ];
		}

		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM ' . self::table() . ' WHERE alias_user_id = %d LIMIT 1',
				$alias_user_id
			)
		);

		if ( ! $row ) {
			return null;
		}

		$decoded = json_decode( $row->userdata, true );
		$valid   = self::validate_userdata( $decoded );
		if ( is_wp_error( $valid ) ) {
			return null;
		}

		$obj = new self();
		$obj->populate_from_row( $row, $decoded );

		return $obj;
	}

	/**
	 * Load alias user by email
	 */
	public static function load_by_alias_email( string $email ) {
		global $wpdb;
		$email = sanitize_email( $email );
		if ( empty( $email ) || ! is_email( $email ) ) {
			return null;
		}

		// JSON_EXTRACT reads JSON key without full table scan.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM ' . self::table() . " 
            WHERE JSON_UNQUOTE(JSON_EXTRACT(userdata, '$.email')) = %s 
            LIMIT 1",
				$email
			)
		);

		if ( ! $row || empty( $row ) ) {
			return null;
		}

		$decoded = json_decode( $row->userdata, true );
		if ( ! is_array( $decoded ) ) {
			return null;
		}

		$obj = new self();
		$obj->populate_from_row( $row, $decoded );

		return $obj;
	}

	/**
	 * Load alias user by organization name
	 */
	public static function load_by_organization_name( $org_name ) {
		global $wpdb;

		$org_name = sanitize_text_field( $org_name );
		if ( empty( $org_name ) ) {
			return null;
		}

		// Query JSON nested key: $.user.organization.name.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM ' . self::table() . " 
            WHERE JSON_UNQUOTE(JSON_EXTRACT(userdata, '$.organization.name')) = %s 
            LIMIT 1",
				$org_name
			)
		);

		if ( ! $row ) {
			return null;
		}

		$decoded = json_decode( $row->userdata, true );
		if ( ! is_array( $decoded ) ) {
			return null;
		}

		$obj = new self();
		$obj->populate_from_row( $row, $decoded );

		return $obj;
	}


	/**
	 * Internal population method
	 */
	private function populate_from_row( $row, $decoded ) {
		$this->ID            = (int) $row->ID;
		$this->wp_user_id    = (int) $row->wp_user_id;
		$this->alias_user_id = isset( $row->alias_user_id ) && ! empty( $row->alias_user_id ) ? (int) $row->alias_user_id : null;
		$this->userdata      = is_array( $decoded ) ? $decoded : [];
		$this->last_sync     = $row->last_sync;
		$this->login_token   = $row->login_token;

		self::$cache['wp'][ $this->wp_user_id ] = $this;
		if ( $this->alias_user_id ) {
			self::$cache['alias'][ $this->alias_user_id ] = $this;
		}
	}

	private function copy_from( $obj ) {
		$this->ID            = $obj->ID;
		$this->wp_user_id    = $obj->wp_user_id;
		$this->alias_user_id = $obj->alias_user_id;
		$this->userdata      = $obj->userdata;
		$this->last_sync     = $obj->last_sync;
		$this->login_token   = $obj->login_token;
	}

	private static function table() {
		global $wpdb;
		if ( ! self::$table ) {
			self::$table = $wpdb->prefix . 'ytism_alias_users';
		}
		return self::$table;
	}

	private static function validate_userdata( $data ) {
		if ( ! is_array( $data ) ) {
			return new WP_Error( 'invalid_data', __( 'Alias data must be an array.', 'ytism' ) );
		}
		if ( empty( $data['email'] ) ) {
			return new WP_Error( 'missing_fields', __( 'Alias data must include email.', 'ytism' ) );
		}
		return true;
	}

	public function update_organization_data( array $org_data ) {
		if ( ! is_array( $org_data ) ) {
			return new WP_Error( 'invalid_data', __( 'Organization data must be an array.', 'ytism' ) );
		}
		if ( ! $this->exists() ) {
			return new WP_Error( 'not_found', __( 'Alias user does not exist.', 'ytism' ) );
		}

		$current_data = $this->userdata ?? [];
		$current_org  = isset( $current_data['organization'] ) && is_array( $current_data['organization'] ) ? $current_data['organization'] : [];
		$updated_org  = array_merge( $current_org, $org_data );
		$updated_data = array_merge( $current_data, [ 'organization' => $updated_org ] );

		return $this->update_user( $updated_data );
	}

	public function update_token( string $token ) {
		if ( ! $this->exists() ) {
			return new WP_Error( 'not_found', __( 'Alias user does not exist.', 'ytism' ) );
		}
		global $wpdb;

		$this->login_token = $token;
		$this->last_sync   = current_time( 'mysql' );

		$wpdb->update(
			self::table(),
			[
				'login_token' => $token,
				'last_sync'   => $this->last_sync,
			],
			[ 'ID' => $this->ID ],
			[ '%s', '%s' ],
			[ '%d' ]
		);

		self::$cache['wp'][ $this->wp_user_id ]       = $this;
		self::$cache['alias'][ $this->alias_user_id ] = $this;

		return true;
	}

	// Update alias userdata.
	public function update_user( array $new_data, $login_token = null ) {
		$valid = self::validate_userdata( $new_data );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		if ( ! $this->exists() ) {
			return new WP_Error( 'not_found', __( 'Alias user does not exist.', 'ytism' ) );
		}

		global $wpdb;

		$current_data    = $this->userdata ?? [];
		$updated_data    = Functions::array_merge_recursive_distinct( $current_data, $new_data );
		$this->userdata  = $updated_data;
		$this->last_sync = current_time( 'mysql' );

		// Prepare data to update in DB.
		$db_update = [
			'userdata'  => wp_json_encode( $updated_data ),
			'last_sync' => $this->last_sync,
		];

		if ( $login_token !== null ) {
			$db_update['login_token'] = $login_token;
		}

		if ( isset( $new_data['userId'] ) && ! empty( $new_data['userId'] ) ) {
			$db_update['alias_user_id'] = intval( $new_data['userId'] );
			$this->alias_user_id        = $db_update['alias_user_id'];
		}

		$wpdb->update(
			self::table(),
			$db_update,
			[ 'ID' => $this->ID ],
			array_map(
				function ( $v ) {
					return is_int( $v ) ? '%d' : '%s'; },
				$db_update
			),
			[ '%d' ]
		);

		$wpUserData = [];
		if ( isset( $new_data['name'] ) ) {
			$wpUserData['first_name'] = sanitize_text_field( $new_data['name'] );
		}
		if ( isset( $new_data['last_name'] ) ) {
			$wpUserData['last_name'] = sanitize_text_field( $new_data['lastName'] );
		}

		if ( ! empty( $wpUserData ) ) {
			$wpUserData['ID'] = $this->wp_user_id;
			wp_update_user( $wpUserData );
		}

		self::$cache['wp'][ $this->wp_user_id ]       = $this;
		self::$cache['alias'][ $this->alias_user_id ] = $this;

		return true;
	}

	// Check if valid.
	public function exists() {
		if ( empty( $this->ID ) || empty( $this->wp_user_id ) ) {
			return false;
		}
		if ( ! is_array( $this->userdata ) ) {
			return false;
		}
		if ( empty( $this->userdata['email'] ) || ! is_email( $this->userdata['email'] ) ) {
			return false;
		}
		return true;
	}


	// Static checker by alias ID.
	public static function exists_by_alias_id( $alias_user_id ) {
		$user = self::load_by_alias_id( $alias_user_id );
		if ( ! $user || ! $user instanceof self || ! $user->exists() ) {
			return false;
		}
		return (bool) self::validate_wp_user_or_restore( $user );
	}

	// Static checker by email.
	public static function exists_by_email( $email ) {
		$user = self::load_by_alias_email( $email );
		if ( ! $user || ! $user instanceof self || ! $user->exists() ) {
			return false;
		}
		return (bool) self::validate_wp_user_or_restore( $user );
	}

	// Static checker by organization name.
	public static function exists_by_organization( $org_name ) {
		$user = self::load_by_organization_name( $org_name );
		if ( ! $user || ! $user instanceof self || ! $user->exists() ) {
			return false;
		}
		return (bool) self::validate_wp_user_or_restore( $user );
	}

	// Public getters.
	public function get_id() {
		return $this->ID; }
	public function get_wp_user_id() {
		return $this->wp_user_id; }
	public function get_alias_user_id() {
		return $this->alias_user_id; }
	public function get_userdata() {
		return $this->userdata; }
	public function get_last_sync() {
		return $this->last_sync; }
	public function get_login_token() {
		return $this->login_token; }
	public function get_email() {
		if ( ! $this->exists() ) {
			return null;
		}
		return isset( $this->userdata['email'] ) ? sanitize_email( $this->userdata['email'] ) : null;
	}

	public function get_user_type() {
		if ( ! $this->exists() ) {
			return null;
		}

		$orgName  = $this->userdata['organization']['name'] ?? ( $this->userdata['organizationName'] ?? '' );
		$familyId = isset( $this->userdata['familyPrimaryUserId'] ) ? (int) $this->userdata['familyPrimaryUserId'] : null;
		$userId   = isset( $this->userdata['userId'] ) ? (int) $this->userdata['userId'] : null;
		if ( empty( $userId ) ) {
			$aliasId = $this->get_alias_user_id();
			$userId  = ! empty( $aliasId ) ? (int) $aliasId : null;
		}

		// Enterprise user.
		if ( ! empty( $orgName ) ) {
			return 'enterprise';
		}

		// Individual user: No family or self as family head.
		if ( empty( $familyId ) || $familyId === 0 || $familyId === $userId ) {
			return 'individual';
		}

		// Family member: Belongs to family but not head.
		if ( $familyId > 0 && $familyId !== $userId ) {
			return 'family';
		}

		return null;
	}

	public function is_enterprise_user() {
		return $this->get_user_type() === 'enterprise';
	}

	public function is_individual_user() {
		return $this->get_user_type() === 'individual';
	}

	public function is_family_user() {
		return $this->get_user_type() === 'family';
	}

	/**
	 * Get login token expiration timestamp
	 *
	 * @return int Unix timestamp of expiration
	 */
	public function get_token_expiration() {
		if ( empty( $this->login_token ) ) {
			return strtotime( '+2 days' );
		}

		$parts = explode( '.', $this->login_token );
		if ( count( $parts ) !== 3 ) {
			return strtotime( '+2 days' );
		}

		$payload = json_decode( base64_decode( strtr( $parts[1], '-_', '+/' ) ), true );
		if ( ! is_array( $payload ) || empty( $payload['exp'] ) ) {
			return strtotime( '+2 days' );
		}

		return (int) $payload['exp'];
	}

	/**
	 * Check if token is expired
	 *
	 * @return bool
	 */
	public function is_token_expired() {
		$exp = $this->get_token_expiration();
		return ( $exp < time() );
	}

	/**
	 * Generate a unique alias email
	 *
	 * @param string $prefix
	 * @param string $domain
	 * @return string
	 */
	public static function generate_unique_alias_email( $prefix = 'alias_', $domain = 'alias.local' ) {
		do {
			$alias_email = $prefix . uniqid() . '@' . $domain;
			$exists_wp   = email_exists( $alias_email );
		} while ( $exists_wp );

		return $alias_email;
	}

	/**
	 * Generate a unique alias username
	 */
	public static function generate_unique_alias_username( $email, $prefix = 'alias_' ) {
		$parts = explode( '@', $email );
		$base  = sanitize_user( $parts[0], true );

		if ( empty( $base ) ) {
			$base = $prefix . uniqid();
		}

		$username = $base;
		$suffix   = 1;

		while ( username_exists( $username ) ) {
			$username = $base . '_' . $suffix;
			++$suffix;
		}

		return $username;
	}

	/**
	 * Restore a missing WP user from alias userdata
	 *
	 * @param array $userdata
	 * @return int|false New WP user ID or false on failure
	 */
	private static function validate_wp_user_or_restore( AliasUser $aliasUserObj ) {
		$wp_user_id = (int) $aliasUserObj->get_wp_user_id();

		if ( $wp_user_id > 0 && get_user_by( 'id', $wp_user_id ) ) {
			return $wp_user_id;
		}

		$userdata    = $aliasUserObj->get_userdata();
		$alias_email = sanitize_email( $userdata['email'] );
		$first_name  = sanitize_text_field( $userdata['name'] ?? '' );
		$last_name   = sanitize_text_field( $userdata['lastName'] ?? '' );
		$display     = trim( $first_name . ' ' . $last_name );

		$email      = self::generate_unique_alias_email();
		$user_login = self::generate_unique_alias_username( $email );
		$password   = wp_generate_password( 12, false );

		$wp_user_id = wp_insert_user(
			[
				'user_login'   => $user_login,
				'user_email'   => $email,
				'first_name'   => $first_name,
				'last_name'    => $last_name,
				'display_name' => $display,
				'user_pass'    => $password,
				'role'         => 'subscriber',
			]
		);

		if ( is_wp_error( $wp_user_id ) ) {
			return false;
		}

		if ( $wp_user_id ) {
			global $wpdb;
			$wpdb->update(
				self::table(),
				[ 'wp_user_id' => $wp_user_id ],
				[ 'ID' => $aliasUserObj->get_id() ],
				[ '%d' ],
				[ '%d' ]
			);
			return $wp_user_id;
		}

		return false;
	}

	/**
	 * Add new alias user and corresponding WP user
	 *
	 * @param array $userdata
	 * @param bool  $alias_verified
	 * @return int|WP_Error WP user ID on success, WP_Error on failure
	 */
	public static function add_user( array $userdata, bool $alias_verified = false, bool $check_org = true ) {
		global $wpdb;

		$alias_email = self::generate_unique_alias_email();
		$user_login  = self::generate_unique_alias_username( $alias_email );

		$aliasUserData = is_array( $userdata ) ? $userdata : [];
		$aliasUserData = array_merge(
			[
				'email'    => sanitize_email( $aliasUserData['email'] ?? '' ),
				'name'     => sanitize_text_field( $aliasUserData['name'] ?? $aliasUserData['firstName'] ?? '' ),
				'lastName' => sanitize_text_field( $aliasUserData['lastName'] ?? '' ),
			],
			$aliasUserData
		);

		if ( empty( $aliasUserData['email'] ) || ! is_email( $aliasUserData['email'] ) ) {
			return new WP_Error( 'invalid_email', __( 'Provided email is not valid.', 'ytism' ) );
		}

		$emailUser = self::load_by_alias_email( $aliasUserData['email'] );
		if ( $emailUser && $emailUser instanceof self && $emailUser->exists() ) {
			$get_alias_id = $emailUser->get_alias_user_id();
			if ( ! empty( $get_alias_id ) && $get_alias_id > 0 ) {
				return new WP_Error( 'email_exists', __( 'User with this email already exists.', 'ytism' ) );
			} else {
				// Update existing record with new alias_user_id.
				if ( isset( $aliasUserData['userId'] ) && ! empty( $aliasUserData['userId'] ) && intval( $aliasUserData['userId'] ) > 0 ) {
					$emailUser->update_user( $aliasUserData );
					return $emailUser->get_wp_user_id();
				}
			}
		}

		if ( ( ! empty( $aliasUserData['organization']['name'] ) || ! empty( $aliasUserData['organizationName'] ) ) && $check_org === true ) {
			$org_name = ! empty( $aliasUserData['organization']['name'] ) ? $aliasUserData['organization']['name'] : $aliasUserData['organizationName'];
			$org_name = sanitize_text_field( $org_name );
			$orgUser  = self::load_by_organization_name( $org_name );

			if ( $orgUser && $orgUser instanceof self && $orgUser->exists() ) {
				$get_alias_id = $orgUser->get_alias_user_id();
				if ( ! empty( $get_alias_id ) && $get_alias_id > 0 ) {
					return new WP_Error( 'organization_exists', __( 'User with this organization name already exists.', 'ytism' ) );
				} else {
					// Update existing record with new alias_user_id.
					if ( isset( $aliasUserData['userId'] ) && ! empty( $aliasUserData['userId'] ) && intval( $aliasUserData['userId'] ) > 0 ) {
						$orgUser->update_user( $aliasUserData );
						return $orgUser->get_wp_user_id();
					}
				}
			}
		}

		$filtered = apply_filters(
			'ytism_register_data',
			[
				'alias_email' => $alias_email,
				'user_login'  => $user_login,
				'user'        => $aliasUserData,
				'stage'       => 'before_user_creation',
			]
		);

		$alias_email   = $filtered['alias_email'];
		$user_login    = $filtered['user_login'];
		$aliasUserData = $filtered['user'];
		$alias_user_id = $aliasUserData['userId'] ?? null;

		do_action( 'ytism_before_alias_user_creation', $filtered );

		$password = ( $alias_verified && ! empty( $userdata['password'] ) )
					? $userdata['password']
					: wp_generate_password( 12, false );

		$valid = self::validate_userdata( $aliasUserData );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		$wp_user_id = wp_insert_user(
			[
				'user_login'   => $user_login,
				'user_email'   => $alias_email,
				'first_name'   => $aliasUserData['name'] ?? '',
				'last_name'    => $aliasUserData['lastName'] ?? '',
				'display_name' => trim( ( $aliasUserData['name'] ?? '' ) . ' ' . ( $aliasUserData['lastName'] ?? '' ) ),
				'user_pass'    => $password,
				'role'         => 'subscriber',
			]
		);

		if ( is_wp_error( $wp_user_id ) ) {
			return $wp_user_id;
		}

		foreach ( [ 'password', 'pass', 'user_pass' ] as $key ) {
			unset( $aliasUserData[ $key ] );
		}

		$alias_user_id_db = ! empty( $alias_user_id ) ? (int) $alias_user_id : null;
		$wpdb->insert(
			self::table(),
			[
				'wp_user_id'    => (int) $wp_user_id,
				'alias_user_id' => $alias_user_id_db,
				'userdata'      => wp_json_encode( $aliasUserData ),
				'last_sync'     => current_time( 'mysql' ),
			],
			[ '%d', '%s', '%s', '%s' ]
		);

		if ( ! $wpdb->insert_id ) {
			wp_delete_user( $wp_user_id );
			return new WP_Error( 'db_error', __( 'Failed to add new alias user.', 'ytism' ) );
		}

		do_action(
			'ytism_after_alias_user_creation',
			[
				'wp_user_id' => $wp_user_id,
				'alias_id'   => $wpdb->insert_id,
			]
		);

		update_user_meta( $wp_user_id, 'ytism_alias_verified', $alias_verified ? 1 : 0 );
		if ( ! $alias_verified ) {
			$encrypted_pass = Functions::encrypt_str( $userdata['password'] ?? $password );
			update_user_meta( $wp_user_id, 'ytism_alias_password', $encrypted_pass );
		}

		return (int) $wp_user_id;
	}

	public function has_active_subscription() {
		$has_subscription = true;
		$active_subs      = Factory::subscription()->get_user_active_subscription( $this->get_wp_user_id() );
		if ( ! empty( $active_subs ) || $active_subs !== null ) {
			return true;
		}

		$subscription = $this->get_subscription();
		if ( ! $subscription || ! isset( $subscription['status'] ) ) {
			$has_subscription = false;
		}

		$active_statuses = [ 'active', 'past_due', 'trialing' ];
		if ( isset( $subscription['status'] ) && in_array( $subscription['status'], $active_statuses, true ) ) {
			return true;
		}

		return $has_subscription;
	}

	// check if the related user have any active subscription plans.
	public function get_subscription() {
		if ( ! $this->exists() ) {
			return false;
		}

		$userdata = $this->get_userdata();
		if ( isset( $userdata['subscriptionStatus'] ) && ! in_array( $userdata['subscriptionStatus'], [ 'CancelledMonthly', 'CancelledTrial', 'ExpiredFree', 'Free', 'CancelledAnnual' ], true ) ) {
			return [
				'status'   => $userdata['subscriptionStatus'],
				'end_date' => isset( $userdata['subscriptionEndDate'] ) ? strtotime( $userdata['subscriptionEndDate'] ) : 0,
			];
		}

		// Check wp site.
		$user = get_user_by( 'id', $this->get_wp_user_id() );
		if ( ! $user ) {
			return false;
		}

		$longest_subscription = null;
		$latest_end_date      = 0;
		/*
		if ( function_exists( 'wcs_get_users_subscriptions' ) ) {
			$subscriptions = wcs_get_users_subscriptions( $user_id );

			if ( ! empty( $subscriptions ) ) {
				foreach ( $subscriptions as $subscription ) {
					if ( $subscription->has_status( [ 'active', 'on-hold' ] ) ) {
						$end_date = $subscription->get_date( 'end' );
						$check_date = $end_date ?: $subscription->get_date( 'next_payment' );

						if ( $check_date ) {
							$timestamp = strtotime( $check_date );
							if ( $timestamp > $latest_end_date ) {
								$latest_end_date      = $timestamp;
								$longest_subscription = $subscription;
							}
						}
					}
				}
			}
		}*/

		if ( $longest_subscription ) {
			return [
				'status'   => $longest_subscription,
				'end_date' => $latest_end_date,
			];
		}

		return false;
	}
}
