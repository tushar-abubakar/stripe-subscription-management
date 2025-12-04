<?php

namespace YTISM\Database;
use YTISM\Helpers\Functions;
use WP_Error;

if (!defined("ABSPATH")) {
    exit;
}

class Payment extends Base {

    protected function get_table_name() {
        return $this->wpdb->prefix . "ytism_payments";
    }

    protected function get_default_fields() {
        return [
            "subscription_id" => 0,
            "status" => "initiated",
            "gateway_status" => null,
            "amount" => 0.00,
            "currency" => "USD",
            "payment_type" => "subscription",
            "transaction_id" => null,
            "charge_id" => null,
            "payment_method_id" => null,
            "retry_count" => 0,
            "failure_code" => null,
            "failure_message" => null,
            "processed_at" => null,
            "period_start" => null,
            "period_end" => null,
            "gateway_response" => null,
            "metadata" => null
        ];
    }

    /**
     * Create payment with automatic event logging
     */
    public function create_payment($data) {
        $payment_id = $this->create($data);

        if (is_wp_error($payment_id)) {
            return $payment_id;
        }

        // Only log if it's the initial payment (not renewal or webhook-created)
        $should_log = !isset($data['payment_type']) || $data['payment_type'] === 'subscription';
        
        if ($should_log && empty($data['skip_event_log'])) {
            $events = new Event();
            $events->log_payment_initiated(
                $payment_id,
                $data["subscription_id"] ?? 0,
                Functions::format_price($data["amount"] ?? 0.0, $data["currency"] ?? "USD"),
                $this->get_gateway_from_subscription($data["subscription_id"] ?? 0)
            );
        }

        return $payment_id;
    }

    /**
     * Update payment status with automatic logging
     */
    public function update_status($payment_id, $new_status, $options = []) {
        $payment = $this->get($payment_id);
        if (!$payment) {
            return new WP_Error("payment_not_found", __("Payment not found", "ytism"));
        }

        $old_status = $payment->status;
        
        // Don't update if status is the same
        if ($old_status === $new_status) {
            return true; // Status already set, no hooks needed
        }

        // Prepare update data
        $update_data = [
            "status" => $new_status,
            "processed_at" => current_time("mysql")
        ];

        if (!empty($options["transaction_id"])) {
            $update_data["charge_id"] = $options["transaction_id"];
        }

        if (!empty($options["payment_method_id"])) {
            $update_data["payment_method_id"] = $options["payment_method_id"];
        }

        if (!empty($options["failure_code"])) {
            $update_data["failure_code"] = $options["failure_code"];
        }

        if (!empty($options["failure_message"])) {
            $update_data["failure_message"] = $options["failure_message"];
        }

        if (!empty($options["gateway_response"])) {
            $update_data["gateway_response"] = json_encode($options["gateway_response"]);
        }

        // Update payment
        $result = $this->update($payment_id, $update_data);

        if (is_wp_error($result)) {
            return $result;
        }

        // Get fresh payment data
        $updated_payment = $this->get($payment_id);
        
        // Get subscription object
        $subscription = null;
        if ($updated_payment->subscription_id) {
            $subscriptions = new Subscription();
            $subscription = $subscriptions->get($updated_payment->subscription_id);
        }

        // Only log if explicitly requested
        if (!empty($options['log_event']) && $options['log_event'] === true) {
            $events = new Event();
            $gateway = $this->get_gateway_from_subscription($updated_payment->subscription_id);

            switch ($new_status) {
                case "succeeded":
                    $events->log_payment_succeeded(
                        $payment_id,
                        $updated_payment->subscription_id,
                        Functions::format_stripe_price($updated_payment->amount, $updated_payment->currency),
                        $options["transaction_id"] ?? "",
                        $gateway,
                        $options["gateway_event_id"] ?? null
                    );

                    if ($subscription) {
                        $subscriptions = new Subscription();
                        $subscriptions->reset_failed_payments($updated_payment->subscription_id);
                    }
                    break;

                case "failed":
                    /*$events->log_payment_failed(
                        $payment_id,
                        $updated_payment->subscription_id,
                        Functions::format_stripe_price($updated_payment->amount, $updated_payment->currency),
                        $options["failure_message"] ?? __("Payment failed", "ytism"),
                        $updated_payment->retry_count,
                        $gateway,
                        $options["gateway_event_id"] ?? null
                    );*/

                    if ($subscription) {
                        $subscriptions = new Subscription();
                        $subscriptions->increment_failed_payments($updated_payment->subscription_id);
                    }
                    break;
            }
        }

        // Fire hooks - status changed, so fire once
        do_action('ytism_payment_status_changed', $updated_payment, $old_status, $new_status);
        
        // Fire specific status hooks
        if ($new_status === 'succeeded') {
            do_action('ytism_payment_succeeded', $updated_payment, $subscription);
        } elseif ($new_status === 'failed') {
            do_action('ytism_payment_failed', $updated_payment, $subscription, $options["failure_message"] ?? '');
        }
        
        // Fire transition hook
        do_action("ytism_payment_{$old_status}_to_{$new_status}", $updated_payment, $subscription);

        return $result;
    }

    /**
     * Get payments by subscription
     */
    public function get_by_subscription($subscription_id, $status = "") {
        $where = $this->wpdb->prepare("subscription_id = %d", $subscription_id);

        if (!empty($status)) {
            $where .= $this->wpdb->prepare(" AND status = %s", $status);
        }

        return $this->get_records(["where" => $where]);
    }

    /**
     * Get payments by status
     */
    public function get_by_status($status, $limit = 100) {
        $where = $this->wpdb->prepare("status = %s", $status);
        return $this->get_records([
            "where" => $where,
            "limit" => $limit
        ]);
    }

    /**
     * Get failed payments for retry
     */
    public function get_failed_for_retry($max_retries = 3) {
        $where = $this->wpdb->prepare(
            "status = 'failed' AND retry_count < %d",
            $max_retries
        );

        return $this->get_records(["where" => $where]);
    }

    /**
     * Increment retry count
     */
    public function increment_retry($payment_id) {
        $result = $this->wpdb->query(
            $this->wpdb->prepare(
                "UPDATE {$this->table_name} SET retry_count = retry_count + 1 WHERE ID = %d",
                $payment_id
            )
        );

        if ($result) {
            $payment = $this->get($payment_id);
            $events = new Event();
            $events->log_payment_retry(
                $payment_id,
                $payment->subscription_id,
                $payment->retry_count + 1,
                $this->get_gateway_from_subscription($payment->subscription_id)
            );
        }

        return $result;
    }

    /**
     * Get gateway from subscription
     */
    private function get_gateway_from_subscription($subscription_id) {
        $subscription = $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT payment_gateway FROM {$this->wpdb->prefix}ytism_subscriptions WHERE ID = %d",
                $subscription_id
            )
        );

        return $subscription ? $subscription->payment_gateway : "";
    }

    /**
     * Get payment by transaction ID
     */
    public function get_by_transaction_id($transaction_id) {
        return $this->get_by("transaction_id", $transaction_id, "%s");
    }

    /**
     * Get payment with subscription details
     */
    public function get_with_subscription($payment_id) {
        $sql = $this->wpdb->prepare(
            "SELECT p.*, s.gateway_subscription_id, s.metadata as sub_metadata, s.user_id
            FROM {$this->table_name} p
            LEFT JOIN {$this->wpdb->prefix}ytism_subscriptions s ON p.subscription_id = s.ID
            WHERE p.ID = %d",
            $payment_id
        );
        return $this->wpdb->get_row($sql);
    }

    /**
     * Get payment by transaction ID with subscription
     */
    public function get_by_transaction_with_subscription($transaction_id) {
        $sql = $this->wpdb->prepare(
            "SELECT p.*, s.gateway_subscription_id, s.metadata as sub_metadata, s.user_id
            FROM {$this->table_name} p
            LEFT JOIN {$this->wpdb->prefix}ytism_subscriptions s ON p.subscription_id = s.ID
            WHERE p.transaction_id = %s",
            $transaction_id
        );
        return $this->wpdb->get_row($sql);
    }
}