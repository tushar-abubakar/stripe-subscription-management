<?php

namespace YTISM\Database;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Base Database Class - Common functionality for all database operations
 */
abstract class Base {
    protected $wpdb;
    protected $table_name;
    protected $primary_key = 'ID';
    
    public function __construct() {
        global $wpdb;
        $this->wpdb = $wpdb;
        $this->table_name = $this->get_table_name();
    }
    
    abstract protected function get_table_name();
    abstract protected function get_default_fields();
    
    /**
     * Create a new record
     */
    public function create($data) {
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
     * Update an existing record
     */
    public function update($id, $data) {
        // Sanitize data
        $data = $this->sanitize_data($data);
        
        // Add updated_at if exists
        if ($this->has_field('updated_at')) {
            $data['updated_at'] = current_time('mysql');
        }
        
        $result = $this->wpdb->update(
            $this->table_name,
            $data,
            [$this->primary_key => $id],
            null,
            ['%d']
        );
        
        if ($result === false) {
            return new WP_Error('db_update_error', $this->wpdb->last_error);
        }
        
        return $result;
    }
    
    /**
     * Get record by ID
     */
    public function get($id) {
        return $this->wpdb->get_row($this->wpdb->prepare(
            "SELECT * FROM {$this->table_name} WHERE {$this->primary_key} = %d",
            $id
        ));
    }
    
    /**
     * Delete record by ID
     */
    public function delete($id) {
        return $this->wpdb->delete(
            $this->table_name,
            [$this->primary_key => $id],
            ['%d']
        );
    }
    
    /**
     * Get records with optional conditions
     */
    public function get_records($args = []) {
        $defaults = [
            'where' => '',
            'orderby' => $this->primary_key,
            'order' => 'DESC',
            'limit' => 0,
            'offset' => 0
        ];
        
        $args = wp_parse_args($args, $defaults);
        
        $sql = "SELECT * FROM {$this->table_name}";
        
        if (!empty($args['where'])) {
            $sql .= " WHERE " . $args['where'];
        }
        
        $sql .= " ORDER BY {$args['orderby']} {$args['order']}";
        
        if ($args['limit'] > 0) {
            $sql .= " LIMIT {$args['offset']}, {$args['limit']}";
        }
        
        return $this->wpdb->get_results($sql);
    }
    
    /**
     * Count records
     */
    public function count($where = '') {
        $sql = "SELECT COUNT(*) FROM {$this->table_name}";
        if (!empty($where)) {
            $sql .= " WHERE " . $where;
        }
        return $this->wpdb->get_var($sql);
    }
    
    /**
     * Check if field exists in table
     */
    protected function has_field($field) {
        $defaults = $this->get_default_fields();
        return array_key_exists($field, $defaults);
    }
    
    /**
     * Sanitize data based on field types
     */
    protected function sanitize_data($data) {
        $sanitized = [];
        
        foreach ($data as $key => $value) {
            switch ($key) {
                case 'user_id':
                case 'subscription_id':
                case 'payment_id':
                case 'triggered_by':
                case 'quantity':
                    $sanitized[$key] = absint($value);
                    break;
                    
                case 'amount':
                    $sanitized[$key] = floatval($value);
                    break;

                case 'currency':
                    $sanitized[$key] = strtoupper($value);
                    break;
                    
                case 'email':
                    $sanitized[$key] = sanitize_email($value);
                    break;
                    
                case 'metadata':
                case 'payload':
                case 'gateway_response':
                    $sanitized[$key] = is_string($value) ? $value : wp_json_encode($value);
                    break;
                    
                default:
                    $sanitized[$key] = sanitize_text_field($value);
                    break;
            }
        }
        
        return $sanitized;
    }

    /**
     * Get record by field value
     */
    public function get_by($field, $value, $format = '%s') {
        return $this->wpdb->get_row($this->wpdb->prepare(
            "SELECT * FROM {$this->table_name} WHERE {$field} = {$format}",
            $value
        ));
    }

    /**
     * Get multiple records by field value
     */
    public function get_where($field, $value, $format = '%s', $limit = 0) {
        $sql = $this->wpdb->prepare(
            "SELECT * FROM {$this->table_name} WHERE {$field} = {$format}",
            $value
        );
        
        if ($limit > 0) {
            $sql .= " LIMIT {$limit}";
        }
        
        return $this->wpdb->get_results($sql);
    }

    /**
     * Check if record exists
     */
    public function exists($field, $value, $format = '%s') {
        $count = $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table_name} WHERE {$field} = {$format}",
            $value
        ));
        return $count > 0;
    }
}