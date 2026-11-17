<?php
namespace YTISM\Admin;
use WP_List_Table;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Load WP_List_Table if not available
if ( ! class_exists( 'WP_List_Table' ) ) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class Subscription_List_Table extends WP_List_Table {
    
    private $subscriptions_db;
    private $events_db;
    
    public function __construct() {
        parent::__construct([
            'singular' => __('Subscription', 'ytism'),
            'plural'   => __('Subscriptions', 'ytism'),
            'ajax'     => false
        ]);
        
        $this->subscriptions_db = \YTISM\Database\Factory::subscription();
        $this->events_db = \YTISM\Database\Factory::event();
    }
    
    public function get_columns() {
        return [
            'cb' => '<input type="checkbox" />',
            'ID' => __('ID', 'ytism'),
            'user' => __('User', 'ytism'),
            'status' => __('Status', 'ytism'),
            'gateway_subscription_id' => __('Stripe ID', 'ytism'),
            'amount' => __('Amount', 'ytism'),
            'billing' => __('Billing', 'ytism'),
            'period' => __('Current Period', 'ytism'),
            'created_at' => __('Created', 'ytism'),
            'actions' => __('Actions', 'ytism')
        ];
    }
    
    protected function get_sortable_columns() {
        return [
            'ID' => ['ID', false],
            'status' => ['status', false],
            'amount' => ['amount', false],
            'created_at' => ['created_at', true]
        ];
    }
    
    protected function get_bulk_actions() {
        return [
            'cancel' => __('Cancel Subscriptions', 'ytism'),
            'export' => __('Export', 'ytism')
        ];
    }

    /**
     * Get default column value
     *
     * @param array $item        A singular item (one row of data).
     * @param string $column_name The name of the column to be processed.
     * @return string
     */
    
    protected function column_cb($item) {
        return sprintf('<input type="checkbox" name="subscription[]" value="%d" />', $item->ID);
    }

    protected function column_ID($item) {
        return sprintf(
            '<strong><a href="%s">%d</a></strong>',
            admin_url('admin.php?page=ytism-subscriptions&action=view&id=' . $item->ID),
            $item->ID
        );
    }
    
    protected function column_user($item) {
        $user = get_user_by('ID', $item->user_id);
        if ($user) {
            $avatar = get_avatar($user->ID, 32);
            $edit_link = get_edit_user_link($user->ID);
            return sprintf(
                '%s <div class="ytism-user-info"><strong><a href="%s">%s</a></strong><br><small>%s</small></div>',
                $avatar,
                $edit_link,
                esc_html($user->display_name),
                esc_html($user->user_email)
            );
        }
        return __('Unknown User', 'ytism');
    }
    
    protected function column_status($item) {
        $status_colors = [
            'active' => '#10b981',
            'trialing' => '#3b82f6',
            'past_due' => '#f59e0b',
            'canceled' => '#ef4444',
            'incomplete' => '#6b7280',
            'expired' => '#991b1b',
            'paused' => '#8b5cf6'
        ];
        
        $color = $status_colors[$item->status] ?? '#6b7280';
        $status_text = ucfirst(str_replace('_', ' ', $item->status));
        
        $html = sprintf(
            '<span class="ytism-status-badge" style="background-color: %s;">%s</span>',
            $color,
            esc_html($status_text)
        );
        
        if ($item->cancel_at_period_end) {
            $html .= '<br><small style="color: #f59e0b;">' . __('Cancels at period end', 'ytism') . '</small>';
        }
        
        if ($item->failed_payment_count > 0) {
            $html .= sprintf(
                '<br><small style="color: #ef4444;">%s</small>',
                sprintf(__('%d failed payments', 'ytism'), $item->failed_payment_count)
            );
        }
        
        return $html;
    }
    
    protected function column_amount($item) {
        return sprintf(
            '<strong>%s %s</strong><br><small>%s</small>',
            $item->currency,
            number_format($item->amount, 2),
            $this->format_billing_period($item->billing_period, $item->billing_interval)
        );
    }
    
    protected function column_billing($item) {
        $next_payment = '';
        if (in_array($item->status, ['active', 'trialing', 'past_due'])) {
            $next_payment = sprintf(
                '<br><small>Next: %s</small>',
                date_i18n(get_option('date_format'), strtotime($item->current_period_end))
            );
        }
        
        return sprintf(
            '%s%s',
            $this->format_billing_period($item->billing_period, $item->billing_interval),
            $next_payment
        );
    }
    
    protected function column_period($item) {
        return sprintf(
            '<small>%s<br>to<br>%s</small>',
            date_i18n('M j, Y', strtotime($item->current_period_start)),
            date_i18n('M j, Y', strtotime($item->current_period_end))
        );
    }
    
    protected function column_gateway_subscription_id($item) {
        if ($item->gateway_subscription_id) {
            $stripe_url = 'https://dashboard.stripe.com/subscriptions/' . $item->gateway_subscription_id;
            return sprintf(
                '<a href="%s" target="_blank" title="View in Stripe">%s <span class="dashicons dashicons-external"></span></a>',
                $stripe_url,
                substr($item->gateway_subscription_id, 0, 20) . '...'
            );
        }
        return '—';
    }
    
    protected function column_created_at($item) {
        $date = date_i18n(get_option('date_format'), strtotime($item->created_at));
        $time = date_i18n(get_option('time_format'), strtotime($item->created_at));
        return sprintf('<small>%s<br>%s</small>', $date, $time);
    }
    
    protected function column_actions($item) {
        $actions = [];
        
        // View details
        $actions[] = sprintf(
            '<a href="%s" class="button button-small">%s</a>',
            admin_url('admin.php?page=ytism-subscriptions&action=view&id=' . $item->ID),
            __('View', 'ytism')
        );
        
        // View payments
        $actions[] = sprintf(
            '<a href="%s" class="button button-small">%s</a>',
            admin_url('admin.php?page=ytism-payments&subscription_id=' . $item->ID),
            __('Payments', 'ytism')
        );
        
        // Cancel subscription (if active)
        if (in_array($item->status, ['active', 'trialing', 'past_due'])) {
            $actions[] = sprintf(
                '<a href="%s" class="button button-small button-link-delete" onclick="return confirm(\'%s\')">%s</a>',
                wp_nonce_url(
                    admin_url('admin.php?page=ytism-subscriptions&action=cancel&id=' . $item->ID),
                    'cancel-subscription-' . $item->ID
                ),
                esc_js(__('Are you sure you want to cancel this subscription?', 'ytism')),
                __('Cancel', 'ytism')
            );
        }
        
        return implode(' ', $actions);
    }
    
    public function prepare_items() {
        $columns = $this->get_columns();
        $hidden = get_hidden_columns($this->screen);
        $sortable = $this->get_sortable_columns();
        
        $this->_column_headers = [$columns, $hidden, $sortable];
        
        $per_page = $this->get_items_per_page('subscriptions_per_page', 20);
        $current_page = $this->get_pagenum();
        
        // Handle filters
        $where = $this->build_where_clause();
        
        // Get total items
        $total_items = $this->subscriptions_db->count($where);
        
        // Get items for current page
        $orderby = !empty($_GET['orderby']) ? sanitize_text_field($_GET['orderby']) : 'created_at';
        $order = !empty($_GET['order']) ? sanitize_text_field($_GET['order']) : 'DESC';
        
        $this->items = $this->subscriptions_db->get_records([
            'where' => $where,
            'orderby' => $orderby,
            'order' => $order,
            'limit' => $per_page,
            'offset' => ($current_page - 1) * $per_page
        ]);
        
        $this->set_pagination_args([
            'total_items' => $total_items,
            'per_page' => $per_page,
            'total_pages' => ceil($total_items / $per_page)
        ]);
    }
    
    protected function extra_tablenav($which) {
        if ($which === 'top') {
            ?>
            <div class="alignleft actions">
                <select name="status_filter">
                    <option value=""><?php _e('All Statuses', 'ytism'); ?></option>
                    <option value="active" <?php selected($_GET['status_filter'] ?? '', 'active'); ?>><?php _e('Active', 'ytism'); ?></option>
                    <option value="trialing" <?php selected($_GET['status_filter'] ?? '', 'trialing'); ?>><?php _e('Trialing', 'ytism'); ?></option>
                    <option value="past_due" <?php selected($_GET['status_filter'] ?? '', 'past_due'); ?>><?php _e('Past Due', 'ytism'); ?></option>
                    <option value="canceled" <?php selected($_GET['status_filter'] ?? '', 'canceled'); ?>><?php _e('Canceled', 'ytism'); ?></option>
                    <option value="incomplete" <?php selected($_GET['status_filter'] ?? '', 'incomplete'); ?>><?php _e('Incomplete', 'ytism'); ?></option>
                </select>
                
                <input type="text" name="search" placeholder="<?php _e('Search by user or subscription ID', 'ytism'); ?>" value="<?php echo esc_attr($_GET['search'] ?? ''); ?>">
                
                <?php submit_button(__('Filter', 'ytism'), 'button', 'filter_action', false); ?>
                
                <?php if (!empty($_GET['status_filter']) || !empty($_GET['search'])) : ?>
                    <a href="<?php echo admin_url('admin.php?page=ytism-subscriptions'); ?>" class="button"><?php _e('Clear', 'ytism'); ?></a>
                <?php endif; ?>
            </div>
            <?php
        }
    }
    
    private function build_where_clause() {
        global $wpdb;
        $where = [];
        
        // Status filter
        if (!empty($_GET['status_filter'])) {
            $status = sanitize_text_field($_GET['status_filter']);
            $where[] = $wpdb->prepare("status = %s", $status);
        }
        
        // Search
        if (!empty($_GET['search'])) {
            $search = '%' . $wpdb->esc_like($_GET['search']) . '%';
            $where[] = $wpdb->prepare(
                "(gateway_subscription_id LIKE %s OR user_id IN (SELECT ID FROM {$wpdb->users} WHERE user_email LIKE %s OR display_name LIKE %s))",
                $search, $search, $search
            );
        }
        
        // Subscription ID filter (from payments page)
        if (!empty($_GET['subscription_id'])) {
            $where[] = $wpdb->prepare("ID = %d", intval($_GET['subscription_id']));
        }
        
        return !empty($where) ? implode(' AND ', $where) : '';
    }
    
    private function format_billing_period($period, $interval) {
        $periods = [
            'day' => _n('day', 'days', $interval, 'ytism'),
            'week' => _n('week', 'weeks', $interval, 'ytism'),
            'month' => _n('month', 'months', $interval, 'ytism'),
            'quarter' => _n('quarter', 'quarters', $interval, 'ytism'),
            'year' => _n('year', 'years', $interval, 'ytism')
        ];
        
        $period_text = $periods[$period] ?? $period;
        
        if ($interval > 1) {
            return sprintf(__('Every %d %s', 'ytism'), $interval, $period_text);
        }
        
        return sprintf(__('Every %s', 'ytism'), $period_text);
    }
}