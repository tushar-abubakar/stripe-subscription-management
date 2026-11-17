<?php
namespace YTISM\Admin;
use YTISM\Helpers\Functions;
use WP_List_Table;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Load WP_List_Table if not available
if ( ! class_exists( 'WP_List_Table' ) ) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class Payment_List_Table extends WP_List_Table {

    private $table_name;
    private $subscriptions_table_name;

    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'ytism_payments';
        $this->subscriptions_table_name = $wpdb->prefix . 'ytism_subscriptions';

        parent::__construct( array(
            'singular' => 'payment', // singular name of the listed records
            'plural'   => 'payments', // plural name of the listed records
            'ajax'     => false       // does this table support ajax?
        ) );
    }

    /**
     * Text displayed when no payment data is available
     */
    public function no_items() {
        _e( 'No payments found.', 'ytism' );
    }

    /**
     * Define the columns for the table.
     *
     * @return array
     */
    public function get_columns() {
        $columns = array(
            'cb'                => '<input type="checkbox" />', // Checkbox for bulk actions
            'ID'                => __( 'ID', 'ytism' ),
            'subscription_id'   => __( 'Subscription ID', 'ytism' ),
            'status'            => __( 'Status', 'ytism' ),
            'amount'            => __( 'Amount', 'ytism' ),
            'payment_type'      => __( 'Type', 'ytism' ),
            'transaction_id'    => __( 'Transaction ID', 'ytism' ),
            'processed_at'      => __( 'Processed At', 'ytism' ),
            'created_at'        => __( 'Created At', 'ytism' ),
        );
        return $columns;
    }

    /**
     * Define which columns are sortable.
     *
     * @return array
     */
    public function get_sortable_columns() {
        $sortable_columns = array(
            'ID'             => array( 'ID', false ),
            'subscription_id' => array( 'subscription_id', false ),
            'status'         => array( 'status', false ),
            'amount'         => array( 'amount', false ),
            'payment_type'   => array( 'payment_type', false ),
            'processed_at'   => array( 'processed_at', false ),
            'created_at'     => array( 'created_at', false ),
        );
        return $sortable_columns;
    }

    /**
     * Get default column value
     *
     * @param array $item        A singular item (one row of data).
     * @param string $column_name The name of the column to be processed.
     * @return string
     */
    protected function column_default( $item, $column_name ) {
        switch ( $column_name ) {
            case 'ID':
            case 'subscription_id':
            case 'status':
            case 'amount':
            case 'payment_type':
            case 'transaction_id':
            case 'processed_at':
            case 'created_at':
                return esc_html( $item[ $column_name ] );
            default:
                return print_r( $item, true ); // For debugging purposes
        }
    }

    /**
     * Handle the 'cb' (checkbox) column.
     *
     * @param array $item A singular item (one row of data).
     * @return string
     */
    protected function column_cb( $item ) {
        return sprintf(
            '<input type="checkbox" name="%1$s[]" value="%2$s" />',
            $this->_args['singular'],
            $item['ID']
        );
    }

    /**
     * Handle amount column
     */
    protected function column_amount( $item ) {
        return Functions::format_price($item['amount'], $item['currency']);
    }

    /**
     * Handle the 'subscription_id' column to make it a link.
     *
     * @param array $item A singular item (one row of data).
     * @return string
     */
    protected function column_subscription_id( $item ) {
        $subscription_id = esc_html( $item['subscription_id'] );
        $actions = array(
            'edit'   => sprintf( '<a href="%s">%s</a>',
                esc_url( add_query_arg( array( 'page' => 'ytism-subscriptions', 'action' => 'view', 'id' => $item['subscription_id'] ), admin_url( 'admin.php' ) ) ),
                __( 'View Subscription', 'ytism' )
            ),
            'delete' => sprintf( '<a href="%s" class="submitdelete" data-id="%d">%s</a>',
                wp_nonce_url( add_query_arg( array( 'action' => 'delete', 'payment' => $item['ID'] ), admin_url( 'admin.php?page=' . $_REQUEST['page'] ) ), 'ytism_delete_payment_' . $item['ID'] ),
                $item['ID'],
                __( 'Delete', 'ytism' )
            ),
        );

        return sprintf( '<strong>%1$s</strong> %2$s', $subscription_id, $this->row_actions( $actions ) );
    }

    /**
     * Define the bulk actions.
     *
     * @return array
     */
    protected function get_bulk_actions() {
        $actions = array(
            'delete' => __( 'Delete', 'ytism' ),
        );
        return $actions;
    }

    /**
     * Process bulk actions.
     */
    public function process_bulk_action() {
        global $wpdb;

        if ( 'delete' === $this->current_action() ) {
            check_admin_referer( 'bulk-' . $this->_args['plural'], '_wpnonce' );

            $payment_ids = isset( $_POST['payment'] ) ? array_map( 'absint', $_POST['payment'] ) : array();

            if ( ! empty( $payment_ids ) ) {
                $placeholders = implode( ', ', array_fill( 0, count( $payment_ids ), '%d' ) );
                $deleted      = $wpdb->query( $wpdb->prepare( "DELETE FROM {$this->table_name} WHERE ID IN ($placeholders)", $payment_ids ) );

                if ( $deleted ) {
                    /* translators: %d: number of payments deleted */
                    $this->admin_notice( sprintf( _n( '%d payment deleted.', '%d payments deleted.', $deleted, 'ytism' ), absint( $deleted ) ), 'success' );
                } else {
                    $this->admin_notice( __( 'Error deleting payments.', 'ytism' ), 'error' );
                }
            } else {
                $this->admin_notice( __( 'No payments selected for deletion.', 'ytism' ), 'warning' );
            }
        }

        // Handle single deletion
        if ( isset( $_GET['action'] ) && 'delete' === $_GET['action'] && isset( $_GET['payment'] ) ) {
            $payment_id = absint( $_GET['payment'] );
            if ( ! $payment_id ) {
                 $this->admin_notice( __( 'Invalid payment ID.', 'ytism' ), 'error' );
                 return;
            }
            check_admin_referer( 'ytism_delete_payment_' . $payment_id );

            $deleted = $wpdb->delete( $this->table_name, array( 'ID' => $payment_id ) );

            if ( $deleted ) {
                $this->admin_notice( __( '1 payment deleted.', 'ytism' ), 'success' );
            } else {
                $this->admin_notice( __( 'Error deleting payment.', 'ytism' ), 'error' );
            }
        }
    }

    /**
     * Helper for displaying admin notices.
     *
     * @param string $message The message to display.
     * @param string $type    The type of notice (e.g., 'success', 'error', 'warning').
     */
    private function admin_notice( $message, $type = 'info' ) {
        add_action( 'admin_notices', function() use ( $message, $type ) {
            printf( '<div class="notice notice-%1$s is-dismissible"><p>%2$s</p></div>', esc_attr( $type ), esc_html( $message ) );
        } );
    }

    /**
     * Get the current view (e.g., All, Active, Canceled).
     *
     * @return array
     */
    protected function get_views() {
        global $wpdb;

        $status_counts = $wpdb->get_results( "SELECT status, COUNT(ID) as count FROM {$this->table_name} GROUP BY status", ARRAY_A );
        $all_payments  = $wpdb->get_var( "SELECT COUNT(ID) FROM {$this->table_name}" );

        $views = array(
            'all' => sprintf( '<a href="%s"%s>%s <span class="count">(%s)</span></a>',
                esc_url( remove_query_arg( 'status', admin_url( 'admin.php?page=' . $_REQUEST['page'] ) ) ),
                empty( $_GET['status'] ) ? ' class="current"' : '',
                __( 'All', 'ytism' ),
                number_format_i18n( $all_payments )
            ),
        );

        foreach ( $status_counts as $status_data ) {
            $status_slug = esc_attr( $status_data['status'] );
            $status_name = ucwords( str_replace( '_', ' ', $status_slug ) ); // Nicer name for display

            $views[ $status_slug ] = sprintf( '<a href="%s"%s>%s <span class="count">(%s)</span></a>',
                esc_url( add_query_arg( 'status', $status_slug, admin_url( 'admin.php?page=' . $_REQUEST['page'] ) ) ),
                ( isset( $_GET['status'] ) && $_GET['status'] === $status_slug ) ? ' class="current"' : '',
                esc_html( $status_name ),
                number_format_i18n( $status_data['count'] )
            );
        }

        return $views;
    }

    /**
     * Prepares the list of items for displaying.
     */
    public function prepare_items() {
        global $wpdb;

        $per_page     = $this->get_items_per_page( 'payments_per_page', 20 );
        $current_page = $this->get_pagenum();
        $offset       = ( $current_page - 1 ) * $per_page;

        $this->process_bulk_action();

        $columns  = $this->get_columns();
        $hidden   = array(); // No hidden columns by default
        $sortable = $this->get_sortable_columns();

        $this->_column_headers = array( $columns, $hidden, $sortable );

        $where_clauses = array();
        $sql_params    = array();

        // Status filter
        if ( isset( $_GET['status'] ) && ! empty( $_GET['status'] ) ) {
            $status = sanitize_text_field( $_GET['status'] );
            $where_clauses[] = "status = %s";
            $sql_params[]    = $status;
        }

        // Search box
        if ( isset( $_REQUEST['s'] ) && ! empty( $_REQUEST['s'] ) ) {
            $search_term = '%' . $wpdb->esc_like( sanitize_text_field( $_REQUEST['s'] ) ) . '%';
            $where_clauses[] = "(ID LIKE %s OR subscription_id LIKE %s OR transaction_id LIKE %s OR status LIKE %s)";
            $sql_params[]    = $search_term;
            $sql_params[]    = $search_term;
            $sql_params[]    = $search_term;
            $sql_params[]    = $search_term;
        }

        $where_sql = count( $where_clauses ) > 0 ? 'WHERE ' . implode( ' AND ', $where_clauses ) : '';

        // Ordering
        $orderby = 'created_at';
        $order   = 'DESC';
        if ( ! empty( $_GET['orderby'] ) ) {
            $orderby = sanitize_sql_orderby( $_GET['orderby'] );
            // Ensure $orderby is a valid column to prevent SQL injection
            $valid_orderbys = array_keys( $this->get_sortable_columns() );
            if ( ! in_array( $orderby, $valid_orderbys ) ) {
                $orderby = 'created_at'; // Default back to safe column
            }
        }
        if ( ! empty( $_GET['order'] ) ) {
            $order = strtoupper( sanitize_text_field( $_GET['order'] ) );
            if ( ! in_array( $order, array( 'ASC', 'DESC' ) ) ) {
                $order = 'DESC';
            }
        }

        // --- Corrected queries to handle wpdb::prepare correctly ---

        // Query for items
        $query_items = "SELECT * FROM {$this->table_name} {$where_sql} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
        $params_items = array_merge( $sql_params, array( $per_page, $offset ) );

        if ( ! empty( $params_items ) ) {
            $this->items = $wpdb->get_results( $wpdb->prepare( $query_items, $params_items ), ARRAY_A );
        } else {
            // No parameters, so no need for prepare
            $this->items = $wpdb->get_results( $query_items, ARRAY_A );
        }


        // Query for total items
        $query_total = "SELECT COUNT(ID) FROM {$this->table_name} {$where_sql}";
        if ( ! empty( $sql_params ) ) {
            $total_items = $wpdb->get_var( $wpdb->prepare( $query_total, $sql_params ) );
        } else {
            // No parameters, so no need for prepare
            $total_items = $wpdb->get_var( $query_total );
        }


        $this->set_pagination_args( array(
            'total_items' => $total_items, //WE have to calculate the total number of items
            'per_page'    => $per_page,    //WE have to determine how many items to show on a page
            'total_pages' => ceil( $total_items / $per_page ) //WE have to calculate the total number of pages
        ) );
    }
}