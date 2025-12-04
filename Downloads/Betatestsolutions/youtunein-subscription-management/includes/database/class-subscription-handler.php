<?php
namespace YTISM\Database;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Subscription_Handler extends Handler {
    
    public function __construct() {
        parent::__construct();
        $this->table_name = $this->wpdb->prefix . 'ytism_subs';
    }

    /**
     * Create new subscription
     */
    public function create( $data ) {
        $defaults = [
            'user_id'           => 0,
            'gateway_sub_id'    => '',
            'gateway'           => '',
            'status'            => 'incomplete',
            'plan_id'           => null,
            'customer_id'       => null,
            'qty'               => 1,
            'last_txn_id'       => null,
            'period_start'      => current_time('mysql'),
            'period_end'        => null,
            'next_billing_at'   => null,
            'trial_start_at'    => null,
            'trial_end_at'      => null,
            'activated_at'      => null,
            'canceled_at'       => null,
            'billing_cycle'     => 'month',
            'billing_interval'  => 1,
            'metadata'          => null,
        ];
        
        $data = wp_parse_args( $data, $defaults );
        
        // Convert metadata to JSON if not already string
        if ( isset( $data['metadata'] ) && ! is_null( $data['metadata'] ) ) {
            if ( ! is_string( $data['metadata'] ) ) {
                $data['metadata'] = wp_json_encode( $data['metadata'] );
            }
        }
        
        $result = $this->wpdb->insert(
            $this->table_name,
            $data,
            [
                '%d', '%s', '%s', '%s', '%s', '%s', '%d',
                '%s', '%s', '%s', '%s', '%s', '%s', '%s',
                '%s', '%d', '%s'
            ]
        );

        if ($result === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }

        return $this->wpdb->insert_id;
    }
    
    /**
     * Update subscription
     */
    public function update( $id, $data ) {
        // Handle metadata merging
        if ( isset( $data['metadata'] ) ) {
            $existing = $this->get( $id );
            
            if ( $existing && ! empty( $existing->metadata ) ) {
                // Decode existing metadata
                $existing_meta = json_decode( $existing->metadata, true );
                if ( ! is_array( $existing_meta ) ) {
                    $existing_meta = [];
                }
                
                // Decode new metadata if string
                $new_meta = $data['metadata'];
                if ( is_string( $new_meta ) ) {
                    $new_meta = json_decode( $new_meta, true );
                    if ( ! is_array( $new_meta ) ) {
                        $new_meta = [];
                    }
                } elseif ( ! is_array( $new_meta ) ) {
                    $new_meta = [];
                }
                
                // Merge: new values override existing
                $merged_meta = array_merge( $existing_meta, $new_meta );
                $data['metadata'] = wp_json_encode( $merged_meta );
            } else {
                // No existing metadata, just encode new
                if ( ! is_string( $data['metadata'] ) ) {
                    $data['metadata'] = wp_json_encode( $data['metadata'] );
                }
            }
        }
        
        return $this->wpdb->update(
            $this->table_name,
            $data,
            [ 'ID' => $id ],
            null,
            [ '%d' ]
        );
    }
    
    /**
     * Get subscription by gateway subscription ID
     */
    public function get_by_gateway_id( $gateway, $gateway_sub_id, $return_type = 'OBJECT') {
        return $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE gateway = %s AND gateway_sub_id = %s",
                $gateway, $gateway_sub_id
            ),
            $return_type == 'ARRAY_A' ? ARRAY_A : OBJECT
        );
    }

    /**
     * Get subscription by gateway setup intent id
     */
    public function get_by_setup_intent($gateway, $customer_id, $setup_intent_id, $min_created_at = null, $return_type = 'OBJECT') {
        $query = "SELECT * FROM {$this->table_name} 
                WHERE gateway = %s
                    AND customer_id = %s
                    AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.setup_intent_id')) = %s";

        $params = [$gateway, $customer_id, $setup_intent_id];

        // Add created_at >= condition if $min_created_at is provided
        if ($min_created_at !== null) {
            // Auto-convert Unix timestamp to 'Y-m-d H:i:s' if numeric
            if (is_int($min_created_at) || ctype_digit($min_created_at)) {
                $min_created_at = gmdate('Y-m-d H:i:s', $min_created_at);
            }
            $query .= " AND created_at >= %s";
            $params[] = $min_created_at;
        }

        $query .= " ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1";

        return $this->wpdb->get_row(
            $this->wpdb->prepare($query, ...$params),
            $return_type == 'ARRAY_A' ? ARRAY_A : OBJECT
        );
    }

    
    /**
     * Get user subscriptions
     */
    public function get_by_user( $user_id, $status = null ) {
        $sql = "SELECT * FROM {$this->table_name} WHERE user_id = %d";
        $params = [ $user_id ];
        
        if ( $status ) {
            $sql .= " AND status = %s";
            $params[] = $status;
        }
        
        $sql .= " ORDER BY created_at DESC";
        
        return $this->wpdb->get_results(
            $this->wpdb->prepare( $sql, $params )
        );
    }
    
    /**
     * Get active subscriptions
     */
    public function get_active() {
        return $this->wpdb->get_results(
            "SELECT * FROM {$this->table_name} 
            WHERE status IN ('active', 'trialing') 
            ORDER BY next_billing_at ASC"
        );
    }
    
    /**
     * Update subscription status
     */
    public function update_status( $id, $new_status ) {
        return $this->update( $id, [
            'status' => $new_status
        ]);
    }
    
    /**
     * Cancel subscription
     */
    public function cancel( $id ) {
        return $this->update( $id, [
            'status'       => 'canceled',
            'canceled_at'  => current_time('mysql')
        ]);
    }
    
    /**
     * Activate subscription
     */
    public function activate( $id ) {
        $updates = [
            'status' => 'active'
        ];
        
        // Set activated_at only on first activation
        $sub = $this->get( $id );
        if ( $sub && empty( $sub->activated_at ) ) {
            $updates['activated_at'] = current_time('mysql');
        }
        
        return $this->update( $id, $updates );
    }
    
    /**
     * Get subscriptions expiring soon
     */
    public function get_expiring_soon( $days = 7 ) {
        $date = date( 'Y-m-d H:i:s', strtotime( "+{$days} days" ) );
        
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE status IN ('active', 'trialing') 
                AND next_billing_at <= %s 
                AND next_billing_at IS NOT NULL
                ORDER BY next_billing_at ASC",
                $date
            )
        );
    }
    
    /**
     * Get subscription timeline
     */
    public function get_timeline( $id ) {
        $sub = $this->get( $id );
        if ( ! $sub ) {
            return [];
        }
        
        $timeline = [];
        
        // Created
        $timeline[] = [
            'date'        => $sub->created_at,
            'type'        => 'created',
            'status'      => 'info',
            'title'       => __( 'Subscription Created', 'ytism' ),
            'description' => sprintf(
                __( 'Subscription created with %s gateway', 'ytism' ),
                $sub->gateway
            )
        ];
        
        // Trial started
        if ( $sub->trial_start_at ) {
            $timeline[] = [
                'date'        => $sub->trial_start_at,
                'type'        => 'trial_start',
                'status'      => 'info',
                'title'       => __( 'Trial Period Started', 'ytism' ),
                'description' => sprintf(
                    __( 'Trial period started, ends on %s', 'ytism' ),
                    date_i18n( get_option('date_format'), strtotime( $sub->trial_end_at ) )
                )
            ];
        }
        
        // Activated
        if ( $sub->activated_at ) {
            $timeline[] = [
                'date'        => $sub->activated_at,
                'type'        => 'activated',
                'status'      => 'success',
                'title'       => __( 'Subscription Activated', 'ytism' ),
                'description' => __( 'Subscription became active', 'ytism' )
            ];
        }
        
        // Canceled
        if ( $sub->canceled_at ) {
            $timeline[] = [
                'date'        => $sub->canceled_at,
                'type'        => 'canceled',
                'status'      => 'error',
                'title'       => __( 'Subscription Canceled', 'ytism' ),
                'description' => __( 'Subscription was canceled', 'ytism' )
            ];
        }
        
        // Get transactions for this subscription
        $txn_handler = new Transaction_Handler();
        $transactions = $txn_handler->get_by_subscription( $id );
        
        foreach ( $transactions as $txn ) {
            $timeline[] = [
                'date'        => $txn->processed_at ?: $txn->created_at,
                'type'        => 'transaction',
                'status'      => $this->get_txn_status_class( $txn->status ),
                'title'       => $this->get_txn_type_label( $txn->type ),
                'description' => sprintf(
                    __( '%s - %s %s', 'ytism' ),
                    $this->get_txn_status_label( $txn->status ),
                    $txn->amount,
                    $txn->currency
                ),
                'transaction_id' => $txn->ID
            ];
        }
        
        // Sort by date descending
        usort( $timeline, function( $a, $b ) {
            return strtotime( $b['date'] ) - strtotime( $a['date'] );
        });
        
        return $timeline;
    }
    
    /**
     * Get transaction status CSS class
     */
    private function get_txn_status_class( $status ) {
        $classes = [
            'succeeded' => 'success',
            'pending'   => 'warning',
            'failed'    => 'error',
            'refunded'  => 'warning',
            'disputed'  => 'critical',
        ];
        
        return isset( $classes[ $status ] ) ? $classes[ $status ] : 'info';
    }
    
    /**
     * Get transaction type label
     */
    private function get_txn_type_label( $type ) {
        $labels = [
            'initial'    => __( 'Initial Payment', 'ytism' ),
            'recurring'  => __( 'Recurring Payment', 'ytism' ),
            'trial'      => __( 'Trial Payment', 'ytism' ),
            'upgrade'    => __( 'Upgrade', 'ytism' ),
            'downgrade'  => __( 'Downgrade', 'ytism' ),
            'refund'     => __( 'Refund', 'ytism' ),
            'chargeback' => __( 'Chargeback', 'ytism' ),
        ];
        
        return isset( $labels[ $type ] ) ? $labels[ $type ] : $type;
    }
    
    /**
     * Get transaction status label
     */
    private function get_txn_status_label( $status ) {
        $labels = [
            'pending'          => __( 'Pending', 'ytism' ),
            'processing'       => __( 'Processing', 'ytism' ),
            'succeeded'        => __( 'Succeeded', 'ytism' ),
            'failed'           => __( 'Failed', 'ytism' ),
            'requires_action'  => __( 'Requires Action', 'ytism' ),
            'canceled'         => __( 'Canceled', 'ytism' ),
            'refunded'         => __( 'Refunded', 'ytism' ),
            'disputed'         => __( 'Disputed', 'ytism' ),
        ];
        
        return isset( $labels[ $status ] ) ? $labels[ $status ] : $status;
    }
}
