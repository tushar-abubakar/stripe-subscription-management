<?php
namespace YTISM\Database;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Transaction_Handler extends Handler {
    
    public function __construct() {
        parent::__construct();
        $this->table_name = $this->wpdb->prefix . 'ytism_txns';
    }
    
    /**
     * Create new transaction
     */
    public function create( $data ) {
        $defaults = [
            'sub_id'             => 0,
            'gateway'            => '',
            'gateway_txn_id'     => '',
            'gateway_intent_id'  => null,
            'status'             => 'pending',
            'type'               => 'initial',
            'amount'             => 0.00,
            'currency'           => 'USD',
            'payment_method_id'  => null,
            'retry_count'        => 0,
            'error_code'         => null,
            'error_message'      => null,
            'processed_at'       => null,
            'gateway_data'       => null,
        ];
        
        $data = wp_parse_args( $data, $defaults );
        
        // Convert gateway_data to JSON if not already string
        if ( isset( $data['gateway_data'] ) && ! is_null( $data['gateway_data'] ) ) {
            if ( ! is_string( $data['gateway_data'] ) ) {
                $data['gateway_data'] = wp_json_encode( $data['gateway_data'] );
            }
        }
        
        $result = $this->wpdb->insert(
            $this->table_name,
            $data,
            [
                '%d', '%s', '%s', '%s', '%s', '%s', '%f',
                '%s', '%f', '%f', '%f', '%s', '%d', '%s',
                '%s', '%s', '%s'
            ]
        );
        
        if ($result === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }

        return $this->wpdb->insert_id;
    }
    
    /**
     * Update transaction
     */
    public function update( $id, $data ) {
        // Handle gateway_data merging
        if ( isset( $data['gateway_data'] ) ) {
            $existing = $this->get( $id );
            
            if ( $existing && ! empty( $existing->gateway_data ) ) {
                // Decode existing gateway_data
                $existing_data = json_decode( $existing->gateway_data, true );
                if ( ! is_array( $existing_data ) ) {
                    $existing_data = [];
                }
                
                // Decode new gateway_data if string
                $new_data = $data['gateway_data'];
                if ( is_string( $new_data ) ) {
                    $new_data = json_decode( $new_data, true );
                    if ( ! is_array( $new_data ) ) {
                        $new_data = [];
                    }
                } elseif ( ! is_array( $new_data ) ) {
                    $new_data = [];
                }
                
                // Merge: new values override existing
                $merged_data = array_merge( $existing_data, $new_data );
                $data['gateway_data'] = wp_json_encode( $merged_data );
            } else {
                // No existing gateway_data, just encode new
                if ( ! is_string( $data['gateway_data'] ) ) {
                    $data['gateway_data'] = wp_json_encode( $data['gateway_data'] );
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
     * Get transaction by gateway transaction ID
     */
    public function get_by_gateway_txn_id( $gateway, $gateway_txn_id, $return_type = 'OBJECT' ) {
        return $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE gateway = %s AND gateway_txn_id = %s",
                $gateway, $gateway_txn_id
            ),
            $return_type == 'ARRAY_A' ? ARRAY_A : OBJECT
        );
    }

    /**
     * Get transaction by gateway intent ID
     */
    public function get_by_gateway_intent_id( $gateway, $gateway_intent_id, $return_type = 'OBJECT' ) {
        return $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE gateway = %s AND gateway_intent_id = %s",
                $gateway, $gateway_intent_id
            ),
            $return_type == 'ARRAY_A' ? ARRAY_A : OBJECT
        );
    }
    
    /**
     * Get transactions by subscription
     */
    public function get_by_subscription( $sub_id, $status = null ) {
        $sql = "SELECT * FROM {$this->table_name} WHERE sub_id = %d";
        $params = [ $sub_id ];
        
        if ( $status ) {
            $sql .= " AND status = %s";
            $params[] = $status;
        }
        
        $sql .= " ORDER BY created_at DESC";
        
        return $this->wpdb->get_results(
            $this->wpdb->prepare( $sql, $params )
        );
    }

    // get latest transaction by sub id
    public function get_by_subscription_id($gateway, $sub_id, $min_created_at = null, $return_type = 'OBJECT') {
        $query = "SELECT * FROM {$this->table_name} WHERE gateway = %s AND sub_id = %d";
        $params = [$gateway, $sub_id];

        // If min_created_at is provided
        if ($min_created_at !== null) {
            // Auto-convert Unix timestamp to 'Y-m-d H:i:s' if needed
            if (is_int($min_created_at) || ctype_digit($min_created_at)) {
                $min_created_at = gmdate('Y-m-d H:i:s', $min_created_at);
            }

            $query .= " AND created_at >= %s";
            $params[] = $min_created_at;
        }

        $query .= " ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1";

        return $this->wpdb->get_row(
            $this->wpdb->prepare($query, ...$params),
            $return_type === 'ARRAY_A' ? ARRAY_A : OBJECT
        );
    }

    
    /**
     * Update transaction status
     */
    public function update_status( $id, $new_status ) {
        $updates = [
            'status' => $new_status
        ];
        
        // Set processed_at for successful transactions
        if ( $new_status === 'succeeded' ) {
            $txn = $this->get( $id );
            if ( $txn && empty( $txn->processed_at ) ) {
                $updates['processed_at'] = current_time('mysql');
            }
        }
        
        return $this->update( $id, $updates );
    }
    
    /**
     * Mark transaction as failed
     */
    public function mark_failed( $id, $error_code = null, $error_message = null ) {
        return $this->update( $id, [
            'status'        => 'failed',
            'error_code'    => $error_code,
            'error_message' => $error_message,
            'processed_at'  => current_time('mysql')
        ]);
    }
    
    /**
     * Mark transaction as succeeded
     */
    public function mark_succeeded( $id, $gateway_intent_id = null ) {
        $updates = [
            'status'       => 'succeeded',
            'processed_at' => current_time('mysql')
        ];
        
        if ( $gateway_intent_id ) {
            $updates['gateway_intent_id'] = $gateway_intent_id;
        }
        
        return $this->update( $id, $updates );
    }
    
    /**
     * Increment retry count
     */
    public function increment_retry( $id ) {
        return $this->wpdb->query(
            $this->wpdb->prepare(
                "UPDATE {$this->table_name} 
                SET retry_count = retry_count + 1 
                WHERE ID = %d",
                $id
            )
        );
    }
    
    /**
     * Get failed transactions
     */
    public function get_failed( $limit = 50 ) {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE status = 'failed' 
                ORDER BY created_at DESC 
                LIMIT %d",
                $limit
            )
        );
    }
    
    /**
     * Get transaction statistics for subscription
     */
    public function get_subscription_stats( $sub_id ) {
        return $this->wpdb->get_row(
            $this->wpdb->prepare(
                "SELECT 
                    COUNT(*) as total_transactions,
                    SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as successful,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) as total_revenue
                FROM {$this->table_name} 
                WHERE sub_id = %d",
                $sub_id
            )
        );
    }
}
