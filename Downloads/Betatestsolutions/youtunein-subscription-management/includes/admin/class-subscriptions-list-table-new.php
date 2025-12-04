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


class Subscriptions_List_Table_New extends \WP_List_Table {
    
    private $sub_handler;
    
    public function __construct() {
        parent::__construct([
            'singular' => __( 'Subscription', 'ytism' ),
            'plural'   => __( 'Subscriptions', 'ytism' ),
            'ajax'     => false
        ]);
        
        $this->sub_handler = new Subscription_Handler();

        $this->_column_headers = [
            $this->get_columns(),
            [],
            $this->get_sortable_columns(),
            $this->get_primary_column_name()
        ];
    }
    
    public function get_columns() {
        return [
            'cb'            => '<input type="checkbox" />',
            'id'            => __( 'ID', 'ytism' ),
            'user'          => __( 'User', 'ytism' ),
            'gateway'       => __( 'Gateway', 'ytism' ),
            'plan'          => __( 'Plan', 'ytism' ),
            'status'        => __( 'Status', 'ytism' ),
            'next_billing'  => __( 'Next Billing', 'ytism' ),
            'created'       => __( 'Created', 'ytism' ),
        ];
    }
    
    protected function get_sortable_columns() {
        return [
            'id'            => [ 'ID', false ],
            'status'        => [ 'status', false ],
            'next_billing'  => [ 'next_billing_at', false ],
            'created'       => [ 'created_at', true ],
        ];
    }
    
    protected function get_bulk_actions() {
        return [
            'cancel' => __( 'Cancel', 'ytism' ),
        ];
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
        
    protected function column_cb( $item ) {
        return sprintf( '<input type="checkbox" name="subscription[]" value="%s" />', $item->ID );
    }
    
    protected function column_id( $item ) {
        $view_url = add_query_arg([
            'page'   => 'ytism-subscription-view',
            'id'     => $item->ID,
        ], admin_url('admin.php'));
        
        $actions = [
            'view' => sprintf(
                '<a href="%s">%s</a>',
                esc_url($view_url),
                __('View Timeline', 'ytism')
            ),
        ];
        
        return sprintf(
            '<strong>#%d</strong> %s',
            $item->ID,
            $this->row_actions($actions)
        );
    }
    
    protected function column_user( $item ) {
        $user = get_user_by( 'id', $item->user_id );
        if ( ! $user ) {
            return __( 'Unknown', 'ytism' );
        }
        
        return sprintf(
            '<a href="%s">%s</a><br><small>%s</small>',
            get_edit_user_link( $item->user_id ),
            esc_html( $user->display_name ),
            esc_html( $user->user_email )
        );
    }
    
    protected function column_gateway( $item ) {
        return sprintf(
            '<strong>%s</strong><br><small>%s</small>',
            esc_html( ucfirst( $item->gateway ) ),
            esc_html( $item->gateway_sub_id )
        );
    }
    
    protected function column_plan( $item ) {
        return $item->plan_id ? esc_html( $item->plan_id ) : '-';
    }
    
    protected function column_status( $item ) {
        $class_map = [
            'active'    => 'success',
            'trialing'  => 'info',
            'canceled'  => 'error',
            'expired'   => 'error',
            'past_due'  => 'warning',
            'paused'    => 'warning',
        ];
        
        $class = isset( $class_map[ $item->status ] ) ? $class_map[ $item->status ] : 'default';
        
        return sprintf(
            '<span class="ytism-badge ytism-badge-%s">%s</span>',
            esc_attr( $class ),
            esc_html( ucfirst( str_replace( '_', ' ', $item->status ) ) )
        );
    }
    
    protected function column_next_billing( $item ) {
        if ( ! $item->next_billing_at ) {
            return '-';
        }
        
        return esc_html( date_i18n( get_option('date_format'), strtotime( $item->next_billing_at ) ) );
    }
    
    protected function column_created( $item ) {
        return esc_html( date_i18n( get_option('date_format'), strtotime( $item->created_at ) ) );
    }
    
    public function prepare_items() {
        global $wpdb;
        
        $table = $this->sub_handler->get_table_name();
        
        // Simple query without pagination first
        $items = $wpdb->get_results("SELECT * FROM {$table} ORDER BY ID DESC LIMIT 20");
        
        $this->items = $items;
        
        $this->set_pagination_args([
            'total_items' => count($items),
            'per_page'    => 20,
        ]);
    }
    
    protected function extra_tablenav( $which ) {
        if ( $which !== 'top' ) {
            return;
        }
        ?>
        <div class="alignleft actions">
            <select name="status">
                <option value=""><?php esc_html_e( 'All Statuses', 'ytism' ); ?></option>
                <option value="active" <?php selected( isset( $_GET['status'] ) ? $_GET['status'] : '', 'active' ); ?>><?php esc_html_e( 'Active', 'ytism' ); ?></option>
                <option value="trialing" <?php selected( isset( $_GET['status'] ) ? $_GET['status'] : '', 'trialing' ); ?>><?php esc_html_e( 'Trialing', 'ytism' ); ?></option>
                <option value="canceled" <?php selected( isset( $_GET['status'] ) ? $_GET['status'] : '', 'canceled' ); ?>><?php esc_html_e( 'Canceled', 'ytism' ); ?></option>
                <option value="past_due" <?php selected( isset( $_GET['status'] ) ? $_GET['status'] : '', 'past_due' ); ?>><?php esc_html_e( 'Past Due', 'ytism' ); ?></option>
            </select>
            <?php submit_button( __( 'Filter', 'ytism' ), '', 'filter_action', false ); ?>
        </div>
        <?php
    }
    
    public function single_row( $item ) {
        echo '<tr class="ytism-row" data-id="' . esc_attr( $item->ID ) . '">';
        $this->single_row_columns( $item );
        echo '</tr>';
        
        // Hidden detail row
        $column_count = count( $this->get_columns() );
        
        echo '<tr class="ytism-detail-row" id="ytism-detail-' . esc_attr( $item->ID ) . '" style="display:none;">';
        echo '<td colspan="' . esc_attr( $column_count ) . '" class="ytism-detail-cell">';
        
        if ( $this instanceof Subscriptions_List_Table ) {
            $this->render_subscription_details( $item );
        } elseif ( $this instanceof Transactions_List_Table ) {
            $this->render_transaction_details( $item );
        }
        
        echo '</td>';
        echo '</tr>';
    }

    private function render_transaction_details( $txn ) {
        $gateway_data = ! empty( $txn->gateway_data ) ? json_decode( $txn->gateway_data, true ) : [];
        ?>
        <div class="ytism-details">
            <div class="ytism-details-grid">
                <div class="ytism-details-section">
                    <h3><?php esc_html_e( 'Transaction Details', 'ytism' ); ?></h3>
                    <table class="form-table">
                        <tr>
                            <th><?php esc_html_e( 'Transaction ID', 'ytism' ); ?></th>
                            <td><code><?php echo esc_html( $txn->gateway_txn_id ); ?></code></td>
                        </tr>
                        <?php if ( $txn->gateway_intent_id ) : ?>
                        <tr>
                            <th><?php esc_html_e( 'Intent ID', 'ytism' ); ?></th>
                            <td><code><?php echo esc_html( $txn->gateway_intent_id ); ?></code></td>
                        </tr>
                        <?php endif; ?>
                        <tr>
                            <th><?php esc_html_e( 'Payment Method', 'ytism' ); ?></th>
                            <td><?php echo esc_html( $txn->payment_method_id ?: '-' ); ?></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e( 'Amount', 'ytism' ); ?></th>
                            <td><strong><?php echo esc_html( number_format( $txn->amount, 2 ) . ' ' . strtoupper( $txn->currency ) ); ?></strong></td>
                        </tr>
                        <?php if ( $txn->retry_count > 0 ) : ?>
                        <tr>
                            <th><?php esc_html_e( 'Retry Count', 'ytism' ); ?></th>
                            <td><span class="ytism-badge ytism-badge-warning"><?php echo esc_html( $txn->retry_count ); ?></span></td>
                        </tr>
                        <?php endif; ?>
                    </table>
                </div>
                
                <?php if ( $txn->status === 'failed' && ( $txn->error_code || $txn->error_message ) ) : ?>
                <div class="ytism-details-section">
                    <h3><?php esc_html_e( 'Error Information', 'ytism' ); ?></h3>
                    <table class="form-table">
                        <?php if ( $txn->error_code ) : ?>
                        <tr>
                            <th><?php esc_html_e( 'Error Code', 'ytism' ); ?></th>
                            <td><code><?php echo esc_html( $txn->error_code ); ?></code></td>
                        </tr>
                        <?php endif; ?>
                        <?php if ( $txn->error_message ) : ?>
                        <tr>
                            <th><?php esc_html_e( 'Error Message', 'ytism' ); ?></th>
                            <td><?php echo esc_html( $txn->error_message ); ?></td>
                        </tr>
                        <?php endif; ?>
                    </table>
                </div>
                <?php endif; ?>
            </div>
            
            <?php if ( ! empty( $gateway_data ) ) : ?>
            <div class="ytism-details-section">
                <h3><?php esc_html_e( 'Gateway Response', 'ytism' ); ?></h3>
                <pre class="ytism-json-data"><?php echo esc_html( json_encode( $gateway_data, JSON_PRETTY_PRINT ) ); ?></pre>
            </div>
            <?php endif; ?>
        </div>
        <?php
    }
    
    private function render_subscription_details( $sub ) {
        $timeline = $this->sub_handler->get_timeline( $sub->ID );
        $txn_handler = new Transaction_Handler();
        $stats = $txn_handler->get_subscription_stats( $sub->ID );
        ?>
        <div class="ytism-details">
            <div class="ytism-details-grid">
                <!-- Subscription info section stays the same -->
                
                <div class="ytism-details-section">
                    <h3><?php esc_html_e( 'Statistics', 'ytism' ); ?></h3>
                    <table class="form-table">
                        <tr>
                            <th><?php esc_html_e( 'Total Transactions', 'ytism' ); ?></th>
                            <td><?php echo esc_html( $stats->total_transactions ); ?></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e( 'Successful', 'ytism' ); ?></th>
                            <td><span class="ytism-badge ytism-badge-success"><?php echo esc_html( $stats->successful ); ?></span></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e( 'Failed', 'ytism' ); ?></th>
                            <td><span class="ytism-badge ytism-badge-error"><?php echo esc_html( $stats->failed ); ?></span></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e( 'Total Revenue', 'ytism' ); ?></th>
                            <td><strong><?php echo esc_html( number_format( $stats->total_revenue, 2 ) ); ?></strong></td>
                        </tr>
                    </table>
                </div>
            </div>
            
            <!-- Timeline section stays the same -->
        </div>
        <?php
    }
}