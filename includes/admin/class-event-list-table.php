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

class Event_List_Table extends WP_List_Table {

}