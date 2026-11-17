<?php
/**
 * YTISM API Class
 *
 * @package YTISM\Core
 */

namespace YTISM\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * API Class
 */
class Api {
	/**
	 * Base URL for API requests
	 *
	 * @var string
	 */
	private string $base_url;

	/**
	 * API key for authentication
	 *
	 * @var string
	 */
	private string $api_key;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->base_url = trailingslashit( 'https://api.domain.com/api/v1/' );
		$this->api_key  = '';
	}

	/**
	 * Send request to API
	 *
	 * @param string $endpoint API endpoint.
	 * @param array  $body Request body data.
	 * @param string $method HTTP method.
	 * @return array Response data.
	 */
	private function request( string $endpoint, array $body = [], string $method = 'POST' ): array {
		$args = [
			'method'  => $method,
			'timeout' => 30,
			'headers' => [
				'Content-Type' => 'application/json',
			],
			'body'    => ! empty( $body ) ? wp_json_encode( $body ) : null,
		];

		$response = wp_remote_request( $this->base_url . ltrim( $endpoint, '/' ), $args );

		if ( is_wp_error( $response ) ) {
			return [
				'success' => false,
				'status'  => 0,
				'data'    => [],
				'message' => $response->get_error_message(),
			];
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		return [
			'success' => ( $code >= 200 && $code < 300 ),
			'status'  => $code,
			'data'    => $body,
		];
	}

	/**
	 * Check if user exists in API
	 *
	 * @param string|array $data User data to check.
	 * @return array Response data.
	 */
	public function user_exists( string|array $data ): array {
		$check_data = [];

		if ( is_string( $data ) ) {
			$check_data['emailId'] = $data;
		} elseif ( is_array( $data ) ) {
			if ( isset( $data['email'] ) ) {
				$check_data['emailId'] = (string) $data['email'];
			}
			if ( isset( $data['organizationName'] ) ) {
				$check_data['organizationName'] = (string) $data['organizationName'];
			}
			if ( isset( $data['phone'] ) ) {
				$check_data['phone'] = (string) $data['phone'];
			}
		} else {
			return [
				'success' => false,
				'status'  => 0,
				'data'    => [],
				'message' => 'Invalid data provided for user existence check.',
			];
		}

		return $this->request( 'auth/website/validate', $check_data, 'POST' );
	}

	/**
	 * Register user in API
	 *
	 * @param string $email User email.
	 * @param string $password User password.
	 * @param string $first_name User first name.
	 * @param string $last_name User last name.
	 * @return array Response data.
	 */
	public function register_user( string $email, string $password, string $first_name, string $last_name ): array {
		return $this->request(
			'auth/website/users/register',
			[
				'email'      => $email,
				'password'   => $password,
				'first_name' => $first_name,
				'last_name'  => $last_name,
			],
			'POST'
		);
	}

	/**
	 * Login user via API
	 *
	 * @param string $username Username or email.
	 * @param string $password User password.
	 * @return array Response data.
	 */
	public function login_user( string $username, string $password ): array {
		$response = $this->request(
			'auth/website/sign-in',
			[
				'username' => $username,
				'password' => $password,
			],
			'POST'
		);

		$code = (int) $response['status'];
		$body = $response['data'];

		if ( isset( $body['operation']['usrFound'] ) && false === $body['operation']['usrFound'] ) {
			return [
				'success' => false,
				'type'    => 'user_not_found',
				'message' => __( 'The user does not exist.', 'ytism' ),
			];
		} elseif ( 401 === $code || ( isset( $body['operation']['usrFound'] ) && true === $body['operation']['usrFound'] ) || ( isset( $body['statusCode'] ) && 401 === $body['statusCode'] ) ) {
			return [
				'success' => false,
				'type'    => 'invalid_credentials',
				'message' => __( 'Invalid username/email or password.', 'ytism' ),
			];
		}

		if ( isset( $body['token'], $body['user'] ) ) {
			return [
				'success' => true,
				'type'    => 'login_success',
				'data'    => $body,
			];
		}

		return [
			'success' => false,
			'type'    => 'error',
			'status'  => $code,
			'message' => $body['message'] ?? __( 'Unexpected error occurred, please try again later.', 'ytism' ),
			'data'    => $body,
		];
	}

	/**
	 * Create super manager via API
	 *
	 * @param array $data Manager data.
	 * @return array Response data.
	 */
	public function create_super_manager( array $data ): array {
		$require_fields = [
			'organizationId' => '',
			'firstName'      => '',
			'lastName'       => '',
			'email'          => '',
			'countryCode'    => '',
			'phoneNumber'    => '',
		];

		$post_data = array_merge( $require_fields, $data );
		return $this->request( 'enterprise-organization/website/manager/create', $post_data, 'POST' );
	}

	/**
	 * Create enterprise user via API
	 *
	 * @param array $data Enterprise user data.
	 * @return array Response data.
	 */
	public function create_enterprise_user( array $data ): array {
		$require_fields = [
			'countryId'             => 0,
			'countryCode'           => '',
			'organizationName'      => '',
			'name'                  => '',
			'seats'                 => 0,
			'organizationType'      => '',
			'phone'                 => '',
			'departments'           => [],
			'email'                 => '',
			'password'              => '',
			'subscriptionStartDate' => '',
			'customerId'            => '',
			'subscriptionId'        => '',
			'invoiceId'             => '',
			'paymentIntentId'       => '',
			'price'                 => '',
			'pdfLink'               => '',
		];

		$post_data = array_merge( $require_fields, $data );
		return $this->request( 'enterprise-organization/website/create', $post_data, 'POST' );
	}

	/**
	 * Create Family User
	 *
	 * @param array $data Family user data.
	 * @return array Response data.
	 */
	public function create_family_user( array $data ): array {
		unset( $data['planType'] );

		$require_fields = [
			'name'                         => '',
			'lastName'                     => '',
			'email'                        => '',
			'password'                     => '',
			'monthly'                      => 0,
			'planPaymentAmount'            => '0.00',
			'stripeCustomerId'             => '',
			'stripeSubscriptionId'         => '',
			'stripePaymentIntentId'        => '',
			'originalValueWithoutDiscount' => 0,
			'planType'                     => 2,
			'language'                     => 'US',
			'familyMembers'                => 1,
		];

		$post_data                                 = array_merge( $require_fields, $data );
		$post_data['planPaymentAmount']            = (string) $post_data['planPaymentAmount'];
		$post_data['originalValueWithoutDiscount'] = (float) $post_data['originalValueWithoutDiscount'];
		$post_data['familyMembers']                = (int) $post_data['familyMembers'];

		return $this->request( 'b2c-users/create', $post_data, 'POST' );
	}

	/**
	 * Create Individual User
	 *
	 * @param array $data Individual user data.
	 * @return array Response data.
	 */
	public function create_individual_user( array $data ): array {
		unset( $data['planType'], $data['familyMembers'] );

		$require_fields = [
			'name'                         => '',
			'lastName'                     => '',
			'email'                        => '',
			'password'                     => '',
			'monthly'                      => 0,
			'planPaymentAmount'            => '0.00',
			'stripeCustomerId'             => '',
			'stripeSubscriptionId'         => '',
			'stripePaymentIntentId'        => '',
			'originalValueWithoutDiscount' => 0,
			'planType'                     => 1,
			'language'                     => 'US',
		];

		$post_data                                 = array_merge( $require_fields, $data );
		$post_data['planPaymentAmount']            = (string) $post_data['planPaymentAmount'];
		$post_data['originalValueWithoutDiscount'] = (float) $post_data['originalValueWithoutDiscount'];

		return $this->request( 'b2c-users/create', $post_data, 'POST' );
	}

	/**
	 * Validate Redeem Code
	 *
	 * @param string $promo_code Promo code.
	 * @param string $email User email.
	 * @return array Response data.
	 */
	public function validate_redeem_code( string $promo_code, string $email ): array {
		if ( empty( $promo_code ) || empty( $email ) ) {
			return [
				'success' => false,
				'type'    => 'empty_fields',
				'message' => __( 'Promo code and email are required.', 'ytism' ),
			];
		}

		$response = $this->request(
			'coupon/public/redeem-coupon',
			[
				'promoCode' => $promo_code,
				'email'     => $email,
			],
			'POST'
		);

		$code = (int) $response['status'];
		$body = $response['data'];

		if ( 400 === $code || ( isset( $body['statusCode'] ) && 400 === $body['statusCode'] ) ) {
			return [
				'success' => false,
				'type'    => 'invalid_code',
				'message' => __( 'The redeem code is invalid or has already been used.', 'ytism' ),
			];
		}

		if ( isset( $body['statusCode'] ) && 404 === $body['statusCode'] ) {
			return [
				'success' => false,
				'type'    => 'invalid_code',
				'message' => __( 'Invalid promo code.', 'ytism' ),
			];
		}

		if ( isset( $body['couponId'] ) ) {
			return [
				'success' => true,
				'type'    => 'code_valid',
				'data'    => $body,
			];
		}

		return [
			'success' => false,
			'type'    => 'error',
			'status'  => $code,
			'message' => $body['message'] ?? __( 'Unexpected error occurred, please try again later.', 'ytism' ),
			'data'    => $body,
		];
	}
}
