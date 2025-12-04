<?php

namespace YTISM\Database;
use YTISM\Helpers\Functions;
use WP_Error;

if (!defined("ABSPATH")) {
    exit;
}

class Subscription extends Base {

    protected function get_table_name() {
        return $this->wpdb->prefix . "ytism_subscriptions";
    }

    protected function get_default_fields() {
        return [
            "user_id" => 0,
            "gateway_subscription_id" => null,
            "price_id" => null,
            "payment_gateway" => "",
            "status" => "pending",
            "gateway_status" => null,
            "trial_start" => null,
            "trial_end" => null,
            "current_period_start" => current_time("mysql"),
            "current_period_end" => date("Y-m-d H:i:s", strtotime("+1 month")),
            "canceled_at" => null,
            "amount" => 0.00,
            "quantity" => 1,
            "currency" => "USD",
            "billing_period" => "month",
            "billing_interval" => 1,
            "failed_payment_count" => 0,
            "cancel_at_period_end" => 0,
            "cancellation_reason" => null,
            "first_activated_at" => null,
            "last_renewed_at" => null,
            "last_status_change" => null,
            "previous_status" => null,
            "metadata" => null
        ];
    }

    /**
     * Create subscription with automatic event logging
     */
    public function create_subscription($data) {
        $subscription_id = $this->create($data);

        if (is_wp_error($subscription_id)) {
            return $subscription_id;
        }

        // Log subscription creation event
        $events = new Event();
        $events->log_subscription_created(
            $subscription_id,
            $data["user_id"] ?? 0,
            $data["payment_gateway"] ?? "",
            Functions::format_price($data["amount"] ?? 0, $data["currency"] ?? "USD")
        );

        return $subscription_id;
    }

    /**
     * Update subscription status with automatic logging
     */
    public function update_status($subscription_id, $new_status, $reason = "") {
        $subscription = $this->get($subscription_id);
        if (!$subscription) {
            return new WP_Error("subscription_not_found", __("Subscription not found", "ytism"));
        }

        $old_status = $subscription->status;
        
        // Don't update if status is the same
        if ($old_status === $new_status) {
            return true; // Status already set, no hooks needed
        }

        // Update subscription
        $update_data = [
            "status" => $new_status,
            "previous_status" => $old_status,
            "last_status_change" => current_time("mysql")
        ];

        if ($new_status === "canceled") {
            $update_data["canceled_at"] = current_time("mysql");
            if ($reason) {
                $update_data["cancellation_reason"] = $reason;
            }
        }

        if ($new_status === "active" && !$subscription->first_activated_at) {
            $update_data["first_activated_at"] = current_time("mysql");
        }

        $result = $this->update($subscription_id, $update_data);

        if (is_wp_error($result)) {
            return $result;
        }

        // Get fresh subscription data after update
        $updated_subscription = $this->get($subscription_id);

        // Log status change event
        $events = new Event();
        
        if (!empty($reason)) {
            $message = $reason;
        } else {
            $message = sprintf(
                __("Subscription status changed from %s to %s", "ytism"),
                $old_status,
                $new_status
            );
        }
        
        $events->create([
            "event_type" => "subscription",
            "subscription_id" => $subscription_id,
            "event_code" => "subscription.status_changed",
            "status" => ($new_status === "canceled" || $new_status === "expired" || $new_status === "unpaid") ? "warning" : "info",
            "message" => $message,
            "old_status" => $old_status,
            "new_status" => $new_status,
            "failure_reason" => !empty($reason) ? $reason : null
        ]);

        // Fire hooks - status changed, so fire once
        do_action('ytism_subscription_status_changed', $updated_subscription, $old_status, $new_status, $reason);
        
        // Fire specific status hooks
        do_action("ytism_subscription_status_{$new_status}", $updated_subscription, $old_status, $reason);
        
        // Fire transition hook
        do_action("ytism_subscription_{$old_status}_to_{$new_status}", $updated_subscription, $reason);

        return $result;
    }

    /**
     * Get subscriptions by user
     */
    public function get_by_user($user_id, $status = "") {
        $where = $this->wpdb->prepare("user_id = %d", $user_id);

        if (!empty($status)) {
            $where .= $this->wpdb->prepare(" AND status = %s", $status);
        }

        return $this->get_records(["where" => $where]);
    }

    /**
     * Get subscriptions by gateway
     */
    public function get_by_gateway($gateway, $gateway_id = "") {
        $where = $this->wpdb->prepare("payment_gateway = %s", $gateway);

        if (!empty($gateway_id)) {
            $where .= $this->wpdb->prepare(" AND gateway_subscription_id = %s", $gateway_id);
        }

        return $this->get_records(["where" => $where]);
    }

    /**
     * Get expiring subscriptions
     */
    public function get_expiring($days = 7) {
        $date = date("Y-m-d H:i:s", strtotime("+{$days} days"));
        $where = $this->wpdb->prepare(
            "status IN ('active', 'trialing') AND current_period_end <= %s",
            $date
        );

        return $this->get_records(["where" => $where]);
    }

    /**
     * Increment failed payment count
     */
    public function increment_failed_payments($subscription_id) {
        return $this->wpdb->query(
            $this->wpdb->prepare(
                "UPDATE {$this->table_name} SET failed_payment_count = failed_payment_count + 1 WHERE ID = %d",
                $subscription_id
            )
        );
    }

    /**
     * Reset failed payment count
     */
    public function reset_failed_payments($subscription_id) {
        return $this->update($subscription_id, ["failed_payment_count" => 0]);
    }

    /**
     * Get subscription by gateway subscription ID
     */
    public function get_by_gateway_id($gateway_subscription_id) {
        return $this->get_by("gateway_subscription_id", $gateway_subscription_id, "%s");
    }

    /**
     * Get subscription with latest payment details
     */
    public function get_with_latest_payment($subscription_id) {
        $sql = $this->wpdb->prepare(
            "SELECT s.*, p.transaction_id, p.status as payment_status, p.amount as payment_amount
            FROM {$this->table_name} s
            LEFT JOIN {$this->wpdb->prefix}ytism_payments p ON s.ID = p.subscription_id
            WHERE s.ID = %d
            ORDER BY p.created_at DESC
            LIMIT 1",
            $subscription_id
        );
        return $this->wpdb->get_row($sql);
    }

    /**
     * Get truly active subscriptions (status active AND not expired)
     * 
     * @param int $user_id User ID
     * @param array $args Additional query arguments
     * @return array Array of subscription objects
     */
    public function get_truly_active($user_id, $args = []) {
        if (empty($user_id)) {
            return [];
        }

        $where_conditions = [];
        $where_conditions[] = $this->wpdb->prepare("user_id = %d", $user_id);
        $where_conditions[] = "status IN ('active', 'trialing')";
        $where_conditions[] = $this->wpdb->prepare("current_period_end >= %s", current_time('mysql'));

        $defaults = [
            'orderby' => 'created_at',
            'order' => 'DESC',
            'limit' => 0,
            'offset' => 0
        ];
        $args = wp_parse_args($args, $defaults);

        $where = implode(' AND ', $where_conditions);

        return $this->get_records([
            'where' => $where,
            'orderby' => $args['orderby'],
            'order' => $args['order'],
            'limit' => $args['limit'],
            'offset' => $args['offset']
        ]);
    }

    /**
     * Get subscriptions with mismatched status (active but expired)
     * 
     * @param int $user_id User ID (optional, null for all users)
     * @return array Array of subscription objects
     */
    public function get_status_mismatched($user_id = null) {
        $where_conditions = [];
        
        if ($user_id) {
            $where_conditions[] = $this->wpdb->prepare("user_id = %d", $user_id);
        }
        
        $where_conditions[] = "status IN ('active', 'trialing')";
        $where_conditions[] = $this->wpdb->prepare("current_period_end < %s", current_time('mysql'));

        $where = implode(' AND ', $where_conditions);

        return $this->get_records([
            'where' => $where,
            'orderby' => 'current_period_end',
            'order' => 'ASC'
        ]);
    }

    /**
     * Update expired subscriptions to proper status
     * 
     * @param int $user_id User ID (optional, null for all users)
     * @return int Number of subscriptions updated
     */
    public function fix_expired_status($user_id = null) {
        $expired_subs = $this->get_status_mismatched($user_id);
        $updated_count = 0;

        foreach ($expired_subs as $sub) {
            $result = $this->update_status(
                $sub->ID,
                'expired',
                sprintf(
                    __('Subscription expired on %s but status was not updated', 'ytism'),
                    date_i18n(get_option('date_format'), strtotime($sub->current_period_end))
                )
            );

            if (!is_wp_error($result)) {
                $updated_count++;
            }
        }

        return $updated_count;
    }

    /**
     * Get user's active subscription (checking both status AND date)
     * 
     * @param int $user_id User ID
     * @return object|null Subscription object or null
     */
    public function get_user_active_subscription($user_id) {
        $subscriptions = $this->get_truly_active($user_id, [
            'limit' => 1,
            'orderby' => 'created_at',
            'order' => 'DESC'
        ]);

        return !empty($subscriptions) ? $subscriptions[0] : null;
    }

    /**
     * Check if user has truly active subscription (status AND date check)
     * 
     * @param int $user_id User ID
     * @return bool True if user has valid active subscription
     */
    public function user_has_active_subscription($user_id) {
        if (empty($user_id)) {
            return false;
        }

        $where = $this->wpdb->prepare(
            "user_id = %d AND status IN ('active', 'trialing') AND current_period_end >= %s",
            $user_id,
            current_time('mysql')
        );

        return $this->count($where) > 0;
    }

    /**
     * Get subscriptions by user ID with status and date validation
     * 
     * @param int $user_id User ID
     * @param array|string $status Single status or array of statuses
     * @param array $args Additional query arguments
     * @return array Array of subscription objects
     */
    public function get_by_user_with_status($user_id, $status = [], $args = []) {
        if (empty($user_id)) {
            return [];
        }

        // Build WHERE clause
        $where_conditions = [];
        $where_conditions[] = $this->wpdb->prepare("user_id = %d", $user_id);

        // Handle status filter
        if (!empty($status)) {
            if (is_string($status)) {
                $status = [$status];
            }

            if (is_array($status) && count($status) > 0) {
                $sanitized_statuses = array_map('sanitize_text_field', $status);
                $placeholders = implode(',', array_fill(0, count($sanitized_statuses), '%s'));
                $where_conditions[] = $this->wpdb->prepare("status IN ($placeholders)", ...$sanitized_statuses);
                
                // If checking for active/trialing, also validate date
                $active_statuses = array_intersect(['active', 'trialing'], $sanitized_statuses);
                if (!empty($active_statuses) && !isset($args['skip_date_validation'])) {
                    $where_conditions[] = $this->wpdb->prepare("current_period_end >= %s", current_time('mysql'));
                }
            }
        }

        // Parse additional arguments
        $defaults = [
            'orderby' => 'created_at',
            'order' => 'DESC',
            'limit' => 0,
            'offset' => 0,
            'period_end_before' => null,
            'period_end_after' => null,
            'period_start_before' => null,
            'period_start_after' => null,
            'skip_date_validation' => false
        ];
        $args = wp_parse_args($args, $defaults);

        // Add date filters for current_period_end
        if (!empty($args['period_end_before'])) {
            $where_conditions[] = $this->wpdb->prepare(
                "current_period_end <= %s",
                date('Y-m-d H:i:s', is_numeric($args['period_end_before']) ? $args['period_end_before'] : strtotime($args['period_end_before']))
            );
        }

        if (!empty($args['period_end_after'])) {
            $where_conditions[] = $this->wpdb->prepare(
                "current_period_end >= %s",
                date('Y-m-d H:i:s', is_numeric($args['period_end_after']) ? $args['period_end_after'] : strtotime($args['period_end_after']))
            );
        }

        // Add date filters for current_period_start
        if (!empty($args['period_start_before'])) {
            $where_conditions[] = $this->wpdb->prepare(
                "current_period_start <= %s",
                date('Y-m-d H:i:s', is_numeric($args['period_start_before']) ? $args['period_start_before'] : strtotime($args['period_start_before']))
            );
        }

        if (!empty($args['period_start_after'])) {
            $where_conditions[] = $this->wpdb->prepare(
                "current_period_start >= %s",
                date('Y-m-d H:i:s', is_numeric($args['period_start_after']) ? $args['period_start_after'] : strtotime($args['period_start_after']))
            );
        }

        $where = implode(' AND ', $where_conditions);

        return $this->get_records([
            'where' => $where,
            'orderby' => $args['orderby'],
            'order' => $args['order'],
            'limit' => $args['limit'],
            'offset' => $args['offset']
        ]);
    }
}