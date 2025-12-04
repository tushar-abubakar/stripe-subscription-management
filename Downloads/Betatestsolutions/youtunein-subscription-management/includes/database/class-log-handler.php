<?php
namespace YTISM\Database;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Log_Handler extends Handler {
    
    public function __construct() {
        parent::__construct();
        $this->table_name = $this->wpdb->prefix . 'ytism_logs';
    }
    
    /**
     * Create log entry with duplicate handling
     */
    public function create( $data ) {
        $defaults = [
            'ref_type'      => 'system',
            'ref_id'        => null,
            'gateway'       => '',
            'event_id'      => null,
            'event_code'    => '',
            'event_subcode' => null,
            'severity'      => 'info',
            'message'       => '',
            'data'          => null,
            'retry_count'   => 0,
            'user_id'       => get_current_user_id(),
            'ip'            => $this->get_user_ip(),
            'user_agent'    => $this->get_user_agent(),
        ];
        
        $data = wp_parse_args( $data, $defaults );
        
        // Convert data to JSON if not already string
        if ( isset( $data['data'] ) && ! is_null( $data['data'] ) ) {
            if ( ! is_string( $data['data'] ) ) {
                $data['data'] = wp_json_encode( $data['data'] );
            }
        }
        
        // Use INSERT ... ON DUPLICATE KEY UPDATE
        $sql = $this->wpdb->prepare(
            "INSERT INTO {$this->table_name} 
            (ref_type, ref_id, gateway, event_id, event_code, event_subcode, 
             severity, message, data, retry_count, user_id, ip, user_agent)
            VALUES (%s, %d, %s, %s, %s, %s, %s, %s, %s, %d, %d, %s, %s)
            ON DUPLICATE KEY UPDATE 
                retry_count = retry_count + 1,
                updated_at = CURRENT_TIMESTAMP,
                data = VALUES(data),
                message = VALUES(message)",
            $data['ref_type'], $data['ref_id'], $data['gateway'], 
            $data['event_id'], $data['event_code'], $data['event_subcode'],
            $data['severity'], $data['message'], $data['data'], 
            $data['retry_count'], $data['user_id'], $data['ip'], $data['user_agent']
        );
        
        $result = $this->wpdb->query( $sql );

        if ($result === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }
        
        if ( $result ) {
            return $this->wpdb->insert_id ?: true;
        }
        
        return false;
    }
    
    /**
     * Get logs by reference
     */
    public function get_by_reference( $ref_type, $ref_id, $limit = 50 ) {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE ref_type = %s AND ref_id = %d 
                ORDER BY created_at DESC 
                LIMIT %d",
                $ref_type, $ref_id, $limit
            )
        );
    }
    
    /**
     * Get logs by severity
     */
    public function get_by_severity( $severity, $limit = 50 ) {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE severity = %s 
                ORDER BY created_at DESC 
                LIMIT %d",
                $severity, $limit
            )
        );
    }
    
    /**
     * Get recent errors
     */
    public function get_recent_errors( $limit = 20 ) {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE severity IN ('error', 'critical') 
                ORDER BY created_at DESC 
                LIMIT %d",
                $limit
            )
        );
    }
    
    /**
     * Get logs by gateway event
     */
    public function get_by_gateway_event( $gateway, $event_id ) {
        return $this->wpdb->get_results(
            $this->wpdb->prepare(
                "SELECT * FROM {$this->table_name} 
                WHERE gateway = %s AND event_id = %s 
                ORDER BY created_at DESC",
                $gateway, $event_id
            )
        );
    }
    
    /**
     * Clean old logs
     */
    public function clean_old_logs( $days = 90 ) {
        $date = date( 'Y-m-d H:i:s', strtotime( "-{$days} days" ) );
        
        return $this->wpdb->query(
            $this->wpdb->prepare(
                "DELETE FROM {$this->table_name} 
                WHERE created_at < %s 
                AND severity NOT IN ('error', 'critical')",
                $date
            )
        );
    }
    
    /**
     * Get user IP address
     */
    private function get_user_ip() {
        if ( ! empty( $_SERVER['HTTP_CLIENT_IP'] ) ) {
            return sanitize_text_field( wp_unslash( $_SERVER['HTTP_CLIENT_IP'] ) );
        } elseif ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
            return sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) );
        } elseif ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            return sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }
        return '';
    }
    
    /**
     * Get user agent
     */
    private function get_user_agent() {
        return ! empty( $_SERVER['HTTP_USER_AGENT'] ) 
            ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 255 )
            : '';
    }
}
