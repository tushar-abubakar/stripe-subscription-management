<?php
namespace YTISM\Helpers;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Stripe_Error_Codes {
	public static function get_error_message( $error ) {
		// Check if it's a card error type
		if ( isset( $error->type ) && $error->type === 'card_error' ) {
			// Check if it's actually a card payment method or a generic error
			$payment_method_type = self::get_payment_method_type( $error );

			// If it's not a card but labeled as card_error, treat it as a payment method error
			if ( $payment_method_type && $payment_method_type !== 'card' ) {
				return self::get_payment_method_error_message( $error, $payment_method_type );
			}

			return self::get_card_error_message( $error );
		}

		// Default for non-card errors
		$message        = isset( $error->message ) ? $error->message : __( 'An error occurred while processing your payment. Please try again.', 'ytism' );
		$system_message = isset( $error->message ) ? $error->message : __( 'Payment processing error.', 'ytism' );

		return [
			'user_message'   => $message,
			'system_message' => $system_message,
		];
	}

	/**
	 * Get payment method type from error object
	 *
	 * @param object $error Stripe error object
	 * @return string|null Payment method type
	 */
	private static function get_payment_method_type( $error ) {
		if ( isset( $error->payment_method->type ) ) {
			return $error->payment_method->type;
		}
		return null;
	}

	/**
	 * Get formatted error messages for payment method errors (non-card)
	 *
	 * @param object $error Stripe error object
	 * @param string $payment_method_type Payment method type (e.g., 'cashapp', 'bank_account')
	 * @return array Array with 'user_message' and 'system_message' keys
	 */
	public static function get_payment_method_error_message( $error, $payment_method_type ) {
		$code         = isset( $error->code ) ? $error->code : '';
		$decline_code = isset( $error->decline_code ) ? $error->decline_code : '';

		// Get payment method specific messages
		$messages = self::get_payment_method_specific_messages( $code, $decline_code, $payment_method_type );

		// If no specific message, get generic error code message
		if ( empty( $messages ) ) {
			$messages = self::get_error_code_messages( $code );
		}

		// Build admin message with error codes
		$system_debug_info = [];
		if ( ! empty( $error->type ) ) {
			$system_debug_info[] = sprintf( __( 'Error Type: %s', 'ytism' ), $error->type );
		}
		if ( ! empty( $payment_method_type ) ) {
			$system_debug_info[] = sprintf( __( 'Payment Method: %s', 'ytism' ), $payment_method_type );
		}
		if ( ! empty( $code ) ) {
			$system_debug_info[] = sprintf( __( 'Error Code: %s', 'ytism' ), $code );
		}
		if ( ! empty( $decline_code ) ) {
			$system_debug_info[] = sprintf( __( 'Decline Code: %s', 'ytism' ), $decline_code );
		}

		$system_message = $messages['system_message'];
		if ( ! empty( $system_debug_info ) ) {
			$system_message .= ' [' . implode( ' | ', $system_debug_info ) . ']';
		}

		return [
			'user_message'   => $messages['user_message'],
			'system_message' => $system_message,
		];
	}

	/**
	 * Get payment method specific error messages
	 *
	 * @param string $code Error code
	 * @param string $decline_code Decline code
	 * @param string $payment_method_type Payment method type
	 * @return array
	 */
	private static function get_payment_method_specific_messages( $code, $decline_code, $payment_method_type ) {
		// Format payment method name for display
		$payment_method_name = self::get_payment_method_display_name( $payment_method_type );

		// Handle decline codes first (more specific)
		if ( ! empty( $decline_code ) ) {
			$decline_messages = self::get_payment_method_decline_messages( $decline_code, $payment_method_name );
			if ( ! empty( $decline_messages ) ) {
				return $decline_messages;
			}
		}

		// Handle error codes
		if ( ! empty( $code ) ) {
			return self::get_payment_method_code_messages( $code, $payment_method_name );
		}

		// Default fallback
		return [
			'user_message'   => sprintf( __( 'Your %s payment could not be processed. Please try a different payment method.', 'ytism' ), $payment_method_name ),
			'system_message' => sprintf( __( '%s payment failed.', 'ytism' ), ucfirst( $payment_method_type ) ),
		];
	}

	/**
	 * Get display name for payment method type
	 *
	 * @param string $payment_method_type Payment method type
	 * @return string Display name
	 */
	private static function get_payment_method_display_name( $payment_method_type ) {
		$names = [
			'cashapp'           => 'Cash App',
			'bank_account'      => 'bank account',
			'us_bank_account'   => 'bank account',
			'sepa_debit'        => 'SEPA Direct Debit',
			'ideal'             => 'iDEAL',
			'sofort'            => 'Sofort',
			'giropay'           => 'Giropay',
			'alipay'            => 'Alipay',
			'wechat_pay'        => 'WeChat Pay',
			'klarna'            => 'Klarna',
			'affirm'            => 'Affirm',
			'afterpay_clearpay' => 'Afterpay',
			'paypal'            => 'PayPal',
			'link'              => 'Link',
			'bacs_debit'        => 'Bacs Direct Debit',
			'acss_debit'        => 'Pre-authorized debit',
		];

		return isset( $names[ $payment_method_type ] ) ? $names[ $payment_method_type ] : $payment_method_type;
	}

	/**
	 * Get error messages based on error code for payment methods
	 *
	 * @param string $code Error code
	 * @param string $payment_method_name Display name of payment method
	 * @return array
	 */
	private static function get_payment_method_code_messages( $code, $payment_method_name ) {
		$specific_messages = [
			'payment_method_provider_decline' => [
				'user_message'   => sprintf( __( 'Your %s payment was declined. Please try a different payment method.', 'ytism' ), $payment_method_name ),
				'system_message' => sprintf( __( '%s payment declined by provider.', 'ytism' ), $payment_method_name ),
			],
			'payment_method_provider_timeout' => [
				'user_message'   => sprintf( __( 'Your %s payment timed out. Please try again.', 'ytism' ), $payment_method_name ),
				'system_message' => sprintf( __( '%s payment provider timeout.', 'ytism' ), $payment_method_name ),
			],
			'payment_method_customer_decline' => [
				'user_message'   => sprintf( __( 'You declined the %s payment. Please try again if you wish to complete the purchase.', 'ytism' ), $payment_method_name ),
				'system_message' => sprintf( __( 'Customer declined %s payment.', 'ytism' ), $payment_method_name ),
			],
			'payment_method_not_available'    => [
				'user_message'   => sprintf( __( '%s is temporarily unavailable. Please try a different payment method or try again later.', 'ytism' ), ucfirst( $payment_method_name ) ),
				'system_message' => sprintf( __( '%s payment method not available.', 'ytism' ), $payment_method_name ),
			],
		];

		if ( isset( $specific_messages[ $code ] ) ) {
			return $specific_messages[ $code ];
		}

		// Return empty to fall back to generic error code messages
		return [];
	}

	/**
	 * Get error messages based on decline code for payment methods
	 *
	 * @param string $decline_code Decline code
	 * @param string $payment_method_name Display name of payment method
	 * @return array
	 */
	private static function get_payment_method_decline_messages( $decline_code, $payment_method_name ) {
		$pretty_name = Functions::get_payment_type_label( $payment_method_name );
		$messages    = [
			'generic_decline'         => [
				'user_message'   => sprintf( __( 'Your %1$s payment was declined. Please try a different payment method or contact %2$s support.', 'ytism' ), $pretty_name, $pretty_name ),
				'system_message' => sprintf( __( '%s generic decline.', 'ytism' ), $pretty_name ),
			],
			'insufficient_funds'      => [
				'user_message'   => sprintf( __( 'Your %s account has insufficient funds. Please use a different payment method.', 'ytism' ), $pretty_name ),
				'system_message' => sprintf( __( '%s insufficient funds.', 'ytism' ), $pretty_name ),
			],
			'transaction_not_allowed' => [
				'user_message'   => sprintf( __( 'This transaction is not allowed with %s. Please use a different payment method.', 'ytism' ), $pretty_name ),
				'system_message' => sprintf( __( '%s transaction not allowed.', 'ytism' ), $pretty_name ),
			],
			'try_again_later'         => [
				'user_message'   => sprintf( __( 'Your %s payment could not be processed right now. Please try again later or use a different payment method.', 'ytism' ), $pretty_name ),
				'system_message' => sprintf( __( '%s temporary decline.', 'ytism' ), $pretty_name ),
			],
			'do_not_honor'            => [
				'user_message'   => sprintf( __( 'Your %1$s payment was declined. Please contact %2$s support for more information.', 'ytism' ), $pretty_name, $pretty_name ),
				'system_message' => sprintf( __( '%s declined without specific reason.', 'ytism' ), $pretty_name ),
			],
			'processing_error'        => [
				'user_message'   => sprintf( __( 'An error occurred while processing your %s payment. Please try again.', 'ytism' ), $pretty_name ),
				'system_message' => sprintf( __( '%s processing error.', 'ytism' ), $pretty_name ),
			],
		];

		return isset( $messages[ $decline_code ] ) ? $messages[ $decline_code ] : [];
	}


	/**
	 * Get formatted error messages for card errors
	 *
	 * @param object $error Stripe error object
	 * @return array Array with 'user_message' and 'system_message' keys
	 */
	public static function get_card_error_message( $error ) {
		$code         = isset( $error->code ) ? $error->code : '';
		$decline_code = isset( $error->decline_code ) ? $error->decline_code : '';
		$message      = isset( $error->message ) ? $error->message : '';

		// Get base messages from code
		$messages = self::get_error_code_messages( $code );

		// Override or enhance with decline code if available
		if ( ! empty( $decline_code ) ) {
			$decline_messages = self::get_decline_code_messages( $decline_code );
			if ( ! empty( $decline_messages ) ) {
				$messages = $decline_messages;
			}
		}

		// Build admin message with error codes
		$system_debug_info = [];
		if ( ! empty( $error->type ) ) {
			$system_debug_info[] = sprintf( __( 'Error Type: %s', 'ytism' ), $error->type );
		}
		if ( ! empty( $code ) ) {
			$system_debug_info[] = sprintf( __( 'Error Code: %s', 'ytism' ), $code );
		}
		if ( ! empty( $decline_code ) ) {
			$system_debug_info[] = sprintf( __( 'Decline Code: %s', 'ytism' ), $decline_code );
		}

		$system_message = $messages['system_message'];
		if ( ! empty( $system_debug_info ) ) {
			$system_message .= ' [' . implode( ' | ', $system_debug_info ) . ']';
		}

		return [
			'user_message'   => $messages['user_message'],
			'system_message' => $system_message,
		];
	}

	/**
	 * Get messages based on error code
	 *
	 * @param string $code Error code
	 * @return array
	 */
	private static function get_error_code_messages( $code ) {
		$messages = [
			'account_closed'                               => [
				'user_message'   => __( 'Your bank account has been closed. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Customer bank account has been closed.', 'ytism' ),
			],
			'account_country_invalid_address'              => [
				'user_message'   => __( 'There is an issue with the account configuration. Please contact support.', 'ytism' ),
				'system_message' => __( 'Business address country does not match account country.', 'ytism' ),
			],
			'account_invalid'                              => [
				'user_message'   => __( 'There is a payment configuration issue. Please contact support.', 'ytism' ),
				'system_message' => __( 'Invalid Stripe-Account header. Check account ID.', 'ytism' ),
			],
			'account_error_country_change_requires_additional_steps' => [
				'user_message'   => __( 'Account configuration issue. Please contact support.', 'ytism' ),
				'system_message' => __( 'Country change requires additional steps. Contact Stripe support.', 'ytism' ),
			],
			'account_number_invalid'                       => [
				'user_message'   => __( 'The bank account number is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid bank account number (missing digits).', 'ytism' ),
			],
			'amount_too_large'                             => [
				'user_message'   => __( 'The amount is too large. Please use a lower amount.', 'ytism' ),
				'system_message' => __( 'Amount exceeds maximum allowed.', 'ytism' ),
			],
			'amount_too_small'                             => [
				'user_message'   => __( 'The amount is too small. Please use a higher amount.', 'ytism' ),
				'system_message' => __( 'Amount is below minimum allowed.', 'ytism' ),
			],
			'api_key_expired'                              => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'API key has expired. Update integration with current keys.', 'ytism' ),
			],
			'authentication_required'                      => [
				'user_message'   => __( 'This payment requires authentication. Please complete the verification.', 'ytism' ),
				'system_message' => __( 'Payment requires authentication (3D Secure).', 'ytism' ),
			],
			'balance_insufficient'                         => [
				'user_message'   => __( 'Insufficient funds for this transaction. Please contact support.', 'ytism' ),
				'system_message' => __( 'Account balance insufficient for transfer/payout.', 'ytism' ),
			],
			'balance_invalid_parameter'                    => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Invalid parameter in balance method object.', 'ytism' ),
			],
			'bank_account_bad_routing_numbers'             => [
				'user_message'   => __( 'This bank account does not support the selected currency. Please use a different account.', 'ytism' ),
				'system_message' => __( 'Bank account does not support currency.', 'ytism' ),
			],
			'bank_account_declined'                        => [
				'user_message'   => __( 'Your bank account cannot be used. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Bank account declined - not verified or not supported.', 'ytism' ),
			],
			'bank_account_exists'                          => [
				'user_message'   => __( 'This bank account already exists. Please use a different account.', 'ytism' ),
				'system_message' => __( 'Bank account already exists on Customer object.', 'ytism' ),
			],
			'bank_account_verification_failed'             => [
				'user_message'   => __( 'Bank account verification failed. Please check the amounts and try again.', 'ytism' ),
				'system_message' => __( 'Microdeposit amounts incorrect or too many verification attempts.', 'ytism' ),
			],
			'bank_account_unusable'                        => [
				'user_message'   => __( 'This bank account cannot be used. Please use a different account.', 'ytism' ),
				'system_message' => __( 'Bank account cannot be used.', 'ytism' ),
			],
			'bank_account_unverified'                      => [
				'user_message'   => __( 'Bank account is not verified. Please contact support.', 'ytism' ),
				'system_message' => __( 'Platform attempting to share unverified bank account.', 'ytism' ),
			],
			'capture_charge_authorization_expired'         => [
				'user_message'   => __( 'The payment authorization has expired. Please try again.', 'ytism' ),
				'system_message' => __( 'Charge authorization expired. Cannot capture.', 'ytism' ),
			],
			'capture_unauthorized_payment'                 => [
				'user_message'   => __( 'This payment cannot be processed. Please contact support.', 'ytism' ),
				'system_message' => __( 'Charge not authorized for capture.', 'ytism' ),
			],
			'card_decline_rate_limit_exceeded'             => [
				'user_message'   => __( 'This card has been declined too many times. Please try again after 24 hours or use a different card.', 'ytism' ),
				'system_message' => __( 'Card declined too many times. Retry after 24 hours.', 'ytism' ),
			],
			'charge_already_captured'                      => [
				'user_message'   => __( 'This payment has already been processed. Please contact support if needed.', 'ytism' ),
				'system_message' => __( 'Charge already captured.', 'ytism' ),
			],
			'charge_already_refunded'                      => [
				'user_message'   => __( 'This payment has already been refunded.', 'ytism' ),
				'system_message' => __( 'Charge already refunded.', 'ytism' ),
			],
			'charge_disputed'                              => [
				'user_message'   => __( 'This payment is under dispute. Please contact support.', 'ytism' ),
				'system_message' => __( 'Charge disputed/charged back.', 'ytism' ),
			],
			'charge_exceeds_source_limit'                  => [
				'user_message'   => __( 'Processing limit exceeded. Please try again later or contact support.', 'ytism' ),
				'system_message' => __( 'Exceeds rolling-window processing limit for source type.', 'ytism' ),
			],
			'charge_exceeds_transaction_limit'             => [
				'user_message'   => __( 'Transaction limit exceeded. Please contact support.', 'ytism' ),
				'system_message' => __( 'Exceeds processing limit for payment type.', 'ytism' ),
			],
			'charge_invalid_parameter'                     => [
				'user_message'   => __( 'Invalid payment information. Please try again.', 'ytism' ),
				'system_message' => __( 'Invalid parameter for Charge operation.', 'ytism' ),
			],
			'country_unsupported'                          => [
				'user_message'   => __( 'This country is not supported. Please contact support.', 'ytism' ),
				'system_message' => __( 'Custom account country not supported.', 'ytism' ),
			],
			'country_code_invalid'                         => [
				'user_message'   => __( 'The country code is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid country code.', 'ytism' ),
			],
			'coupon_expired'                               => [
				'user_message'   => __( 'The coupon has expired. Please use a different coupon.', 'ytism' ),
				'system_message' => __( 'Coupon expired. Use valid coupon.', 'ytism' ),
			],
			'customer_max_subscriptions'                   => [
				'user_message'   => __( 'Maximum subscriptions reached. Please contact support.', 'ytism' ),
				'system_message' => __( 'Customer reached max subscriptions.', 'ytism' ),
			],
			'customer_max_payment_methods'                 => [
				'user_message'   => __( 'Maximum payment methods reached. Please remove some before adding new ones.', 'ytism' ),
				'system_message' => __( 'Customer reached max PaymentMethods. Detach some first.', 'ytism' ),
			],
			'customer_tax_location_invalid'                => [
				'user_message'   => __( 'Your address is missing or invalid. Please provide a complete address with country and postal code.', 'ytism' ),
				'system_message' => __( 'Customer address invalid for tax. Need ISO country code and postal_code.', 'ytism' ),
			],
			'shipping_address_invalid'                     => [
				'user_message'   => __( 'The shipping address is invalid. Please verify all address fields.', 'ytism' ),
				'system_message' => __( 'Shipping address cannot determine tax rates. Check zip/postal, state/province.', 'ytism' ),
			],
			'billing_invalid_mandate'                      => [
				'user_message'   => __( 'This payment method requires additional setup. Please contact support.', 'ytism' ),
				'system_message' => __( 'PaymentMethod missing active mandate. Must confirm on-session first.', 'ytism' ),
			],
			'email_invalid'                                => [
				'user_message'   => __( 'The email address is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Email address improperly formatted.', 'ytism' ),
			],
			'idempotency_key_in_use'                       => [
				'user_message'   => __( 'This request is already being processed. Please wait.', 'ytism' ),
				'system_message' => __( 'Idempotency key in use. Duplicate requests detected.', 'ytism' ),
			],
			'financial_connections_account_inactive'       => [
				'user_message'   => __( 'Financial account is inactive. Please contact support.', 'ytism' ),
				'system_message' => __( 'Cannot refresh data on inactive Financial Connections account.', 'ytism' ),
			],
			'financial_connections_no_successful_transaction_refresh' => [
				'user_message'   => __( 'Transaction data unavailable. Please contact support.', 'ytism' ),
				'system_message' => __( 'Account needs at least one successful transaction refresh.', 'ytism' ),
			],
			'instant_payouts_unsupported'                  => [
				'user_message'   => __( 'Instant payouts are not available. Please contact support.', 'ytism' ),
				'system_message' => __( 'Instant Payouts not available for this request.', 'ytism' ),
			],
			'instant_payouts_limit_exceeded'               => [
				'user_message'   => __( 'Daily instant payout limit reached. Please try again tomorrow.', 'ytism' ),
				'system_message' => __( 'Daily Instant Payouts limit exceeded.', 'ytism' ),
			],
			'instant_payouts_config_disabled'              => [
				'user_message'   => __( 'Instant payouts are not enabled. Please contact support.', 'ytism' ),
				'system_message' => __( 'Connected account not eligible for Instant Payouts.', 'ytism' ),
			],
			'payouts_limit_exceeded'                       => [
				'user_message'   => __( 'Daily payout limit reached. Please try again tomorrow.', 'ytism' ),
				'system_message' => __( 'Daily payout limit exceeded.', 'ytism' ),
			],
			'insufficient_funds'                           => [
				'user_message'   => __( 'Your account has insufficient funds. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Customer account has insufficient funds.', 'ytism' ),
			],
			'invalid_characters'                           => [
				'user_message'   => __( 'Invalid characters in the information provided. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Field contains unsupported characters.', 'ytism' ),
			],
			'invalid_card_type'                            => [
				'user_message'   => __( 'This card type is not supported. Please use a different card.', 'ytism' ),
				'system_message' => __( 'Card type not supported for payouts. Need non-prepaid debit card.', 'ytism' ),
			],
			'invoice_no_customer_line_items'               => [
				'user_message'   => __( 'No items to invoice. Please contact support.', 'ytism' ),
				'system_message' => __( 'No pending invoice items for customer.', 'ytism' ),
			],
			'invoice_on_behalf_of_not_editable'            => [
				'user_message'   => __( 'This invoice cannot be modified. Please contact support.', 'ytism' ),
				'system_message' => __( 'Cannot update on_behalf_of after invoice assigned number.', 'ytism' ),
			],
			'invoice_no_payment_method_types'              => [
				'user_message'   => __( 'No payment methods available. Please contact support.', 'ytism' ),
				'system_message' => __( 'No payment method types available. Check invoice settings or activate methods.', 'ytism' ),
			],
			'invoice_no_subscription_line_items'           => [
				'user_message'   => __( 'No subscription items to invoice. Please contact support.', 'ytism' ),
				'system_message' => __( 'No pending invoice items for subscription.', 'ytism' ),
			],
			'invoice_not_editable'                         => [
				'user_message'   => __( 'This invoice cannot be edited. Please contact support.', 'ytism' ),
				'system_message' => __( 'Invoice no longer editable. Create invoice items for next invoice.', 'ytism' ),
			],
			'invoice_payment_intent_requires_action'       => [
				'user_message'   => __( 'This payment requires additional action. Please complete the verification.', 'ytism' ),
				'system_message' => __( 'Payment requires user action. Use PaymentIntent to complete.', 'ytism' ),
			],
			'invoice_upcoming_none'                        => [
				'user_message'   => __( 'No upcoming invoice available. Please contact support.', 'ytism' ),
				'system_message' => __( 'No upcoming invoice for customer. Need active subscription or pending items.', 'ytism' ),
			],
			'no_account'                                   => [
				'user_message'   => __( 'The bank account could not be found. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Bank account not located.', 'ytism' ),
			],
			'debit_not_authorized'                         => [
				'user_message'   => __( 'This payment was not authorized by your bank. Please contact your bank.', 'ytism' ),
				'system_message' => __( 'Customer notified bank that payment was unauthorized.', 'ytism' ),
			],
			'bank_account_restricted'                      => [
				'user_message'   => __( 'Your account cannot be used for this payment. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Customer account restricted for this payment method.', 'ytism' ),
			],
			'out_of_inventory'                             => [
				'user_message'   => __( 'Item is out of stock. Please contact support.', 'ytism' ),
				'system_message' => __( 'Line items out of stock.', 'ytism' ),
			],
			'parameter_invalid_empty'                      => [
				'user_message'   => __( 'Required information is missing. Please check your details.', 'ytism' ),
				'system_message' => __( 'Required values not provided.', 'ytism' ),
			],
			'parameter_invalid_integer'                    => [
				'user_message'   => __( 'Invalid number format. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Parameter requires integer but different type provided.', 'ytism' ),
			],
			'parameter_invalid_string_blank'               => [
				'user_message'   => __( 'Invalid information provided. Please check for empty spaces.', 'ytism' ),
				'system_message' => __( 'Values contain only whitespace.', 'ytism' ),
			],
			'parameter_invalid_string_empty'               => [
				'user_message'   => __( 'Required information is empty. Please provide complete details.', 'ytism' ),
				'system_message' => __( 'Required string values are empty.', 'ytism' ),
			],
			'parameter_missing'                            => [
				'user_message'   => __( 'Required information is missing. Please check your details.', 'ytism' ),
				'system_message' => __( 'Required values missing.', 'ytism' ),
			],
			'parameter_unknown'                            => [
				'user_message'   => __( 'Invalid information provided. Please try again.', 'ytism' ),
				'system_message' => __( 'Unexpected parameters provided.', 'ytism' ),
			],
			'parameters_exclusive'                         => [
				'user_message'   => __( 'Conflicting information provided. Please check your details.', 'ytism' ),
				'system_message' => __( 'Mutually exclusive parameters provided.', 'ytism' ),
			],
			'acss_debit_session_incomplete'                => [
				'user_message'   => __( 'Payment session not ready. Please try again later.', 'ytism' ),
				'system_message' => __( 'ACSS debit session not ready. Retry later.', 'ytism' ),
			],
			'payment_method_billing_details_address_missing' => [
				'user_message'   => __( 'Billing address is missing. Please provide your complete address.', 'ytism' ),
				'system_message' => __( 'PaymentMethod missing billing address details.', 'ytism' ),
			],
			'payment_method_unsupported_type'              => [
				'user_message'   => __( 'This payment method type is not supported. Please use a different method.', 'ytism' ),
				'system_message' => __( 'Payment method type not supported.', 'ytism' ),
			],
			'payment_method_customer_decline'              => [
				'user_message'   => __( 'Payment was not approved. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Customer did not approve payment.', 'ytism' ),
			],
			'payment_method_microdeposit_verification_attempts_exceeded' => [
				'user_message'   => __( 'Too many verification attempts. Please contact support.', 'ytism' ),
				'system_message' => __( 'Microdeposit verification attempts exceeded.', 'ytism' ),
			],
			'intent_invalid_state'                         => [
				'user_message'   => __( 'This payment cannot be processed at this time. Please try again.', 'ytism' ),
				'system_message' => __( 'Intent in invalid state for operation.', 'ytism' ),
			],
			'intent_verification_method_missing'           => [
				'user_message'   => __( 'Payment verification method missing. Please contact support.', 'ytism' ),
				'system_message' => __( 'Intent missing verification method in PaymentMethodOptions.', 'ytism' ),
			],
			'payment_method_invalid_parameter'             => [
				'user_message'   => __( 'Invalid payment method information. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid parameter in payment method object.', 'ytism' ),
			],
			'payment_method_invalid_parameter_testmode'    => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Parameter not allowed in testmode.', 'ytism' ),
			],
			'payment_method_provider_timeout'              => [
				'user_message'   => __( 'Payment processor timed out. Please try again.', 'ytism' ),
				'system_message' => __( 'Payment method timeout. Check last_payment_error.', 'ytism' ),
			],
			'payment_method_provider_decline'              => [
				'user_message'   => __( 'Your payment was declined. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Payment declined by issuer/customer. Check last_payment_error.', 'ytism' ),
			],
			'payment_method_microdeposit_verification_amounts_mismatch' => [
				'user_message'   => __( 'Verification amounts do not match. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Microdeposit amounts do not match.', 'ytism' ),
			],
			'payment_method_microdeposit_verification_descriptor_code_mismatch' => [
				'user_message'   => __( 'Verification code does not match. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Verification code does not match.', 'ytism' ),
			],
			'payment_method_microdeposit_verification_amounts_invalid' => [
				'user_message'   => __( 'Invalid verification amounts. Please provide exactly two amounts.', 'ytism' ),
				'system_message' => __( 'Must provide exactly two microdeposit amounts.', 'ytism' ),
			],
			'payment_method_microdeposit_failed'           => [
				'user_message'   => __( 'Verification deposits failed. Please check your bank account details.', 'ytism' ),
				'system_message' => __( 'Microdeposits failed. Check account/institution/transit numbers and currency.', 'ytism' ),
			],
			'payment_method_microdeposit_verification_timeout' => [
				'user_message'   => __( 'Verification period expired. Please start verification again.', 'ytism' ),
				'system_message' => __( 'Microdeposit verification timeout exceeded.', 'ytism' ),
			],
			'payment_method_bank_account_already_verified' => [
				'user_message'   => __( 'This bank account is already verified.', 'ytism' ),
				'system_message' => __( 'Bank account already verified.', 'ytism' ),
			],
			'payment_method_bank_account_blocked'          => [
				'user_message'   => __( 'This bank account cannot be used. Please use a different account.', 'ytism' ),
				'system_message' => __( 'Bank account blocked due to failed verification.', 'ytism' ),
			],
			'payment_method_unactivated'                   => [
				'user_message'   => __( 'This payment method is not activated. Please contact support.', 'ytism' ),
				'system_message' => __( 'Payment method not activated in Dashboard.', 'ytism' ),
			],
			'payment_method_currency_mismatch'             => [
				'user_message'   => __( 'Currency mismatch. Please contact support.', 'ytism' ),
				'system_message' => __( 'Currency does not match payment method currency.', 'ytism' ),
			],
			'payment_method_unexpected_state'              => [
				'user_message'   => __( 'This payment method cannot be used right now. Please try a different method.', 'ytism' ),
				'system_message' => __( 'Payment method in incompatible state.', 'ytism' ),
			],
			'payment_method_not_available'                 => [
				'user_message'   => __( 'This payment method is temporarily unavailable. Please try a different method or try again later.', 'ytism' ),
				'system_message' => __( 'Payment processor temporarily unavailable.', 'ytism' ),
			],
			'payment_intent_unexpected_state'              => [
				'user_message'   => __( 'This payment cannot be processed right now. Please try again.', 'ytism' ),
				'system_message' => __( 'PaymentIntent in incompatible state.', 'ytism' ),
			],
			'payment_intent_incompatible_payment_method'   => [
				'user_message'   => __( 'This payment method is not compatible. Please use a different method.', 'ytism' ),
				'system_message' => __( 'PaymentIntent expects different payment method properties.', 'ytism' ),
			],
			'payment_intent_invalid_parameter'             => [
				'user_message'   => __( 'Invalid payment information. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid parameter for PaymentIntent operation.', 'ytism' ),
			],
			'payment_intent_mandate_invalid'               => [
				'user_message'   => __( 'Payment authorization is invalid. Please contact support.', 'ytism' ),
				'system_message' => __( 'Mandate invalid for payment intent.', 'ytism' ),
			],
			'setup_intent_mandate_invalid'                 => [
				'user_message'   => __( 'Payment authorization is invalid. Please contact support.', 'ytism' ),
				'system_message' => __( 'Mandate invalid for setup intent.', 'ytism' ),
			],
			'invalid_mandate_reference_prefix_format'      => [
				'user_message'   => __( 'Payment authorization format is invalid. Please contact support.', 'ytism' ),
				'system_message' => __( 'Invalid mandate reference prefix format.', 'ytism' ),
			],
			'payment_intent_konbini_rejected_confirmation_number' => [
				'user_message'   => __( 'Confirmation number was rejected. Please try again.', 'ytism' ),
				'system_message' => __( 'Konbini confirmation_number rejected by processing partner.', 'ytism' ),
			],
			'payment_intent_authentication_failure'        => [
				'user_message'   => __( 'Authentication failed. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Payment method authentication failed.', 'ytism' ),
			],
			'payment_intent_payment_attempt_failed'        => [
				'user_message'   => __( 'Your payment could not be processed. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Latest payment attempt failed. Check last_payment_error.', 'ytism' ),
			],
			'payment_intent_payment_attempt_expired'       => [
				'user_message'   => __( 'Payment attempt expired. Please try again.', 'ytism' ),
				'system_message' => __( 'Latest payment attempt expired. Check last_payment_error.', 'ytism' ),
			],
			'setup_intent_setup_attempt_expired'           => [
				'user_message'   => __( 'Setup attempt expired. Please try again.', 'ytism' ),
				'system_message' => __( 'Latest setup attempt expired. Check last_setup_error.', 'ytism' ),
			],
			'payment_intent_amount_reconfirmation_required' => [
				'user_message'   => __( 'The payment amount has changed. Please review and confirm.', 'ytism' ),
				'system_message' => __( 'Amount changed. Show updated amount to customer.', 'ytism' ),
			],
			'payment_intent_automatic_tax_incomplete'      => [
				'user_message'   => __( 'Tax calculation requires more location information. Please provide your complete address.', 'ytism' ),
				'system_message' => __( 'Insufficient location info for automatic tax calculation.', 'ytism' ),
			],
			'payment_intent_action_required'               => [
				'user_message'   => __( 'This payment requires additional action. Please complete the verification.', 'ytism' ),
				'system_message' => __( 'Payment requires customer action but error_on_requires_action was set.', 'ytism' ),
			],
			'platform_account_required'                    => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Only Stripe Connect platforms can work with other accounts.', 'ytism' ),
			],
			'setup_intent_authentication_failure'          => [
				'user_message'   => __( 'Authentication failed. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Payment method authentication failed for SetupIntent.', 'ytism' ),
			],
			'setup_intent_unexpected_state'                => [
				'user_message'   => __( 'Setup cannot be completed right now. Please try again.', 'ytism' ),
				'system_message' => __( 'SetupIntent in incompatible state.', 'ytism' ),
			],
			'setup_intent_invalid_parameter'               => [
				'user_message'   => __( 'Invalid setup information. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid parameter for SetupIntent operation.', 'ytism' ),
			],
			'setup_attempt_failed'                         => [
				'user_message'   => __( 'Setup failed. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Latest setup attempt failed. Check last_setup_error.', 'ytism' ),
			],
			'status_transition_invalid'                    => [
				'user_message'   => __( 'This action is not valid. Please contact support.', 'ytism' ),
				'system_message' => __( 'Requested status transition invalid.', 'ytism' ),
			],
			'payouts_not_allowed'                          => [
				'user_message'   => __( 'Payouts are disabled. Please contact support.', 'ytism' ),
				'system_message' => __( 'Payouts disabled. Check account status for verification requirements.', 'ytism' ),
			],
			'platform_api_key_expired'                     => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Platform API key expired. Update integration or reconnect account.', 'ytism' ),
			],
			'postal_code_invalid'                          => [
				'user_message'   => __( 'The postal code is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid postal code provided.', 'ytism' ),
			],
			'refer_to_customer'                            => [
				'user_message'   => __( 'Payment stopped by your bank. Please contact your bank to complete this payment.', 'ytism' ),
				'system_message' => __( 'Customer stopped payment with bank.', 'ytism' ),
			],
			'resource_already_exists'                      => [
				'user_message'   => __( 'This item already exists. Please use a different identifier.', 'ytism' ),
				'system_message' => __( 'Resource with user-specified ID already exists.', 'ytism' ),
			],
			'resource_missing'                             => [
				'user_message'   => __( 'The requested information could not be found. Please try again or contact support.', 'ytism' ),
				'system_message' => __( 'Resource does not exist or wrong ID provided.', 'ytism' ),
			],
			'routing_number_invalid'                       => [
				'user_message'   => __( 'The bank routing number is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid bank routing number.', 'ytism' ),
			],
			'stripe_tax_inactive'                          => [
				'user_message'   => __( 'Tax calculation is unavailable. Please contact support.', 'ytism' ),
				'system_message' => __( 'Stripe Tax not activated on account.', 'ytism' ),
			],
			'clearing_code_unsupported'                    => [
				'user_message'   => __( 'This clearing code is not supported. Please contact support.', 'ytism' ),
				'system_message' => __( 'Clearing code not supported.', 'ytism' ),
			],
			'secret_key_required'                          => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Publishable key used instead of secret key.', 'ytism' ),
			],
			'state_unsupported'                            => [
				'user_message'   => __( 'This state is not supported. Please contact support.', 'ytism' ),
				'system_message' => __( 'US state not supported (associated states/territories).', 'ytism' ),
			],
			'tax_id_invalid'                               => [
				'user_message'   => __( 'The tax ID is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Tax ID invalid (missing digits).', 'ytism' ),
			],
			'tax_id_prohibited'                            => [
				'user_message'   => __( 'Tax ID is not required for this payment method.', 'ytism' ),
				'system_message' => __( 'Tax identifier not required for this payment method.', 'ytism' ),
			],
			'terminal_location_country_unsupported'        => [
				'user_message'   => __( 'Terminal not available in your country. Please contact support.', 'ytism' ),
				'system_message' => __( 'Terminal not available in this country.', 'ytism' ),
			],
			'terminal_reader_offline'                      => [
				'user_message'   => __( 'Card reader is offline. Please ensure it is powered on and connected.', 'ytism' ),
				'system_message' => __( 'Reader offline. Check power and internet connection.', 'ytism' ),
			],
			'terminal_reader_timeout'                      => [
				'user_message'   => __( 'Card reader timed out. Please try again.', 'ytism' ),
				'system_message' => __( 'Timeout sending command to reader.', 'ytism' ),
			],
			'terminal_reader_busy'                         => [
				'user_message'   => __( 'Card reader is busy. Please wait and try again.', 'ytism' ),
				'system_message' => __( 'Reader busy processing another request.', 'ytism' ),
			],
			'terminal_reader_hardware_fault'               => [
				'user_message'   => __( 'Card reader has a hardware fault. Please contact support for replacement.', 'ytism' ),
				'system_message' => __( 'Unrecoverable hardware fault detected. Contact Stripe support for replacement.', 'ytism' ),
			],
			'terminal_reader_invalid_location_for_activation' => [
				'user_message'   => __( 'Card reader cannot be activated at this location. Please contact support.', 'ytism' ),
				'system_message' => __( 'Reader cannot be activated in current Location. Register to new Location.', 'ytism' ),
			],
			'terminal_reader_invalid_location_for_payment' => [
				'user_message'   => __( 'Card reader cannot accept payments at this location. Please contact support.', 'ytism' ),
				'system_message' => __( 'Reader cannot take payments in current Location. Register to new Location.', 'ytism' ),
			],
			'tls_version_unsupported'                      => [
				'user_message'   => __( 'Your connection is not secure. Please update your browser or contact support.', 'ytism' ),
				'system_message' => __( 'TLS version unsupported. Must use TLS 1.2 or above.', 'ytism' ),
			],
			'token_already_used'                           => [
				'user_message'   => __( 'This payment information has already been used. Please try again.', 'ytism' ),
				'system_message' => __( 'Token already used. Create new token.', 'ytism' ),
			],
			'token_in_use'                                 => [
				'user_message'   => __( 'This payment is being processed. Please wait a moment.', 'ytism' ),
				'system_message' => __( 'Token in use. Duplicate request detected.', 'ytism' ),
			],
			'transfers_not_allowed'                        => [
				'user_message'   => __( 'Transfer cannot be completed. Please contact support.', 'ytism' ),
				'system_message' => __( 'Transfer cannot be created.', 'ytism' ),
			],
			'transfer_source_balance_parameters_mismatch'  => [
				'user_message'   => __( 'Transfer configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Do not pass payments parameter when balance type is issuing.', 'ytism' ),
			],
			'url_invalid'                                  => [
				'user_message'   => __( 'The URL provided is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid URL provided.', 'ytism' ),
			],
			'not_allowed_on_standard_account'              => [
				'user_message'   => __( 'This operation is not allowed. Please contact support.', 'ytism' ),
				'system_message' => __( 'Transfers/payouts on behalf of Standard account not allowed.', 'ytism' ),
			],
			'lock_timeout'                                 => [
				'user_message'   => __( 'This resource is temporarily locked. Please try again in a moment.', 'ytism' ),
				'system_message' => __( 'Object locked by another request. Retry or reduce concurrent requests.', 'ytism' ),
			],
			'cardholder_phone_number_required'             => [
				'user_message'   => __( 'Phone number is required. Please provide a phone number.', 'ytism' ),
				'system_message' => __( 'Phone number required for EU Issuing Cardholders.', 'ytism' ),
			],
			'return_intent_already_processed'              => [
				'user_message'   => __( 'This refund has already been processed.', 'ytism' ),
				'system_message' => __( 'Return intent already processed.', 'ytism' ),
			],
			'refund_disputed_payment'                      => [
				'user_message'   => __( 'Cannot refund a disputed payment. Please contact support.', 'ytism' ),
				'system_message' => __( 'Cannot refund disputed payment.', 'ytism' ),
			],
			'progressive_onboarding_limit_exceeded'        => [
				'user_message'   => __( 'Onboarding limit reached. Please contact support.', 'ytism' ),
				'system_message' => __( 'Progressive onboarding limit exceeded for platform.', 'ytism' ),
			],
			'forwarding_api_inactive'                      => [
				'user_message'   => __( 'This service is unavailable. Please contact support.', 'ytism' ),
				'system_message' => __( 'Vault and Forward API not accessible.', 'ytism' ),
			],
			'forwarding_api_invalid_parameter'             => [
				'user_message'   => __( 'Invalid configuration. Please contact support.', 'ytism' ),
				'system_message' => __( 'Invalid parameter in Vault and Forward API.', 'ytism' ),
			],
			'forwarding_api_upstream_connection_timeout'   => [
				'user_message'   => __( 'Connection timed out. Please try again.', 'ytism' ),
				'system_message' => __( 'Destination endpoint timed out.', 'ytism' ),
			],
			'forwarding_api_upstream_connection_error'     => [
				'user_message'   => __( 'Connection error occurred. Please try again.', 'ytism' ),
				'system_message' => __( 'No response from destination endpoint.', 'ytism' ),
			],
			'forwarding_api_retryable_upstream_error'      => [
				'user_message'   => __( 'Service temporarily unavailable. Please try again later.', 'ytism' ),
				'system_message' => __( 'Destination endpoint offline/unresponsive. Retry later.', 'ytism' ),
			],
			'forwarding_api_upstream_error'                => [
				'user_message'   => __( 'Service error occurred. Please contact support.', 'ytism' ),
				'system_message' => __( 'Destination endpoint offline/unresponsive. State may be indeterminate.', 'ytism' ),
			],
			'alipay_upgrade_required'                      => [
				'user_message'   => __( 'This payment method is no longer supported. Please use a different method.', 'ytism' ),
				'system_message' => __( 'Old Alipay method not supported. Upgrade to Sources.', 'ytism' ),
			],
			'bitcoin_upgrade_required'                     => [
				'user_message'   => __( 'This payment method is no longer supported. Please use a different method.', 'ytism' ),
				'system_message' => __( 'Old Bitcoin method not supported. Upgrade to Sources.', 'ytism' ),
			],
			'card_declined'                                => [
				'user_message'   => __( 'Your card was declined. Please try a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Card declined. Check decline_code for reason.', 'ytism' ),
			],
			'charge_expired_for_capture'                   => [
				'user_message'   => __( 'The payment authorization has expired. Please try again.', 'ytism' ),
				'system_message' => __( 'Charge authorization expired. Must capture within set timeframe (7 days default).', 'ytism' ),
			],
			'expired_card'                                 => [
				'user_message'   => __( 'Your card has expired. Please use a different card.', 'ytism' ),
				'system_message' => __( 'Card has expired.', 'ytism' ),
			],
			'incorrect_address'                            => [
				'user_message'   => __( 'The card address is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card address is incorrect.', 'ytism' ),
			],
			'incorrect_cvc'                                => [
				'user_message'   => __( 'The security code is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card security code incorrect.', 'ytism' ),
			],
			'incorrect_number'                             => [
				'user_message'   => __( 'The card number is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card number incorrect.', 'ytism' ),
			],
			'incorrect_zip'                                => [
				'user_message'   => __( 'The postal code is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card postal code incorrect.', 'ytism' ),
			],
			'invalid_tax_location'                         => [
				'user_message'   => __( 'The location is invalid for tax calculation. Please check your address.', 'ytism' ),
				'system_message' => __( 'Invalid location for tax calculation.', 'ytism' ),
			],
			'invalid_charge_amount'                        => [
				'user_message'   => __( 'The payment amount is invalid. Please contact support.', 'ytism' ),
				'system_message' => __( 'Amount invalid or exceeds minimum/maximum limits.', 'ytism' ),
			],
			'invalid_cvc'                                  => [
				'user_message'   => __( 'The security code is invalid. Please check your card and try again.', 'ytism' ),
				'system_message' => __( 'Card security code invalid.', 'ytism' ),
			],
			'invalid_expiry_month'                         => [
				'user_message'   => __( 'The expiration month is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card expiration month incorrect.', 'ytism' ),
			],
			'invalid_expiry_year'                          => [
				'user_message'   => __( 'The expiration year is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card expiration year incorrect.', 'ytism' ),
			],
			'invalid_number'                               => [
				'user_message'   => __( 'The card number is invalid. Please check the card details.', 'ytism' ),
				'system_message' => __( 'Card number is invalid.', 'ytism' ),
			],
			'invalid_source_usage'                         => [
				'user_message'   => __( 'This payment method cannot be used. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Source in incorrect state (pending/failed/consumed).', 'ytism' ),
			],
			'livemode_mismatch'                            => [
				'user_message'   => __( 'Payment configuration error. Please contact support.', 'ytism' ),
				'system_message' => __( 'Test/Live mode mismatch.', 'ytism' ),
			],
			'missing'                                      => [
				'user_message'   => __( 'Payment information is incomplete. Please try again.', 'ytism' ),
				'system_message' => __( 'Source not saved to customer.', 'ytism' ),
			],
			'processing_error'                             => [
				'user_message'   => __( 'An error occurred while processing your payment. Please try again.', 'ytism' ),
				'system_message' => __( 'Error processing card.', 'ytism' ),
			],
			'product_inactive'                             => [
				'user_message'   => __( 'This product is no longer available. Please contact support.', 'ytism' ),
				'system_message' => __( 'Product SKU no longer available.', 'ytism' ),
			],
			'rate_limit'                                   => [
				'user_message'   => __( 'Too many requests. Please wait a moment and try again.', 'ytism' ),
				'system_message' => __( 'API rate limit exceeded. Implement exponential backoff.', 'ytism' ),
			],
			'sepa_unsupported_account'                     => [
				'user_message'   => __( 'SEPA payments are not supported. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Account does not support SEPA payments.', 'ytism' ),
			],
			'shipping_calculation_failed'                  => [
				'user_message'   => __( 'Shipping calculation failed. Please verify your address information.', 'ytism' ),
				'system_message' => __( 'Shipping calculation failed. Info incorrect or could not be verified.', 'ytism' ),
			],
			'sku_inactive'                                 => [
				'user_message'   => __( 'This item is no longer available. Please contact support.', 'ytism' ),
				'system_message' => __( 'SKU inactive. Use different SKU or reactivate.', 'ytism' ),
			],
			'taxes_calculation_failed'                     => [
				'user_message'   => __( 'Tax calculation failed. Please contact support.', 'ytism' ),
				'system_message' => __( 'Tax calculation for order failed.', 'ytism' ),
			],
			'testmode_charges_only'                        => [
				'user_message'   => __( 'Payment processing is temporarily unavailable. Please contact support.', 'ytism' ),
				'system_message' => __( 'Account not activated. Test mode only.', 'ytism' ),
			],
		];

		if ( isset( $messages[ $code ] ) ) {
			return $messages[ $code ];
		}

		return [
			'user_message'   => __( 'Your payment could not be processed. Please try a different payment method or contact support.', 'ytism' ),
			'system_message' => __( 'Payment failed with unhandled error code.', 'ytism' ),
		];
	}

	/**
	 * Get messages based on decline code
	 *
	 * @param string $decline_code Decline code
	 * @return array|null
	 */
	private static function get_decline_code_messages( $decline_code ) {
		$messages = [
			'authentication_required'           => [
				'user_message'   => __( 'Your card requires additional authentication. Please complete the verification and try again.', 'ytism' ),
				'system_message' => __( 'Transaction requires 3D Secure or similar authentication.', 'ytism' ),
			],
			'approve_with_id'                   => [
				'user_message'   => __( 'Your payment could not be authorized. Please try again or contact your bank.', 'ytism' ),
				'system_message' => __( 'Issuer requires authorization approval.', 'ytism' ),
			],
			'call_issuer'                       => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'Customer must contact card issuer.', 'ytism' ),
			],
			'card_not_supported'                => [
				'user_message'   => __( 'This card does not support this type of purchase. Please use a different card.', 'ytism' ),
				'system_message' => __( 'Card type not supported for this transaction.', 'ytism' ),
			],
			'card_velocity_exceeded'            => [
				'user_message'   => __( 'You have exceeded your card limit. Please use a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Card velocity or transaction limit exceeded.', 'ytism' ),
			],
			'currency_not_supported'            => [
				'user_message'   => __( 'Your card does not support this currency. Please use a different card.', 'ytism' ),
				'system_message' => __( 'Card does not support the transaction currency.', 'ytism' ),
			],
			'do_not_honor'                      => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'Issuer declined without specific reason.', 'ytism' ),
			],
			'do_not_try_again'                  => [
				'user_message'   => __( 'Your card was declined. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Permanent decline - do not retry.', 'ytism' ),
			],
			'duplicate_transaction'             => [
				'user_message'   => __( 'This transaction appears to be a duplicate. Please check your recent payments.', 'ytism' ),
				'system_message' => __( 'Identical transaction submitted recently.', 'ytism' ),
			],
			'expired_card'                      => [
				'user_message'   => __( 'Your card has expired. Please use a different card.', 'ytism' ),
				'system_message' => __( 'Card expiration date has passed.', 'ytism' ),
			],
			'fraudulent'                        => [
				'user_message'   => __( 'Your payment could not be processed. Please try a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Payment blocked due to suspected fraud (Stripe Radar).', 'ytism' ),
			],
			'generic_decline'                   => [
				'user_message'   => __( 'Your card was declined. Please try a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Generic decline or blocked by Stripe Radar/Adaptive Acceptance.', 'ytism' ),
			],
			'incorrect_number'                  => [
				'user_message'   => __( 'The card number you entered is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Invalid card number entered.', 'ytism' ),
			],
			'incorrect_cvc'                     => [
				'user_message'   => __( 'The security code (CVC) you entered is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Incorrect CVC provided.', 'ytism' ),
			],
			'incorrect_pin'                     => [
				'user_message'   => __( 'The PIN you entered is incorrect. Please try again.', 'ytism' ),
				'system_message' => __( 'Incorrect PIN entered on card reader.', 'ytism' ),
			],
			'incorrect_zip'                     => [
				'user_message'   => __( 'The postal code you entered is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Incorrect ZIP/postal code.', 'ytism' ),
			],
			'incorrect_address'                 => [
				'user_message'   => __( 'The billing address you entered is incorrect. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Billing address does not match.', 'ytism' ),
			],
			'insufficient_funds'                => [
				'user_message'   => __( 'Your card has insufficient funds. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Insufficient funds in card account.', 'ytism' ),
			],
			'invalid_account'                   => [
				'user_message'   => __( 'Your card or account is invalid. Please contact your bank or use a different card.', 'ytism' ),
				'system_message' => __( 'Card or linked account is invalid.', 'ytism' ),
			],
			'invalid_amount'                    => [
				'user_message'   => __( 'The payment amount is invalid. Please contact support or try a different amount.', 'ytism' ),
				'system_message' => __( 'Payment amount invalid or exceeds limits.', 'ytism' ),
			],
			'invalid_cvc'                       => [
				'user_message'   => __( 'The security code (CVC) you entered is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'CVC format is invalid.', 'ytism' ),
			],
			'invalid_expiry_month'              => [
				'user_message'   => __( 'The expiration month you entered is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card expiration month is invalid.', 'ytism' ),
			],
			'invalid_expiry_year'               => [
				'user_message'   => __( 'The expiration year you entered is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card expiration year is invalid.', 'ytism' ),
			],
			'invalid_number'                    => [
				'user_message'   => __( 'The card number you entered is invalid. Please check and try again.', 'ytism' ),
				'system_message' => __( 'Card number format is invalid.', 'ytism' ),
			],
			'invalid_pin'                       => [
				'user_message'   => __( 'The PIN you entered is invalid. Please try again.', 'ytism' ),
				'system_message' => __( 'PIN format is invalid.', 'ytism' ),
			],
			'issuer_not_available'              => [
				'user_message'   => __( 'Your bank could not be reached. Please try again or use a different payment method.', 'ytism' ),
				'system_message' => __( 'Card issuer unavailable - temporary issue.', 'ytism' ),
			],
			'lost_card'                         => [
				'user_message'   => __( 'Your payment could not be processed. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Card reported as lost.', 'ytism' ),
			],
			'merchant_blacklist'                => [
				'user_message'   => __( 'Your payment could not be processed. Please try a different payment method.', 'ytism' ),
				'system_message' => __( 'Payment blocked by merchant block list.', 'ytism' ),
			],
			'new_account_information_available' => [
				'user_message'   => __( 'Your card or account information needs updating. Please contact your bank.', 'ytism' ),
				'system_message' => __( 'New account information available from issuer.', 'ytism' ),
			],
			'no_action_taken'                   => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'No action taken by issuer.', 'ytism' ),
			],
			'not_permitted'                     => [
				'user_message'   => __( 'This transaction is not permitted. Please contact your bank or use a different card.', 'ytism' ),
				'system_message' => __( 'Transaction not permitted by issuer.', 'ytism' ),
			],
			'offline_pin_required'              => [
				'user_message'   => __( 'Your card requires a PIN. Please insert your card and enter your PIN.', 'ytism' ),
				'system_message' => __( 'Offline PIN required for this transaction.', 'ytism' ),
			],
			'online_or_offline_pin_required'    => [
				'user_message'   => __( 'Your card requires a PIN. Please enter your PIN to complete the payment.', 'ytism' ),
				'system_message' => __( 'Online or offline PIN required.', 'ytism' ),
			],
			'pickup_card'                       => [
				'user_message'   => __( 'Your card cannot be used. Please use a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Card flagged for pickup (possibly lost/stolen).', 'ytism' ),
			],
			'pin_try_exceeded'                  => [
				'user_message'   => __( 'You have exceeded the number of PIN attempts. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Maximum PIN attempts exceeded.', 'ytism' ),
			],
			'processing_error'                  => [
				'user_message'   => __( 'An error occurred while processing your payment. Please try again.', 'ytism' ),
				'system_message' => __( 'Payment processing error - retry recommended.', 'ytism' ),
			],
			'reenter_transaction'               => [
				'user_message'   => __( 'Your payment could not be processed. Please try again.', 'ytism' ),
				'system_message' => __( 'Transaction needs to be re-entered.', 'ytism' ),
			],
			'restricted_card'                   => [
				'user_message'   => __( 'Your card is restricted. Please use a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Card has restrictions preventing this transaction.', 'ytism' ),
			],
			'revocation_of_all_authorizations'  => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'All authorizations revoked by issuer.', 'ytism' ),
			],
			'revocation_of_authorization'       => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'Authorization revoked by issuer.', 'ytism' ),
			],
			'security_violation'                => [
				'user_message'   => __( 'Your payment could not be processed due to security reasons. Please contact your bank.', 'ytism' ),
				'system_message' => __( 'Security violation detected by issuer.', 'ytism' ),
			],
			'service_not_allowed'               => [
				'user_message'   => __( 'This service is not allowed. Please use a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Service not allowed for this card.', 'ytism' ),
			],
			'stolen_card'                       => [
				'user_message'   => __( 'Your payment could not be processed. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Card reported as stolen.', 'ytism' ),
			],
			'stop_payment_order'                => [
				'user_message'   => __( 'Your card was declined. Please contact your bank for more information.', 'ytism' ),
				'system_message' => __( 'Stop payment order placed on card.', 'ytism' ),
			],
			'testmode_decline'                  => [
				'user_message'   => __( 'Test card was used. Please use a valid card for payment.', 'ytism' ),
				'system_message' => __( 'Stripe test card number used in live mode.', 'ytism' ),
			],
			'transaction_not_allowed'           => [
				'user_message'   => __( 'This transaction is not allowed. Please contact your bank or use a different card.', 'ytism' ),
				'system_message' => __( 'Transaction type not allowed for this card.', 'ytism' ),
			],
			'try_again_later'                   => [
				'user_message'   => __( 'Your payment could not be processed. Please try again later or use a different payment method.', 'ytism' ),
				'system_message' => __( 'Temporary issue - customer should retry later.', 'ytism' ),
			],
			'withdrawal_count_limit_exceeded'   => [
				'user_message'   => __( 'You have exceeded your card limit. Please use a different payment method.', 'ytism' ),
				'system_message' => __( 'Withdrawal or transaction count limit exceeded.', 'ytism' ),
			],
			'partner_generic_decline'           => [
				'user_message'   => __( 'Your payment provider has declined the payment.', 'ytism' ),
				'system_message' => __( 'Generic decline from partner processor.', 'ytism' ),
			],
			'invalid_customer_account'          => [
				'user_message'   => __( 'We can\'t charge the customer\'s account. Please try again or use a different payment method.', 'ytism' ),
				'system_message' => __( 'Customer account is invalid at partner processor.', 'ytism' ),
			],
			'payment_limit_exceeded'            => [
				'user_message'   => __( 'You have exceeded your payment limit. Please use a different payment method or contact your bank.', 'ytism' ),
				'system_message' => __( 'Payment amount exceeds partner processor limit.', 'ytism' ),
			],
			'invalid_billing_agreement'         => [
				'user_message'   => __( 'Your payment method is invalid due to an invalid billing agreement.', 'ytism' ),
				'system_message' => __( 'Billing agreement is invalid at partner processor.', 'ytism' ),
			],
			'compliance_violation'              => [
				'user_message'   => __( 'Your payment could not be processed due to compliance reasons. Please contact your bank.', 'ytism' ),
				'system_message' => __( 'The payment was blocked due to a compliance violation at the payment provider.', 'ytism' ),
			],
			'payment_disputed'                  => [
				'user_message'   => __( 'The payment was disputed. Please contact support for assistance.', 'ytism' ),
				'system_message' => __( 'The payment was disputed at the payment provider.', 'ytism' ),
			],
			'invalid_authorisation'             => [
				'user_message'   => __( 'Your payment could not be processed due to invalid authorization. Please try again or use a different payment method.', 'ytism' ),
				'system_message' => __( 'The authorization is invalid at the payment provider.', 'ytism' ),
			],
			'invalid_payment_information'       => [
				'user_message'   => __( 'Your payment could not be processed due to invalid payment information. Please check your details and try again.', 'ytism' ),
				'system_message' => __( 'The payment information is invalid at the payment provider.', 'ytism' ),
			],
			'partner_payment_not_found'         => [
				'user_message'   => __( 'We couldn\'t find the payment information. Please try again or use a different payment method.', 'ytism' ),
				'system_message' => __( 'The payment was not found at the partner processor.', 'ytism' ),
			],
			'expired_payment_information'       => [
				'user_message'   => __( 'Your payment information has expired. Please update your details and try again.', 'ytism' ),
				'system_message' => __( 'The payment information has expired at the payment provider.', 'ytism' ),
			],
			'partner_high_risk_customer'        => [
				'user_message'   => __( 'Your payment provider labelled this customer as high risk.', 'ytism' ),
				'system_message' => __( 'The payment provider labelled this customer as high risk.', 'ytism' ),
			],
			'invalid_business_account'          => [
				'user_message'   => __( 'The business account you\'re trying to use for processing a payment or issuing a refund is deactivated and incapable of sending or receiving funds.', 'ytism' ),
				'system_message' => __( 'The business account is invalid at the payment provider.', 'ytism' ),
			],
		];

		return isset( $messages[ $decline_code ] ) ? $messages[ $decline_code ] : null;
	}

	/**
	 * Format error for logging or display
	 *
	 * @param object $error Stripe error object
	 * @return string Formatted error string
	 */
	public static function format_error_for_log( $error ) {
		$parts = [];

		if ( isset( $error->type ) ) {
			$parts[] = 'Type: ' . $error->type;
		}

		// Add payment method type if available
		$payment_method_type = self::get_payment_method_type( $error );
		if ( $payment_method_type ) {
			$parts[] = 'Payment Method: ' . $payment_method_type;
		}

		if ( isset( $error->code ) ) {
			$parts[] = 'Code: ' . $error->code;
		}
		if ( isset( $error->decline_code ) ) {
			$parts[] = 'Decline: ' . $error->decline_code;
		}
		if ( isset( $error->message ) ) {
			$parts[] = 'Message: ' . $error->message;
		}
		if ( isset( $error->param ) ) {
			$parts[] = 'Param: ' . $error->param;
		}

		return implode( ' | ', $parts );
	}
}
