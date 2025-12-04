<?php

namespace YTISM\Database;
use YTISM\Helpers\Functions;
use WP_Error;

if (!defined("ABSPATH")) {
    exit;
}

class Event extends Base {

    protected function get_table_name() {
        return $this->wpdb->prefix . "ytism_events";
    }

    protected function get_default_fields() {
        return [
            "event_type" => "system",
            "subscription_id" => null,
            "payment_id" => null,
            "event_code" => "",
            "event_subtype" => null,
            "status" => "info",
            "message" => "",
            "old_status" => null,
            "new_status" => null,
            "failure_reason" => null,
            "retry_number" => null,
            "gateway" => null,
            "gateway_event_id" => null,
            "payload" => null,
            "triggered_by" => get_current_user_id() ?: null,
            "ip_address" => Functions::get_user_ip(),
            "user_agent" => $_SERVER["HTTP_USER_AGENT"] ?? null
        ];
    }

    /**
     * Check if similar event already exists (improved deduplication)
     */
    protected function event_exists($data, $timeframe_minutes = 5) {
        $where_conditions = [];
        $where_values = [];
        
        // Priority 1: Check by gateway_event_id first (webhook events)
        if (!empty($data['gateway_event_id'])) {
            $count = $this->wpdb->get_var($this->wpdb->prepare(
                "SELECT COUNT(*) FROM {$this->table_name} 
                WHERE gateway_event_id = %s 
                AND event_code = %s",
                $data['gateway_event_id'],
                $data['event_code'] ?? ''
            ));
            
            if ($count > 0) {
                return true;
            }
        }
        
        // Priority 2: Special handling for renewal-related events
        $renewal_events = ['payment.renewal_failed', 'subscription.renewal_failed', 'subscription.renewed'];
        if (!empty($data['event_code']) && in_array($data['event_code'], $renewal_events)) {
            // Check if payment_id already has this renewal event
            if (!empty($data['payment_id'])) {
                $count = $this->wpdb->get_var($this->wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->table_name} 
                    WHERE payment_id = %d 
                    AND event_code = %s",
                    $data['payment_id'],
                    $data['event_code']
                ));
                
                if ($count > 0) {
                    return true;
                }
            }
            
            // Also check by subscription_id + time window for renewal events
            if (!empty($data['subscription_id'])) {
                $count = $this->wpdb->get_var($this->wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->table_name} 
                    WHERE subscription_id = %d 
                    AND event_code = %s
                    AND created_at >= DATE_SUB(NOW(), INTERVAL %d MINUTE)",
                    $data['subscription_id'],
                    $data['event_code'],
                    $timeframe_minutes
                ));
                
                if ($count > 0) {
                    return true;
                }
            }
        }
        
        // Priority 3: Check for status change events
        if (!empty($data['event_code']) && $data['event_code'] === 'subscription.status_changed') {
            if (!empty($data['subscription_id']) && !empty($data['new_status'])) {
                $count = $this->wpdb->get_var($this->wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->table_name} 
                    WHERE subscription_id = %d 
                    AND event_code = 'subscription.status_changed'
                    AND new_status = %s
                    AND created_at >= DATE_SUB(NOW(), INTERVAL %d MINUTE)",
                    $data['subscription_id'],
                    $data['new_status'],
                    $timeframe_minutes
                ));
                
                if ($count > 0) {
                    return true;
                }
            }
        }
        
        // Priority 4: For non-webhook events, check by payment/subscription + event_code + status
        if (!empty($data['event_code'])) {
            $where_conditions[] = "event_code = %s";
            $where_values[] = $data['event_code'];
        } else {
            return false; // Must have event_code
        }
        
        // Must have payment_id OR subscription_id
        if (!empty($data['payment_id'])) {
            $where_conditions[] = "payment_id = %d";
            $where_values[] = $data['payment_id'];
        } elseif (!empty($data['subscription_id'])) {
            $where_conditions[] = "subscription_id = %d";
            $where_values[] = $data['subscription_id'];
        } else {
            return false;
        }
        
        // Check for same new_status (critical for status change events)
        if (!empty($data['new_status'])) {
            $where_conditions[] = "new_status = %s";
            $where_values[] = $data['new_status'];
        }
        
        // Timeframe check
        $where_conditions[] = "created_at >= DATE_SUB(NOW(), INTERVAL %d MINUTE)";
        $where_values[] = $timeframe_minutes;
        
        // Exclude webhook events if this is not a webhook event
        if (empty($data['gateway_event_id'])) {
            $where_conditions[] = "gateway_event_id IS NULL";
        }
        
        $where_clause = implode(' AND ', $where_conditions);
        $query = "SELECT COUNT(*) FROM {$this->table_name} WHERE " . $where_clause;
        $prepared = $this->wpdb->prepare($query, ...$where_values);
        
        return (int) $this->wpdb->get_var($prepared) > 0;
    }

    /**
     * Create event with deduplication check
     */
    public function create($data) {
        // Check for duplicate events
        if ($this->event_exists($data)) {
            return new WP_Error('duplicate_event', __('Similar event already logged', 'ytism'));
        }
        
        // Sanitize and validate data
        $data = $this->sanitize_data($data);
        $defaults = $this->get_default_fields();
        $data = wp_parse_args($data, $defaults);
        
        // Insert record
        $result = $this->wpdb->insert($this->table_name, $data);
        
        if ($result === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }
        
        return $this->wpdb->insert_id;
    }

    /**
     * Create event without deduplication check
     */
    public function insert($data) {
        $data = $this->sanitize_data($data);
        $defaults = $this->get_default_fields();
        $data = wp_parse_args($data, $defaults);
        
        // Insert record
        $result = $this->wpdb->insert($this->table_name, $data);
        
        if ($result === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }
        
        return $this->wpdb->insert_id;
    }

    /**
     * Get event by Tracking ID
     */
    public function get_by_gateway_event_id($gateway_event_id, $gatway, $event_type, $event_code) {
        $query = $this->wpdb->prepare(
            "SELECT * FROM {$this->table_name} 
            WHERE gateway_event_id = %s 
            AND gateway = %s 
            AND event_type = %s 
            AND event_code = %s
            ORDER BY created_at DESC LIMIT 1",
            $gateway_event_id,
            $gatway,
            $event_type,
            $event_code
        );
        return $this->wpdb->get_row($query);
    }

    /**
     * Log subscription events
     */
    public function log_subscription_created($subscription_id, $user_id, $gateway, $price) {
        return $this->create([
            "event_type" => "subscription",
            "subscription_id" => $subscription_id,
            "event_code" => "subscription.created",
            "status" => "success",
            "message" => sprintf(
                __("Subscription created by user #%d via %s for %s", "ytism"),
                $user_id,
                $gateway,
                $price
            ),
            "new_status" => "pending",
            "gateway" => $gateway,
            "triggered_by" => $user_id
        ]);
    }

    public function log_subscription_status_change($subscription_id, $old_status, $new_status, $reason = "") {
        $message = $reason;
        
        if (empty($message)) {
            $message = sprintf(
                __("Subscription status changed from %s to %s", "ytism"),
                $old_status,
                $new_status
            );
        }

        return $this->create([
            "event_type" => "subscription",
            "subscription_id" => $subscription_id,
            "event_code" => "subscription.status_changed",
            "status" => ($new_status === "canceled" || $new_status === "expired" || $new_status === "unpaid") ? "warning" : "info",
            "message" => $message,
            "old_status" => $old_status,
            "new_status" => $new_status,
            "failure_reason" => !empty($reason) ? $reason : null
        ]);
    }

    /**
     * Log payment events
     */
    public function log_payment_initiated($payment_id, $subscription_id, $price, $gateway) {
        return $this->create([
            "event_type" => "payment",
            "subscription_id" => $subscription_id,
            "payment_id" => $payment_id,
            "event_code" => "payment.initiated",
            "status" => "info",
            "message" => sprintf(
                __("Payment of %s initiated via %s", "ytism"),
                $price,
                $gateway
            ),
            "new_status" => "initiated",
            "gateway" => $gateway
        ]);
    }

    public function log_payment_succeeded($payment_id, $subscription_id, $price, $transaction_id, $gateway = null, $gateway_event_id = null) {
        return $this->create([
            "event_type" => "payment",
            "subscription_id" => $subscription_id,
            "payment_id" => $payment_id,
            "event_code" => "payment.succeeded",
            "status" => "success",
            "message" => sprintf(
                __("Payment of %s succeeded. Transaction: %s", "ytism"),
                $price,
                $transaction_id
            ),
            "old_status" => "processing",
            "new_status" => "succeeded",
            "gateway" => $gateway,
            "gateway_event_id" => $gateway_event_id,
            "payload" => json_encode(["transaction_id" => $transaction_id])
        ]);
    }

    public function log_payment_failed($payment_id, $subscription_id, $price, $failure_reason, $retry_count = 0, $gateway = null, $gateway_event_id = null) {
        $message = sprintf(
            __("Payment of %s failed: %s", "ytism"),
            $price,
            $failure_reason
        );

        if ($retry_count > 0) {
            $message .= " (" . sprintf(__("Retry #%d", "ytism"), $retry_count) . ")";
        }

        return $this->create([
            "event_type" => "payment",
            "subscription_id" => $subscription_id,
            "payment_id" => $payment_id,
            "event_code" => "payment.failed",
            "status" => "error",
            "message" => $message,
            "old_status" => "processing",
            "new_status" => "failed",
            "failure_reason" => $failure_reason,
            "retry_number" => $retry_count,
            "gateway" => $gateway,
            "gateway_event_id" => $gateway_event_id
        ]);
    }

    public function log_payment_retry($payment_id, $subscription_id, $retry_number, $gateway = null) {
        return $this->create([
            "event_type" => "payment",
            "subscription_id" => $subscription_id,
            "payment_id" => $payment_id,
            "event_code" => "payment.retry_attempted",
            "status" => "warning",
            "message" => sprintf(
                __("Payment retry attempt #%d", "ytism"),
                $retry_number
            ),
            "old_status" => "failed",
            "new_status" => "processing",
            "retry_number" => $retry_number,
            "gateway" => $gateway
        ]);
    }

    /**
     * Get timeline for subscription
     */
    public function get_subscription_timeline($subscription_id, $limit = 50, $offset = 0) {
        $where = $this->wpdb->prepare("subscription_id = %d", $subscription_id);
        return $this->get_records([
            "where" => $where,
            "orderby" => "created_at",
            "order" => "DESC",
            "limit" => $limit,
            "offset" => $offset
        ]);
    }

    /**
     * Get timeline for payment
     */
    public function get_payment_timeline($payment_id, $limit = 50, $offset = 0) {
        $where = $this->wpdb->prepare("payment_id = %d", $payment_id);
        return $this->get_records([
            "where" => $where,
            "orderby" => "created_at",
            "order" => "DESC",
            "limit" => $limit,
            "offset" => $offset
        ]);
    }

    /**
     * Get combined timeline
     */
    public function get_combined_timeline($subscription_id, $limit = 100, $offset = 0) {
        return $this->get_subscription_timeline($subscription_id, $limit, $offset);
    }

    /**
     * Get get last event by payment_id, event_code, subscription_id, and "event_code"
     */
    public function get_last_event($payment_id = null, $subscription_id = null, $event_code = null, $gateway = null) {
        $where_conditions = [];
        $where_values = [];

        if ($payment_id !== null) {
            $where_conditions[] = "payment_id = %d";
            $where_values[] = $payment_id;
        }

        if ($subscription_id !== null) {
            $where_conditions[] = "subscription_id = %d";
            $where_values[] = $subscription_id;
        }

        if ($event_code !== null) {
            $where_conditions[] = "event_code = %s";
            $where_values[] = $event_code;
        }

        if ($gateway !== null) {
            $where_conditions[] = "gateway = %s";
            $where_values[] = $gateway;
        }

        if (empty($where_conditions)) {
            return null;
        }

        $where_clause = implode(' AND ', $where_conditions);
        $query = "SELECT * FROM {$this->table_name} WHERE " . $where_clause . " ORDER BY created_at DESC LIMIT 1";
        $prepared = $this->wpdb->prepare($query, ...$where_values);

        return $this->wpdb->get_row($prepared);
    }

    /**
     * Get events by status
     */
    public function get_by_status($status, $hours = 24, $limit = 100) {
        $where = $this->wpdb->prepare(
            "status = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %d HOUR)",
            $status,
            $hours
        );

        return $this->get_records([
            "where" => $where,
            "limit" => $limit
        ]);
    }

    /**
     * Cleanup old events
     */
    public function cleanup_old_events($days = 90) {
        $date = date("Y-m-d H:i:s", strtotime("-{$days} days"));

        return $this->wpdb->query(
            $this->wpdb->prepare(
                "DELETE FROM {$this->table_name} WHERE created_at < %s AND status = 'info'",
                $date
            )
        );
    }
}