<?php 

namespace YTISM\Admin;
use YTISM\Database\Subscription_Handler;
use YTISM\Database\Transaction_Handler;
use YTISM\Database\Log_Handler;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! class_exists( 'WP_List_Table' ) ) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class Logs_List_Table extends \WP_List_Table {
    
    private $log_handler;
    
    public function __construct() {
        parent::__construct([
            'singular' => __('Log', 'ytism'),
            'plural'   => __('Logs', 'ytism'),
            'ajax'     => false
        ]);
        
        $this->log_handler = new Log_Handler();

        $this->_column_headers = [
            $this->get_columns(),
            [],
            $this->get_sortable_columns()
        ];
    }
    
    public function get_columns() {
        return [
            'created_at' => __('Date', 'ytism'),
            'severity'   => __('Severity', 'ytism'),
            'ref_type'   => __('Type', 'ytism'),
            'event_code' => __('Event', 'ytism'),
            'message'    => __('Message', 'ytism'),
            'gateway'    => __('Gateway', 'ytism'),
            'retry_count' => __('Retries', 'ytism'),
        ];
    }
    
    protected function get_sortable_columns() {
        return [
            'created_at' => ['created_at', true],
            'severity'   => ['severity', false],
            'ref_type'   => ['ref_type', false],
        ];
    }
    
    protected function column_created_at($item) {
        return esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($item->created_at)));
    }
    
    protected function column_severity($item) {
        $class_map = [
            'info'     => 'info',
            'success'  => 'success',
            'warning'  => 'warning',
            'error'    => 'error',
            'critical' => 'error',
        ];
        
        $class = isset($class_map[$item->severity]) ? $class_map[$item->severity] : 'default';
        
        return sprintf(
            '<span class="ytism-badge ytism-badge-%s">%s</span>',
            esc_attr($class),
            esc_html(ucfirst($item->severity))
        );
    }
    
    protected function column_ref_type($item) {
        $ref_id = $item->ref_id ? '#' . $item->ref_id : '';
        if ($ref_id) {
            return sprintf('%s<br/><small>%s</small>', esc_html(ucfirst($item->ref_type)), esc_html($ref_id));
        }
        return esc_html(ucfirst($item->ref_type));
    }
    
    protected function column_event_code($item) {
        $html = '<strong>' . esc_html($item->event_code) . '</strong>';
        $html .= '<br/><b>ID: #' . $item->ID . '</b>';
        if (!empty($item->event_subcode)) {  // Check if not empty
            $html .= '<br><small>' . esc_html($item->event_subcode) . '</small>';
        }
        return $html;
    }
    
    protected function column_message($item) {
        return esc_html(wp_trim_words($item->message, 15));
    }
    
    protected function column_gateway($item) {
        return esc_html(ucfirst($item->gateway));
    }
    
    protected function column_retry_count($item) {
        if ($item->retry_count > 0) {
            return '<span class="ytism-badge ytism-badge-warning">' . esc_html($item->retry_count) . '</span>';
        }
        return '-';
    }
    
    protected function column_default($item, $column_name) {
        $value = $item->$column_name ?? '';
        return $value !== '' ? esc_html($value) : '-';
    }

    protected function get_value($item, $property, $default = '') {
        return isset($item->$property) && $item->$property !== null ? $item->$property : $default;
    }

    // Then use it everywhere:
    protected function column_type($item) {
        $type = $this->get_value($item, 'type', '');
        return esc_html(ucfirst(str_replace('_', ' ', $type)));
    }

    
    public function prepare_items() {
        global $wpdb;
        
        $per_page = 50;
        $current_page = $this->get_pagenum();
        $offset = ($current_page - 1) * $per_page;
        
        $severity = isset($_GET['severity']) ? sanitize_text_field($_GET['severity']) : '';
        $ref_type = isset($_GET['ref_type']) ? sanitize_text_field($_GET['ref_type']) : '';
        $orderby = isset($_GET['orderby']) ? sanitize_text_field($_GET['orderby']) : 'created_at';
        $order = isset($_GET['order']) ? sanitize_text_field($_GET['order']) : 'DESC';
        
        $table = $this->log_handler->get_table_name();
        
        $where_clauses = [];
        $where_params = [];
        
        if ($severity) {
            $where_clauses[] = "severity = %s";
            $where_params[] = $severity;
        }
        
        if ($ref_type) {
            $where_clauses[] = "ref_type = %s";
            $where_params[] = $ref_type;
        }
        
        $where = '';
        if (!empty($where_clauses)) {
            $where = " WHERE " . implode(' AND ', $where_clauses);
        }
        
        $total_items = $wpdb->get_var(
            empty($where_params) 
                ? "SELECT COUNT(*) FROM {$table}{$where}"
                : $wpdb->prepare("SELECT COUNT(*) FROM {$table}{$where}", $where_params)
        );
        
        $query = "SELECT * FROM {$table}{$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
        $all_params = array_merge($where_params, [$per_page, $offset]);
        $items = $wpdb->get_results($wpdb->prepare($query, $all_params));
        
        $this->items = $items;
        
        $this->set_pagination_args([
            'total_items' => $total_items,
            'per_page'    => $per_page,
            'total_pages' => ceil($total_items / $per_page)
        ]);
    }
    
    protected function extra_tablenav($which) {
        if ($which !== 'top') {
            return;
        }
        ?>
        <div class="alignleft actions">
            <select name="severity">
                <option value=""><?php esc_html_e('All Severities', 'ytism'); ?></option>
                <option value="info" <?php selected(isset($_GET['severity']) ? $_GET['severity'] : '', 'info'); ?>><?php esc_html_e('Info', 'ytism'); ?></option>
                <option value="success" <?php selected(isset($_GET['severity']) ? $_GET['severity'] : '', 'success'); ?>><?php esc_html_e('Success', 'ytism'); ?></option>
                <option value="warning" <?php selected(isset($_GET['severity']) ? $_GET['severity'] : '', 'warning'); ?>><?php esc_html_e('Warning', 'ytism'); ?></option>
                <option value="error" <?php selected(isset($_GET['severity']) ? $_GET['severity'] : '', 'error'); ?>><?php esc_html_e('Error', 'ytism'); ?></option>
                <option value="critical" <?php selected(isset($_GET['severity']) ? $_GET['severity'] : '', 'critical'); ?>><?php esc_html_e('Critical', 'ytism'); ?></option>
            </select>
            <select name="ref_type">
                <option value=""><?php esc_html_e('All Types', 'ytism'); ?></option>
                <option value="subscription" <?php selected(isset($_GET['ref_type']) ? $_GET['ref_type'] : '', 'subscription'); ?>><?php esc_html_e('Subscription', 'ytism'); ?></option>
                <option value="transaction" <?php selected(isset($_GET['ref_type']) ? $_GET['ref_type'] : '', 'transaction'); ?>><?php esc_html_e('Transaction', 'ytism'); ?></option>
                <option value="user" <?php selected(isset($_GET['ref_type']) ? $_GET['ref_type'] : '', 'user'); ?>><?php esc_html_e('User', 'ytism'); ?></option>
                <option value="system" <?php selected(isset($_GET['ref_type']) ? $_GET['ref_type'] : '', 'system'); ?>><?php esc_html_e('System', 'ytism'); ?></option>
            </select>
            <?php submit_button(__('Filter', 'ytism'), '', 'filter_action', false); ?>
        </div>
        <?php
    }
}