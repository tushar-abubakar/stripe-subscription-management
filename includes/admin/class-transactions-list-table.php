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

class Transactions_List_Table extends \WP_List_Table {
    
    private $txn_handler;
    
    public function __construct() {
        parent::__construct([
            'singular' => __('Transaction', 'ytism'),
            'plural'   => __('Transactions', 'ytism'),
            'ajax'     => false
        ]);
        
        $this->txn_handler = new Transaction_Handler();

        $this->_column_headers = [
            $this->get_columns(),
            [],
            $this->get_sortable_columns(),
            $this->get_primary_column_name()
        ];
    }
    
    public function get_columns() {
        return [
            'cb'       => '<input type="checkbox" />',
            'ID'       => __('ID', 'ytism'),
            'user_id'  => __('User', 'ytism'),
            'gateway'  => __('Gateway', 'ytism'),
            'type'     => __('Type', 'ytism'),
            'amount'   => __('Amount', 'ytism'),
            'status'   => __('Status', 'ytism'),
            'created_at' => __('Date', 'ytism'),
        ];
    }
    
    protected function get_sortable_columns() {
        return [
            'ID'         => ['ID', false],
            'type'       => ['type', false],
            'amount'     => ['amount', false],
            'status'     => ['status', false],
            'created_at' => ['created_at', true],
        ];
    }
    
    protected function column_cb($item) {
        return sprintf('<input type="checkbox" name="transaction[]" value="%s" />', $item->ID);
    }
    
    protected function column_ID($item) {
        $view_url = add_query_arg([
            'page' => 'ytism-transaction-view',
            'id'   => $item->ID,
        ], admin_url('admin.php'));
        
        $actions = [
            'view' => sprintf(
                '<a href="%s">%s</a>',
                esc_url($view_url),
                __('View Details', 'ytism')
            ),
        ];
        
        return sprintf(
            '<strong>#%d</strong> %s',
            $item->ID,
            $this->row_actions($actions)
        );
    }
    
    protected function column_user_id($item) {
        $user = get_user_by('id', $item->user_id);
        if (!$user) {
            return __('Unknown', 'ytism');
        }
        
        return sprintf(
            '<a href="%s">%s</a>',
            get_edit_user_link($item->user_id),
            esc_html($user->display_name)
        );
    }
    
    protected function column_gateway($item) {
        $gateway = $this->get_value($item, 'gateway', '');
        $txn_id = $this->get_value($item, 'gateway_txn_id', '');
        $retry_count = intval($this->get_value($item, 'retry_count', 0));
        
        return sprintf(
            '<strong>%s</strong><br><small>%s</small><br/>Retries: %s',
            esc_html(ucfirst($gateway)),
            esc_html($txn_id),
            $retry_count
        );
    }
    
    protected function column_amount($item) {
        return sprintf(
            '<strong>%s</strong> %s',
            number_format($item->amount, 2),
            strtoupper($item->currency)
        );
    }
    
    protected function column_status($item) {
        $class_map = [
            'succeeded'       => 'success',
            'pending'         => 'warning',
            'processing'      => 'info',
            'failed'          => 'error',
            'refunded'        => 'warning',
            'disputed'        => 'error',
            'requires_action' => 'warning',
        ];
        
        $status = $item->status ?? 'pending';
        $class = isset($class_map[$status]) ? $class_map[$status] : 'default';
        
        return sprintf(
            '<span class="ytism-badge ytism-badge-%s">%s</span>',
            esc_attr($class),
            esc_html(ucfirst(str_replace('_', ' ', $status)))
        );
    }
    
    protected function column_created_at($item) {
        $date = $item->processed_at ?: $item->created_at;
        return esc_html(date_i18n(get_option('date_format'), strtotime($date)));
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
        
        $per_page = 20;
        $current_page = $this->get_pagenum();
        $offset = ($current_page - 1) * $per_page;
        
        $status = isset($_GET['status']) ? sanitize_text_field($_GET['status']) : '';
        $orderby = isset($_GET['orderby']) ? sanitize_text_field($_GET['orderby']) : 'created_at';
        $order = isset($_GET['order']) ? sanitize_text_field($_GET['order']) : 'DESC';
        
        $table = $this->txn_handler->get_table_name();
        $subs_table = $wpdb->prefix . 'ytism_subs';
        
        $where = '';
        if ($status) {
            $where = $wpdb->prepare(" WHERE t.status = %s", $status);
        }
        
        $total_items = $wpdb->get_var("SELECT COUNT(*) FROM {$table} t{$where}");
        
        $items = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT t.*, s.gateway_sub_id, s.user_id 
                FROM {$table} t 
                LEFT JOIN {$subs_table} s ON t.sub_id = s.ID
                {$where} 
                ORDER BY t.{$orderby} {$order} 
                LIMIT %d OFFSET %d",
                $per_page,
                $offset
            )
        );
        
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
            <select name="status">
                <option value=""><?php esc_html_e('All Statuses', 'ytism'); ?></option>
                <option value="succeeded" <?php selected(isset($_GET['status']) ? $_GET['status'] : '', 'succeeded'); ?>><?php esc_html_e('Succeeded', 'ytism'); ?></option>
                <option value="pending" <?php selected(isset($_GET['status']) ? $_GET['status'] : '', 'pending'); ?>><?php esc_html_e('Pending', 'ytism'); ?></option>
                <option value="failed" <?php selected(isset($_GET['status']) ? $_GET['status'] : '', 'failed'); ?>><?php esc_html_e('Failed', 'ytism'); ?></option>
                <option value="refunded" <?php selected(isset($_GET['status']) ? $_GET['status'] : '', 'refunded'); ?>><?php esc_html_e('Refunded', 'ytism'); ?></option>
            </select>
            <?php submit_button(__('Filter', 'ytism'), '', 'filter_action', false); ?>
        </div>
        <?php
    }
}