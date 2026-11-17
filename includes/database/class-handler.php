<?php

namespace YTISM\Database;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

abstract class Handler {

    protected $wpdb;
    protected $table_name;

    public function __construct() {
        global $wpdb;
        $this->wpdb = $wpdb;
    }

    /**
     * Get a single record by ID with optional JSON decoding of specific fields.
     */
    public function get( int $id, string $return_type = 'OBJECT' ): array|object|null|false {
        $allowed_return_types = ['OBJECT', 'ARRAY_A', 'ARRAY_N'];
        if (!in_array($return_type, $allowed_return_types, true)) {
            return false;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table_name} WHERE ID = %d", $id),
            constant($return_type)
        );

        return $row;
    }

    /**
     * Delete a record by ID.
     */
    public function delete( int $id ): int|false {
        return $this->wpdb->delete(
            $this->table_name,
            ['ID' => $id],
            ['%d']
        );
    }

    /**
     * Get table name.
     */
    public function get_table_name(): string {
        return $this->table_name;
    }

    /**
     * Decode JSON fields on given row or object.
     * Only specified fields are decoded.
     * 
     * @param object|array|null $row
     * @param string $return_type One of 'OBJECT', 'ARRAY_A'
     * @param array $json_fields List of fields to decode JSON
     * @return object|array|null
     */
    protected function maybe_decode_json_fields( $row, string $return_type = 'OBJECT', array $json_fields = [] ) {
        if ( ! $row || empty($json_fields) ) {
            return $row;
        }

        foreach ( $json_fields as $field ) {
            if ($return_type === 'ARRAY_A') {
                if (isset($row[$field])) {
                    $decoded = json_decode($row[$field], true);
                    $row[$field] = is_array($decoded) ? $decoded : [];
                } else {
                    $row[$field] = [];
                }
            } elseif ($return_type === 'OBJECT') {
                if (isset($row->$field)) {
                    $decoded = json_decode($row->$field, true);
                    $row->$field = is_array($decoded) ? $decoded : [];
                } else {
                    $row->$field = [];
                }
            }
        }

        return $row;
    }
}