<?php

namespace YTISM\Database;
use YTISM\Helpers\Functions;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Event_Log extends Handler {

    protected array $json_fields = ['data'];

    public function __construct() {
        parent::__construct();
        $this->table_name = $this->wpdb->prefix . 'ytism_events_info';
    }

    /**
     * Create a new event log entry
     */
    public function create(array $data): int|WP_Error|false {
        $defaults = [
            'ref_type'      => 'system',
            'ref_id'        => 0,
            'ref_code'      => '',
            'event_uid'     => (string) time(),
            'severity'      => 'info',
            'message'       => '',
            'data'          => [],
            'retry_count'   => 0,
            'user_id'       => get_current_user_id(),
            'ip'            => Functions::get_user_ip(),
            'user_agent'    => Functions::get_user_agent(),
            'created_at'    => current_time('mysql'),
            'updated_at'    => current_time('mysql'),
        ];

        $data = wp_parse_args($data, $defaults);

        // Validate ref_type: start with letter or underscore, then letters, numbers, underscores only
        $ref_type = trim((string) $data['ref_type']);
        if (empty($ref_type) || preg_match('/\s/', $ref_type) || !preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $ref_type)) {
            return new WP_Error('invalid_ref_type', 'ref_type must be a non-empty string without spaces, starting with a letter or underscore, and containing only letters, numbers, and underscores.');
        }
        $data['ref_type'] = $ref_type;

        // Trim spaces from ref_code
        $ref_code = trim((string) $data['ref_code']);
        if (empty($ref_code) || preg_match('/\s/', $ref_code)) {
            return new WP_Error('invalid_ref_code', 'ref_code must be a non-empty string without spaces.');
        }

        // Validate ref_code structure:
        // Must start with letter or underscore,
        // contain letters, numbers, underscores,
        // dots allowed only in middle parts (not start or end)
        if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/', $ref_code)) {
            return new WP_Error('invalid_ref_code', 'ref_code must start with a letter or underscore and contain only letters, numbers, underscores, and dots (dots not at start or end).');
        }

        // Check if ref_code already starts with ref_type + '.'
        if (strpos($ref_code, $ref_type . '.') !== 0) {
            $ref_code = $ref_type . '.' . $ref_code;
        }
        $data['ref_code'] = $ref_code;

        // Ensure event_uid is a non-empty string
        $event_uid = trim((string) $data['event_uid']);
        if (empty($event_uid)) {
            return new WP_Error('invalid_event_uid', 'event_uid must be a non-empty string.');
        }
        $data['event_uid'] = $event_uid;

        // JSON encode specified fields
        foreach ($this->json_fields as $field) {
            if (!is_array($data[$field])) {
                return new WP_Error("invalid_{$field}", ucfirst($field) . ' must be an array');
            }
            $data[$field] = wp_json_encode($data[$field]);
        }

        $inserted = $this->wpdb->insert($this->table_name, $data, [
            '%s','%d','%s','%s','%s','%s','%s','%d','%d','%s','%s','%s','%s'
        ]);

        if ($inserted === false) {
            return new WP_Error('db_insert_error', $this->wpdb->last_error);
        }

        return $this->wpdb->insert_id;
    }

    /**
     * If an entry with the same ref_type, ref_id, ref_code, and event_uid exists, return its ID
     * Otherwise, create a new entry
     * Returns the ID of the existing or new entry, or WP_Error on failure
     * 
     * @param array $data
     * @return int|WP_Error|false
     */
    public function maybe_create(array $data): int|WP_Error|false {
        $ref_type = isset($data['ref_type']) ? trim((string) $data['ref_type']) : 'system';
        $ref_id = isset($data['ref_id']) ? (int) $data['ref_id'] : 0;
        $ref_code = isset($data['ref_code']) ? trim((string) $data['ref_code']) : '';
        $event_uid = isset($data['event_uid']) ? trim((string) $data['event_uid']) : '';

        if (empty($ref_code)) {
            return new WP_Error('missing_ref_code', 'ref_code is required to check for existing event log entry.');
        }

        if (empty($event_uid)) {
            $event_uid = (string) time();
            $data['event_uid'] = $event_uid;
        }

        // Normalize ref_code before checking (apply same logic as in create)
        if (strpos($ref_code, $ref_type . '.') !== 0) {
            $ref_code = $ref_type . '.' . $ref_code;
        }

        // Check if entry exists with the normalized ref_code
        $existing = $this->get_by($ref_type, $ref_id, $ref_code, $event_uid);

        if ($existing) {
            return (int) $existing->ID;
        }

        // Create new entry (it will normalize ref_code internally)
        return $this->create($data);
    }

    /**
     * Update an existing record by ID.
     *
     * Increments retry_count and updates message, data, updated_at
     * Returns the ID on success or WP_Error on failure.
     *
     * @param int $id
     * @param array $data
     * @return int|WP_Error
     */
    public function update(int $id, array $data): int|WP_Error {
        $existing = $this->get($id);
        if (!$existing) {
            return new WP_Error('not_found', 'Event log entry not found.');
        }

        // Restricted fields not allowed to update
        $restricted_fields = ['ref_type', 'ref_id', 'ref_code', 'event_uid'];
        foreach ($restricted_fields as $field) {
            if (array_key_exists($field, $data)) {
                unset($data[$field]);
            }
        }

        if (empty($data)) {
            return new WP_Error('no_data', 'No updatable fields provided for update.');
        }

        $update_data = [];

        foreach ($data as $key => $value) {
            if (in_array($key, $this->json_fields, true)) {
                if (!is_array($value)) {
                    return new WP_Error("invalid_{$key}", ucfirst($key) . ' must be an array');
                }
                $update_data[$key] = wp_json_encode($value);
            } else {
                if (in_array($key, ['retry_count', 'user_id'], true)) {
                    $update_data[$key] = (int) $value;
                } else {
                    $update_data[$key] = (string) $value;
                }
            }
        }

        // Increment retry_count based on existing value (override if passed)
        $update_data['retry_count'] = ((int) $existing->retry_count) + 1;
        $update_data['updated_at'] = current_time('mysql');

        // Prepare format array for wpdb update
        $format = [];
        foreach ($update_data as $key => $val) {
            if (in_array($key, ['retry_count', 'user_id'], true)) {
                $format[] = '%d';
            } else {
                $format[] = '%s';
            }
        }

        $updated = $this->wpdb->update(
            $this->table_name,
            $update_data,
            ['ID' => $id],
            $format,
            ['%d']
        );

        if ($updated === false) {
            return new WP_Error('db_update_error', $this->wpdb->last_error);
        }

        return $id;
    }

    /**
     * Get event log entry by ID
     *
     * @param int $id
     * @param string $return_type 'OBJECT' or 'ARRAY_A'
     * @return object|array|false
     */
    public function get(int $id, string $return_type = 'OBJECT'): array|object|false {
        $row = parent::get($id, $return_type);

        return $this->maybe_decode_json_fields($row, $return_type, $this->json_fields);
    }

    /**
     * Get an event by matching keys
     *
     * @param string $ref_type
     * @param int $ref_id
     * @param string $ref_code Use the final/normalized ref_code (with prefix)
     * @param string $event_uid Event UID (required, non-empty)
     * @param string $return_type 'OBJECT' or 'ARRAY_A'
     * @return object|array|false
     */
    public function get_by(string $ref_type, int $ref_id, string $ref_code, string $event_uid, string $return_type = 'OBJECT'): object|array|false {
        if (empty($ref_type) || empty($ref_id) || empty($ref_code) || empty($event_uid)) {
            return false;
        }

        $sql = $this->wpdb->prepare(
            "SELECT * FROM {$this->table_name} 
            WHERE ref_type = %s 
            AND ref_id = %d 
            AND ref_code = %s 
            AND event_uid = %s
            LIMIT 1",
            $ref_type,
            $ref_id,
            $ref_code,
            $event_uid
        );

        $row = $this->wpdb->get_row(
            $sql,
            $return_type === 'ARRAY_A' ? ARRAY_A : OBJECT
        );

        if (!$row) {
            return false;
        }

        return $this->maybe_decode_json_fields($row, $return_type, $this->json_fields);
    }
}