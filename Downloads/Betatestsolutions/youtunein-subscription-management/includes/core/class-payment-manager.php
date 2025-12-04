<?php
namespace YTISM\Core;

class Payment_Manager {
    private $subscriptions_table;
    private $payments_table;

    public function __construct() {
        global $wpdb;
        $this->subscriptions_table = $wpdb->prefix . 'ytism_subscriptions';
        $this->payments_table = $wpdb->prefix . 'ytism_payments';
    }

    /**
     * Create subscription record
     */
    public function create_subscription($data) {
        global $wpdb;
        
        $defaults = [
            'user_id' => get_current_user_id(),
            'gateway_subscription_id' => '',
            'product_id' => '',
            'price_id' => '',
            'payment_gateway' => 'stripe',
            'status' => 'pending',
            'trial_start' => null,
            'trial_end' => null,
            'current_period_start' => current_time('mysql'),
            'current_period_end' => null,
            'canceled_at' => null,
            'ended_at' => null,
            'paused_at' => null,
            'amount' => 0.00,
            'currency' => 'USD',
            'billing_period' => 'month',
            'billing_interval' => 1,
            'billing_cycle_count' => 0,
            'failed_payment_count' => 0,
            'cancel_at_period_end' => false,
            'cancellation_reason' => null,
            'canceled_by' => null,
            'first_activated_at' => null,
            'last_renewed_at' => null,
            'last_status_change' => current_time('mysql'),
            'previous_status' => null,
            'metadata' => null
        ];

        $subscription_data = wp_parse_args($data, $defaults);
        
        if (is_array($subscription_data['metadata']) || is_object($subscription_data['metadata'])) {
            $subscription_data['metadata'] = wp_json_encode($subscription_data['metadata']);
        }

        $result = $wpdb->insert($this->subscriptions_table, $subscription_data);
        
        if ($result) {
            return $wpdb->insert_id;
        }
        
        return new \WP_Error('subscription_creation_failed', 'Failed to create subscription record');
    }

    /**
     * Update subscription status
     */
    public function update_subscription_status($gateway_subscription_id, $new_status, $additional_data = []) {
        global $wpdb;
        
        // Get current subscription
        $subscription = $this->get_subscription_by_gateway_id($gateway_subscription_id);
        if (!$subscription) {
            return new \WP_Error('subscription_not_found', 'Subscription not found');
        }

        $update_data = array_merge([
            'status' => $new_status,
            'previous_status' => $subscription->status,
            'last_status_change' => current_time('mysql'),
            'updated_at' => current_time('mysql')
        ], $additional_data);

        // Handle specific status changes
        switch ($new_status) {
            case 'active':
                if (!$subscription->first_activated_at) {
                    $update_data['first_activated_at'] = current_time('mysql');
                }
                break;
            case 'canceled':
                $update_data['canceled_at'] = current_time('mysql');
                break;
            case 'ended':
                $update_data['ended_at'] = current_time('mysql');
                break;
            case 'paused':
                $update_data['paused_at'] = current_time('mysql');
                break;
        }

        $result = $wpdb->update(
            $this->subscriptions_table,
            $update_data,
            ['gateway_subscription_id' => $gateway_subscription_id],
            array_fill(0, count($update_data), '%s'),
            ['%s']
        );

        return $result !== false;
    }

    /**
     * Create payment record
     */
    public function create_payment($data) {
        global $wpdb;
        
        $defaults = [
            'subscription_id' => 0,
            'user_id' => get_current_user_id(),
            'status' => 'initiated',
            'amount' => 0.00,
            'currency' => 'USD',
            'payment_type' => 'subscription',
            'payment_gateway' => 'stripe',
            'transaction_id' => '',
            'payment_method_id' => '',
            'failure_code' => null,
            'failure_message' => null,
            'retry_count' => 0,
            'processed_at' => null,
            'next_retry_at' => null,
            'period_start' => null,
            'period_end' => null,
            'gateway_response' => null,
            'notes' => null
        ];

        $payment_data = wp_parse_args($data, $defaults);
        
        if (is_array($payment_data['gateway_response']) || is_object($payment_data['gateway_response'])) {
            $payment_data['gateway_response'] = wp_json_encode($payment_data['gateway_response']);
        }

        $result = $wpdb->insert($this->payments_table, $payment_data);
        
        if ($result) {
            return $wpdb->insert_id;
        }
        
        return new \WP_Error('payment_creation_failed', 'Failed to create payment record');
    }

    /**
     * Update payment status
     */
    public function update_payment_status($transaction_id, $new_status, $additional_data = []) {
        global $wpdb;
        
        $update_data = array_merge([
            'status' => $new_status
        ], $additional_data);

        // Set processed_at for final statuses
        if (in_array($new_status, ['succeeded', 'failed', 'canceled', 'expired', 'refunded'])) {
            $update_data['processed_at'] = current_time('mysql');
        }

        $result = $wpdb->update(
            $this->payments_table,
            $update_data,
            ['transaction_id' => $transaction_id],
            array_fill(0, count($update_data), '%s'),
            ['%s']
        );

        return $result !== false;
    }

    /**
     * Get subscription by gateway ID
     */
    public function get_subscription_by_gateway_id($gateway_subscription_id) {
        global $wpdb;
        
        return $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$this->subscriptions_table} WHERE gateway_subscription_id = %s",
                $gateway_subscription_id
            )
        );
    }

    /**
     * Get payment by transaction ID
     */
    public function get_payment_by_transaction_id($transaction_id) {
        global $wpdb;
        
        return $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$this->payments_table} WHERE transaction_id = %s",
                $transaction_id
            )
        );
    }

    /**
     * Increment failed payment count
     */
    public function increment_failed_payment_count($gateway_subscription_id) {
        global $wpdb;
        
        return $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->subscriptions_table} 
                 SET failed_payment_count = failed_payment_count + 1,
                     updated_at = %s
                 WHERE gateway_subscription_id = %s",
                current_time('mysql'),
                $gateway_subscription_id
            )
        );
    }

    /**
     * Reset failed payment count
     */
    public function reset_failed_payment_count($gateway_subscription_id) {
        global $wpdb;
        
        return $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->subscriptions_table} 
                 SET failed_payment_count = 0,
                     updated_at = %s
                 WHERE gateway_subscription_id = %s",
                current_time('mysql'),
                $gateway_subscription_id
            )
        );
    }
}