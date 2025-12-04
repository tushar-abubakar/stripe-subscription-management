<?php 
namespace YTISM\Admin;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Load WP_List_Table if not available
if ( ! class_exists( 'WP_List_Table' ) ) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class Orders_List_Table extends \WP_List_Table {

    private $orders_data;
    private $total_items;
    private $per_page;
    private $current_page;
    private $search_query;

    public function __construct( $orders = [], $total = 0, $per_page = 20, $current_page = 1, $search = '' ) {
        parent::__construct([
            'singular' => 'order',
            'plural'   => 'orders',
            'ajax'     => false
        ]);

        $this->orders_data = $orders;
        $this->total_items = $total;
        $this->per_page = $per_page;
        $this->current_page = $current_page;
        $this->search_query = $search;
    }

    /**
     * Define table columns
     */
    public function get_columns() {
        return [
            'cb'              => '<input type="checkbox" />',
            'id'              => __( 'ID', 'ytism' ),
            'user'            => __( 'User', 'ytism' ),
            'subscription_id' => __( 'Subscription ID', 'ytism' ),
            'amount'          => __( 'Amount', 'ytism' ),
            'status'          => __( 'Status', 'ytism' ),
            'period_end'      => __( 'Period End', 'ytism' ),
            'metadata'        => __( 'Metadata', 'ytism' ),
            'created'         => __( 'Created', 'ytism' )
        ];
    }

    /**
     * Define sortable columns
     */
    public function get_sortable_columns() {
        return [
            'id'         => ['id', false],
            'amount'     => ['amount', false],
            'status'     => ['status', false],
            'period_end' => ['period_end', false],
            'created'    => ['created', true] // Default sort
        ];
    }

    /**
     * Define bulk actions
     */
    public function get_bulk_actions() {
        return [
            'bulk_delete' => __( 'Delete', 'ytism' )
        ];
    }

    /**
     * Render checkbox column
     */
    public function column_cb( $item ) {
        return sprintf(
            '<input type="checkbox" name="order_ids[]" value="%d" />',
            intval( $item->id )
        );
    }

    /**
     * Render ID column
     */
    public function column_id( $item ) {
        // Row actions
        $page = isset($_REQUEST['page']) ? $_REQUEST['page'] : '';
        $actions = [
            'view' => sprintf(
                '<a href="#" class="view-order-details" data-order-id="%d">%s</a>',
                intval( $item->id ),
                __( 'View Details', 'ytism' )
            ),
            'delete' => sprintf(
                '<a href="?page=%s&action=delete&order_id=%d&_wpnonce=%s" onclick="return confirm(\'%s\')">%s</a>',
                esc_attr( $page ),
                intval( $item->id ),
                wp_create_nonce( 'delete_order_' . $item->id ),
                esc_js( __( 'Are you sure you want to delete this order?', 'ytism' ) ),
                __( 'Delete', 'ytism' )
            )
        ];

        return sprintf(
            '<strong>%1$s</strong> %2$s',
            intval( $item->id ),
            $this->row_actions( $actions )
        );
    }

    /**
     * Render user column
     */
    public function column_user( $item ) {
        if ( !empty( $item->display_name ) ) {
            return sprintf(
                '<strong>%s</strong><br><small>%s</small><br><small>ID: %d</small>',
                esc_html( $item->display_name ),
                esc_html( $item->user_email ),
                intval( $item->user_id )
            );
        }
        return sprintf(
            '<em>%s</em><br><small>ID: %d</small>',
            __( 'User not found', 'ytism' ),
            intval( $item->user_id )
        );
    }

    /**
     * Render subscription ID column
     */
    public function column_subscription_id( $item ) {
        return sprintf(
            '<code>%s</code><br><small>Customer: <code>%s</code></small>',
            esc_html( $item->subscription_id ),
            esc_html( $item->customer_id )
        );
    }

    /**
     * Render amount column
     */
    public function column_amount( $item ) {
        return sprintf(
            '<strong>%s %s</strong><br><small>%s: %s</small>',
            number_format( floatval( $item->amount ), 2 ),
            strtoupper( $item->currency ),
            __( 'Payment', 'ytism' ),
            ucfirst( $item->payment_type )
        );
    }

    /**
     * Render status column
     */
    public function column_status( $item ) {
        $status_colors = [
            'active'      => '#46b450',
            'canceled'    => '#dc3232',
            'cancelled'   => '#dc3232',
            'incomplete'  => '#ffb900',
            'past_due'    => '#ff6900',
            'trialing'    => '#00a0d2',
            'unpaid'      => '#dc3232',
            'pending'     => '#ffb900'
        ];

        $color = isset( $status_colors[ $item->status ] ) ? $status_colors[ $item->status ] : '#666';
        $status_text = ucfirst( str_replace( '_', ' ', $item->status ) );

        return sprintf(
            '<span class="ytism-status-badge" style="background-color: %s; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: bold;">%s</span>',
            esc_attr( $color ),
            esc_html( $status_text )
        );
    }

    /**
     * Render period end column
     */
    public function column_period_end( $item ) {
        if ( !empty( $item->current_period_end ) ) {
            $timestamp = strtotime( $item->current_period_end );
            if ( $timestamp ) {
                $date = date_i18n( get_option( 'date_format' ), $timestamp );
                $time_diff = human_time_diff( $timestamp, current_time( 'timestamp' ) );
                
                if ( $timestamp > current_time( 'timestamp' ) ) {
                    return sprintf( '%s<br><small>%s %s</small>', $date, __( 'in', 'ytism' ), $time_diff );
                } else {
                    return sprintf( '%s<br><small>%s %s</small>', $date, $time_diff, __( 'ago', 'ytism' ) );
                }
            }
        }
        return '—';
    }

    /**
     * Render metadata column
     */
    public function column_metadata( $item ) {
        if ( empty( $item->metadata ) || $item->metadata === 'null' || $item->metadata === '{}' ) {
            return '<em>' . __( 'No metadata', 'ytism' ) . '</em>';
        }

        $formatted_metadata = $this->format_metadata( $item->metadata );
        
        // Generate unique function name for each row to avoid conflicts
        $unique_id = 'metadata_' . intval( $item->id );
        
        return sprintf(
            '<button type="button" class="button button-small toggle-metadata" data-order-id="%d" onclick="toggleMetadata_%d(event)">%s</button>
            <div id="metadata-%d" class="ytism-metadata-content" style="display: none;">
                <pre>%s</pre>
            </div>
            <script>
            function toggleMetadata_%d(event) {
                event.preventDefault();
                event.stopPropagation();
                var content = document.getElementById("metadata-%d");
                var button = event.target;
                if (content.style.display === "none" || content.style.display === "") {
                    content.style.display = "block";
                    button.textContent = "%s";
                } else {
                    content.style.display = "none";
                    button.textContent = "%s";
                }
            }
            </script>',
            intval( $item->id ),
            intval( $item->id ),
            __( 'View Metadata', 'ytism' ),
            intval( $item->id ),
            esc_html( $formatted_metadata ),
            intval( $item->id ),
            intval( $item->id ),
            __( 'Hide Metadata', 'ytism' ),
            __( 'View Metadata', 'ytism' )
        );
    }

    /**
     * Render created column
     */
    public function column_created( $item ) {
        $timestamp = strtotime( $item->created_at );
        $date = date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
        $time_diff = human_time_diff( $timestamp, current_time( 'timestamp' ) );
        
        return sprintf(
            '%s<br><small>%s %s</small>',
            $date,
            $time_diff,
            __( 'ago', 'ytism' )
        );
    }

    /**
     * Format metadata for display
     */
    private function format_metadata( $metadata ) {
        if ( empty( $metadata ) ) {
            return __( 'No metadata available', 'ytism' );
        }

        $decoded = json_decode( $metadata, true );
        if ( json_last_error() === JSON_ERROR_NONE ) {
            return json_encode( $decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE );
        }

        return $metadata;
    }

    /**
     * Default column renderer
     */
    public function column_default( $item, $column_name ) {
        switch ( $column_name ) {
            case 'provider':
                return esc_html( $item->provider );
            case 'payment_type':
                return esc_html( ucfirst( $item->payment_type ) );
            default:
                return isset( $item->$column_name ) ? esc_html( $item->$column_name ) : '';
        }
    }

    /**
     * Prepare items for display
     */
    public function prepare_items() {
        // Set column headers
        $columns = $this->get_columns();
        $hidden = [];
        $sortable = $this->get_sortable_columns();
        $this->_column_headers = [$columns, $hidden, $sortable];

        // Set the items
        $this->items = $this->orders_data;

        // Set pagination
        $this->set_pagination_args([
            'total_items' => $this->total_items,
            'per_page'    => $this->per_page,
            'total_pages' => ceil( $this->total_items / $this->per_page )
        ]);
    }

    /**
     * Display when no items found
     */
    public function no_items() {
        if ( $this->search_query ) {
            /* translators: %s: search term entered by the user */ 
            printf( esc_html__( 'No orders found matching "%s".', 'ytism' ), '<strong>' . esc_html( $this->search_query ) . '</strong>' );
        } else {
            esc_html_e( 'No subscription orders found.', 'ytism' );
        }
    }


    /**
     * Generate the table navigation above or below the table
     */
    protected function display_tablenav( $which ) {
        if ( 'top' === $which ) {
            wp_nonce_field( 'bulk-' . $this->_args['plural'] );
        }
        ?>
        <div class="tablenav <?php echo esc_attr( $which ); ?>">

            <?php if ( $this->has_items() ): ?>
            <div class="alignleft actions bulkactions">
                <?php $this->bulk_actions( $which ); ?>
            </div>
            <?php 
            endif;
            
            $this->extra_tablenav( $which );
            $this->pagination( $which );
            ?>

            <br class="clear" />
        </div>
        <?php
    }

    /**
     * Extra controls to be displayed between bulk actions and pagination
     */
    protected function extra_tablenav( $which ) {
        if ( 'top' === $which ) {
            ?>
            <div class="alignleft actions">
                <?php
                // Add any extra controls here if needed
                ?>
            </div>
            <?php
        }
    }

    /**
     * Get current page number
     */
    public function get_pagenum() {
        $pagenum = isset( $_REQUEST['paged'] ) ? absint( $_REQUEST['paged'] ) : 0;

        if ( isset( $this->_pagination_args['total_pages'] ) && $pagenum > $this->_pagination_args['total_pages'] ) {
            $pagenum = $this->_pagination_args['total_pages'];
        }

        return max( 1, $pagenum );
    }

    /**
     * Display the pagination
     */
    protected function pagination( $which ) {
        if ( empty( $this->_pagination_args ) ) {
            return;
        }

        $total_items     = intval( $this->_pagination_args['total_items'] );
        $total_pages     = intval( $this->_pagination_args['total_pages'] );
        $infinite_scroll = false;
        if ( isset( $this->_pagination_args['infinite_scroll'] ) ) {
            $infinite_scroll = $this->_pagination_args['infinite_scroll'];
        }

        if ( 'top' === $which && $total_pages > 1 ) {
            $this->screen->render_screen_reader_content( 'heading_pagination' );
        }

        $output = '<span class="displaying-num">' . sprintf(
            /* translators: %s: Number of items. */
            _n( '%s item', '%s items', $total_items, 'ytism' ),
            number_format_i18n( $total_items )
        ) . '</span>';

        $current              = $this->get_pagenum();
        $removable_query_args = wp_removable_query_args();

        $current_url = set_url_scheme( 'http://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'] );
        $current_url = remove_query_arg( $removable_query_args, $current_url );

        $page_links = array();

        $total_pages_before = '<span class="paging-input">';
        $total_pages_after  = '</span></span>';

        $disable_first = $disable_last = $disable_prev = $disable_next = false;

        if ( $current == 1 ) {
            $disable_first = true;
            $disable_prev  = true;
        }
        if ( $current == $total_pages ) {
            $disable_last = true;
            $disable_next = true;
        }

        if ( $disable_first ) {
            $page_links[] = '<span class="tablenav-pages-navspan button disabled" aria-hidden="true">&laquo;</span>';
        } else {
            $page_links[] = sprintf(
                "<a class='first-page button' href='%s'><span class='screen-reader-text'>%s</span><span aria-hidden='true'>%s</span></a>",
                esc_url( remove_query_arg( 'paged', $current_url ) ),
                __( 'First page', 'ytism' ),
                '&laquo;'
            );
        }

        if ( $disable_prev ) {
            $page_links[] = '<span class="tablenav-pages-navspan button disabled" aria-hidden="true">&lsaquo;</span>';
        } else {
            $page_links[] = sprintf(
                "<a class='prev-page button' href='%s'><span class='screen-reader-text'>%s</span><span aria-hidden='true'>%s</span></a>",
                esc_url( add_query_arg( 'paged', max( 1, $current - 1 ), $current_url ) ),
                __( 'Previous page', 'ytism' ),
                '&lsaquo;'
            );
        }

        if ( 'bottom' === $which ) {
            $html_current_page  = $current;
            $total_pages_before = '<span class="screen-reader-text">' . __( 'Current Page', 'ytism' ) . '</span><span id="table-paging" class="paging-input"><span class="tablenav-paging-text">';
        } else {
            $html_current_page = sprintf(
                "%s<input class='current-page' id='current-page-selector' type='text' name='paged' value='%s' size='%d' aria-describedby='table-paging' /><span class='tablenav-paging-text'>",
                '<label for="current-page-selector" class="screen-reader-text">' . __( 'Current Page', 'ytism' ) . '</label>',
                $current,
                strlen( $total_pages )
            );
        }
        $html_total_pages = sprintf( "<span class='total-pages'>%s</span>", number_format_i18n( $total_pages ) );
        $page_links[]     = $total_pages_before . sprintf(
            /* translators: 1: Current page, 2: Total pages. */
            _x( '%1$s of %2$s', 'paging', 'ytism' ),
            $html_current_page,
            $html_total_pages
        ) . $total_pages_after;

        if ( $disable_next ) {
            $page_links[] = '<span class="tablenav-pages-navspan button disabled" aria-hidden="true">&rsaquo;</span>';
        } else {
            $page_links[] = sprintf(
                "<a class='next-page button' href='%s'><span class='screen-reader-text'>%s</span><span aria-hidden='true'>%s</span></a>",
                esc_url( add_query_arg( 'paged', min( $total_pages, $current + 1 ), $current_url ) ),
                __( 'Next page', 'ytism' ),
                '&rsaquo;'
            );
        }

        if ( $disable_last ) {
            $page_links[] = '<span class="tablenav-pages-navspan button disabled" aria-hidden="true">&raquo;</span>';
        } else {
            $page_links[] = sprintf(
                "<a class='last-page button' href='%s'><span class='screen-reader-text'>%s</span><span aria-hidden='true'>%s</span></a>",
                esc_url( add_query_arg( 'paged', $total_pages, $current_url ) ),
                __( 'Last page', 'ytism' ),
                '&raquo;'
            );
        }

        $pagination_links_class = 'pagination-links';
        if ( ! empty( $infinite_scroll ) ) {
            $pagination_links_class .= ' hide-if-js';
        }
        $output .= "\n<span class='$pagination_links_class'>" . implode( "\n", $page_links ) . '</span>';

        if ( $total_pages ) {
            $page_class = $total_pages < 2 ? ' one-page' : '';
        } else {
            $page_class = ' no-pages';
        }
        $this->_pagination = "<div class='tablenav-pages{$page_class}'>$output</div>";

        echo $this->_pagination;
    }
}