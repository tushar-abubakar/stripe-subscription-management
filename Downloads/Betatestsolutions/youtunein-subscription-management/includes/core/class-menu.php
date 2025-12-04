<?php
/**
 * Add custom menu features: icons and visibility
 *
 * @package Ytism
 */

namespace YTISM\Core;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Menu Class
 */
class Menu {

	/**
	 * Constructor
	 */
	public function __construct() {
	}

	/**
	 * Initialize hooks
	 */
	public function init() {
		// Admin hooks.
		add_action( 'wp_nav_menu_item_custom_fields', [ $this, 'add_custom_fields' ], 10, 2 );
		add_action( 'wp_update_nav_menu_item', [ $this, 'save_custom_fields' ], 10, 2 );

		// Frontend hooks.
		add_filter( 'wp_nav_menu_objects', [ $this, 'filter_by_visibility' ], 10 );
		add_filter( 'walker_nav_menu_start_el', [ $this, 'add_icon' ], 10, 4 );
		add_filter( 'nav_menu_css_class', [ $this, 'add_css_classes' ], 10, 2 );
		add_filter( 'wp_setup_nav_menu_item', [ $this, 'setup_logout_url' ] );

		// Admin styles and scripts.
		add_action( 'admin_head-nav-menus.php', [ $this, 'admin_head' ] );
		add_action( 'admin_footer-nav-menus.php', [ $this, 'admin_footer' ] );
	}

	/**
	 * Add custom fields to menu items
	 *
	 * @param int    $item_id Menu item ID.
	 * @param object $item    Menu item object.
	 * @return void
	 */
	public function add_custom_fields( $item_id, $item ) {
		$icon         = get_post_meta( $item_id, '_ytism_icon', true );
		$visibility   = get_post_meta( $item_id, '_ytism_visibility', true ) ?: 'all';
		$is_logout    = get_post_meta( $item_id, '_ytism_logout_link', true );
		$redirect_opt = get_post_meta( $item_id, '_ytism_logout_redirect', true ) ?: 'current';
		?>
		<p class="field-ytism-icon description description-wide">
			<label for="ytism-icon-<?php echo esc_attr( $item_id ); ?>">
				<?php esc_html_e( 'Icon Class', 'ytism' ); ?><br>
				<input 
					type="text" 
					id="ytism-icon-<?php echo esc_attr( $item_id ); ?>" 
					name="ytism_icon[<?php echo esc_attr( $item_id ); ?>]" 
					class="widefat ytism-icon-field" 
					value="<?php echo esc_attr( $icon ); ?>" 
					placeholder="<?php esc_attr_e( 'e.g., dashicons-admin-home or fas fa-home', 'ytism' ); ?>"
				/>
				<span class="description"><?php esc_html_e( 'Enter icon class name directly (Ytism icon without prefix or Font Awesome with prefix)', 'ytism' ); ?></span>
			</label>
		</p>
		
		<p class="field-ytism-visibility description description-wide">
			<label for="ytism-visibility-<?php echo esc_attr( $item_id ); ?>">
				<?php esc_html_e( 'Visibility', 'ytism' ); ?><br>
				<select 
					id="ytism-visibility-<?php echo esc_attr( $item_id ); ?>" 
					name="ytism_visibility[<?php echo esc_attr( $item_id ); ?>]" 
					class="widefat ytism-visibility-field"
				>
					<option value="all" <?php selected( $visibility, 'all' ); ?>><?php esc_html_e( 'Everyone', 'ytism' ); ?></option>
					<option value="logged_in" <?php selected( $visibility, 'logged_in' ); ?>><?php esc_html_e( 'Logged In Only', 'ytism' ); ?></option>
					<option value="logged_out" <?php selected( $visibility, 'logged_out' ); ?>><?php esc_html_e( 'Logged Out Only', 'ytism' ); ?></option>
				</select>
			</label>
		</p>
		
		<p class="field-ytism-logout description description-wide">
			<label for="ytism-logout-<?php echo esc_attr( $item_id ); ?>">
				<input 
					type="checkbox" 
					id="ytism-logout-<?php echo esc_attr( $item_id ); ?>" 
					name="ytism_logout_link[<?php echo esc_attr( $item_id ); ?>]" 
					class="ytism-logout-checkbox" 
					value="1"
					<?php checked( $is_logout, '1' ); ?>
				/>
				<?php esc_html_e( 'Make this a logout link', 'ytism' ); ?>
			</label>
			<br>
			<div class="ytism-logout-options" style="margin-top: 10px; <?php echo $is_logout ? '' : 'display:none;'; ?>">
				<label for="ytism-logout-redirect-<?php echo esc_attr( $item_id ); ?>">
					<?php esc_html_e( 'After logout redirect to:', 'ytism' ); ?><br>
					<select 
						id="ytism-logout-redirect-<?php echo esc_attr( $item_id ); ?>" 
						name="ytism_logout_redirect[<?php echo esc_attr( $item_id ); ?>]" 
						class="widefat ytism-logout-redirect-field"
					>
						<option value="current" <?php selected( $redirect_opt, 'current' ); ?>><?php esc_html_e( 'Current Page', 'ytism' ); ?></option>
						<option value="home" <?php selected( $redirect_opt, 'home' ); ?>><?php esc_html_e( 'Homepage', 'ytism' ); ?></option>
					</select>
				</label>
			</div>
		</p>
		<?php
	}

	/**
	 * Save custom fields
	 */
	public function save_custom_fields( $menu_id, $menu_item_db_id ) {
		// Save icon.
		if ( isset( $_POST['ytism_icon'][ $menu_item_db_id ] ) ) {
			$icon = sanitize_text_field( $_POST['ytism_icon'][ $menu_item_db_id ] );
			update_post_meta( $menu_item_db_id, '_ytism_icon', $icon );
		}

		// Save visibility.
		if ( isset( $_POST['ytism_visibility'][ $menu_item_db_id ] ) ) {
			$visibility = sanitize_key( $_POST['ytism_visibility'][ $menu_item_db_id ] );
			update_post_meta( $menu_item_db_id, '_ytism_visibility', $visibility );
		}

		// Save logout link.
		if ( isset( $_POST['ytism_logout_link'][ $menu_item_db_id ] ) ) {
			update_post_meta( $menu_item_db_id, '_ytism_logout_link', '1' );
		} else {
			delete_post_meta( $menu_item_db_id, '_ytism_logout_link' );
		}

		// Save logout redirect option.
		if ( isset( $_POST['ytism_logout_redirect'][ $menu_item_db_id ] ) ) {
			$redirect = sanitize_key( $_POST['ytism_logout_redirect'][ $menu_item_db_id ] );
			update_post_meta( $menu_item_db_id, '_ytism_logout_redirect', $redirect );
		}
	}

	/**
	 * Setup logout URL for menu items
	 */
	public function setup_logout_url( $menu_item ) {
		$is_logout = get_post_meta( $menu_item->ID, '_ytism_logout_link', true );

		if ( $is_logout && is_user_logged_in() ) {
			$redirect_opt = get_post_meta( $menu_item->ID, '_ytism_logout_redirect', true ) ?: 'current';

			// Determine redirect URL.
			if ( 'home' === $redirect_opt ) {
				$redirect_url = home_url();
			} else {
				// Get current page URL.
				global $wp;
				$redirect_url = home_url( add_query_arg( array(), $wp->request ) );

				// If we're in admin or can't get current URL, use home.
				if ( is_admin() || empty( $redirect_url ) || $redirect_url === home_url() ) {
					$redirect_url = isset( $_SERVER['HTTP_REFERER'] ) ? $_SERVER['HTTP_REFERER'] : home_url();
				}
			}

			// Create logout URL with redirect.
			$menu_item->url = wp_logout_url( $redirect_url );
		}

		return $menu_item;
	}

	/**
	 * Filter menu items by visibility
	 */
	public function filter_by_visibility( $items ) {
		foreach ( $items as $key => $item ) {
			$visibility = get_post_meta( $item->ID, '_ytism_visibility', true ) ?: 'all';

			$show = false;
			switch ( $visibility ) {
				case 'logged_in':
					$show = is_user_logged_in();
					break;
				case 'logged_out':
					$show = ! is_user_logged_in();
					break;
				default:
					$show = true;
			}

			if ( ! $show ) {
				unset( $items[ $key ] );
			}
		}

		return $items;
	}

	/**
	 * Add icon to menu item
	 */
	public function add_icon( $item_output, $item, $depth, $args ) {
		$icon = get_post_meta( $item->ID, '_ytism_icon', true );

		if ( $icon ) {
			// Determine icon type and build class.
			$icon_class = '';
			if ( strpos( $icon, 'fa-' ) !== false || strpos( $icon, 'fas' ) !== false || strpos( $icon, 'far' ) !== false || strpos( $icon, 'fab' ) !== false ) {
				// Font Awesome icon.
				$icon_class = $icon;
			} else {
				// Dashicons.
				$icon_class = 'ytism-icon ytism-icon-' . $icon;
			}

			$icon_html = '<span class="ytism-menu-icon ' . esc_attr( $icon_class ) . '" aria-hidden="true"></span>';

			// Add icon before link text.
			$item_output = preg_replace( '/(<a.*?>)/', '$1' . $icon_html, $item_output );
		}

		return $item_output;
	}

	/**
	 * Add CSS classes to menu items
	 */
	public function add_css_classes( $classes, $item ) {
		$visibility = get_post_meta( $item->ID, '_ytism_visibility', true );
		$icon       = get_post_meta( $item->ID, '_ytism_icon', true );
		$is_logout  = get_post_meta( $item->ID, '_ytism_logout_link', true );

		if ( $visibility ) {
			$classes[] = 'ytism-visibility-' . $visibility;
		}

		if ( $icon ) {
			$classes[] = 'ytism-has-icon';
		}

		if ( $is_logout ) {
			$classes[] = 'ytism-logout-link';
		}

		return $classes;
	}

	/**
	 * Admin head styles
	 */
	public function admin_head() {
		?>
		<style>
			@font-face {
				font-family: 'ytism';
				src: url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.eot?98731080' ); ?>'); /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */
				src: url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.eot?98731080#iefix' ); ?>') format('embedded-opentype'),
					url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.woff2?98731080' ); ?>') format('woff2'),
					url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.woff?98731080' ); ?>') format('woff'),
					url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.ttf?98731080' ); ?>') format('truetype'),
					url('<?php echo esc_url( YTISM_PLUGIN_URL . 'assets/fonts/ytism/ytism.svg?98731080#ytism' ); ?>') format('svg');
				font-weight: normal;
				font-style: normal;
			}
			.ytism-icon::before, [class^="ytism-icon-"]::before, [class*=" ytism-icon-"]::before {
				font-family: "ytism";
				font-style: normal;
				font-weight: normal;
				speak: never;
				display: inline-block;
				text-decoration: inherit;
				width: 1em;
				margin-right: .2em;
				text-align: center;
				font-variant: normal;
				text-transform: none;
				line-height: 1em;
				margin-left: .2em;
				-webkit-font-smoothing: antialiased;
				-moz-osx-font-smoothing: grayscale;
			}
			.ytism-icon-ytism-logo:before { content: '\e800'; }
			.ytism-icon-download-alt:before { content: '\e801'; }
			.ytism-icon-eye:before { content: '\e802'; }
			.ytism-icon-eye-off:before { content: '\e803'; }
			.ytism-icon-shield-check:before { content: '\e804'; }
			.ytism-icon-cross-circle:before { content: '\e805'; }
			.ytism-icon-cross:before { content: '\e806'; }
			.ytism-icon-check-circle:before { content: '\e807'; }
			.ytism-icon-info-circle:before { content: '\e808'; }
			.ytism-icon-user:before { content: '\e809'; }
			.ytism-icon-language-switch:before { content: '\e80a'; }

			/* YTISM Menu Fields */
			.field-ytism-icon, .field-ytism-visibility, .field-ytism-logout {
				margin: 12px 0;
				padding: 10px 0;
				border-top: 1px solid #e5e5e5;
			}
			.ytism-icon-field, .ytism-visibility-field {
				width: 100%;
				margin-top: 5px;
			}
			.ytism-icon-field {
				font-family: monospace;
			}
			.ytism-icon-field:not([value=""]) {
				background-color: #f0f8ff;
				border-color: #0073aa;
			}
			.ytism-logout-checkbox:checked ~ .ytism-logout-options {
				display: block !important;
			}
			.ytism-logout-redirect-field {
				width: 100%;
				margin-top: 5px;
			}
			.menu-item-title .ytism-preview-icon {
				margin-right: 8px;
				color: #0073aa;
				vertical-align: middle;
			}
			.menu-item-title .ytism-visibility-badge {
				margin-left: 10px;
				padding: 2px 6px;
				background: #f0f0f0;
				color: #666;
				font-size: 11px;
				border-radius: 3px;
				font-weight: normal;
			}
			.ytism-visibility-badge.logged-in {
				background: #e8f5e9;
				color: #2e7d32;
			}
			.ytism-visibility-badge.logged-out {
				background: #fff3e0;
				color: #e65100;
			}
			.menu-item-title .ytism-logout-badge {
				margin-left: 5px;
				padding: 2px 6px;
				background: #ffe0e0;
				color: #d32f2f;
				font-size: 11px;
				border-radius: 3px;
				font-weight: normal;
			}
			.ytism-quick-icons {
				margin-top: 8px;
				display: flex;
				flex-wrap: wrap;
				gap: 5px;
			}
			.ytism-quick-icon {
				padding: 4px 8px;
				background: #f0f0f0;
				border: 1px solid #ddd;
				cursor: pointer;
				border-radius: 3px;
				font-size: 12px;
				text-decoration: none;
				color: #444;
				display: inline-flex;
				align-items: center;
				gap: 4px;
			}
			.ytism-quick-icon:hover {
				background: #e0e0e0;
				border-color: #bbb;
				color: #222;
			}
			.ytism-quick-icon span {
				font-size: 14px;
			}
		</style>
		<?php
	}

	/**
	 * Admin footer scripts
	 */
	public function admin_footer() {
		?>
		<script>
		jQuery(document).ready(function($) {
			// Common Dashicons.
			var quickIcons = [
				{icon: 'ytism-logo', label: 'Logo'},
				{icon: 'user', label: 'User'},
				{icon: 'language-switch', label: 'Language'},
			];
			
			function initYTISM() {
				// Add preview and badges.
				$('.menu-item').each(function() {
					updateItemPreview($(this));
				});
				
				// Add quick icon selector.
				$('.ytism-icon-field').each(function() {
					if (!$(this).next('.ytism-quick-icons').length) {
						var quickHtml = '<div class="ytism-quick-icons">';
						quickIcons.forEach(function(item) {
							quickHtml += '<a href="#" class="ytism-quick-icon" data-icon="' + item.icon + '">';
							quickHtml += '<span class="ytism-icon ytism-icon-' + item.icon + '"></span>';
							quickHtml += item.label + '</a>';
						});
						quickHtml += '</div>';
						$(this).after(quickHtml);
					}
				});

				// Handle logout checkbox toggle
				$('.ytism-logout-checkbox').each(function() {
					var $checkbox = $(this);
					var $options = $checkbox.closest('.field-ytism-logout').find('.ytism-logout-options');
					
					$checkbox.on('change', function() {
						if ($(this).is(':checked')) {
							$options.slideDown(200);
						} else {
							$options.slideUp(200);
						}
						updateItemPreview($(this).closest('.menu-item'));
					});
				});
			}
			
			function updateItemPreview($item) {
				var itemId = $item.attr('id').replace('menu-item-', '');
				var $title = $item.find('.menu-item-title');
				var $iconField = $item.find('.ytism-icon-field');
				var $visibilityField = $item.find('.ytism-visibility-field');
				var $logoutCheckbox = $item.find('.ytism-logout-checkbox');
				
				// Remove existing preview.
				$title.find('.ytism-preview-icon, .ytism-visibility-badge, .ytism-logout-badge').remove();
				
				// Add icon preview.
				if ($iconField.val()) {
					var iconClass = $iconField.val();
					if (iconClass.indexOf('fa-') === -1 && iconClass.indexOf('fas') === -1 && iconClass.indexOf('far') === -1) {
						iconClass = 'ytism-icon ytism-icon-' + iconClass;
					}
					$title.prepend('<span class="ytism-preview-icon ' + iconClass + '"></span>');
				}
				
				// Add visibility badge.
				var visibility = $visibilityField.val();
				if (visibility && visibility !== 'all') {
					var badgeClass = 'ytism-visibility-badge';
					var badgeText = '';
					
					if (visibility === 'logged_in') {
						badgeClass += ' logged-in';
						badgeText = 'Logged In';
					} else if (visibility === 'logged_out') {
						badgeClass += ' logged-out';
						badgeText = 'Logged Out';
					}
					
					$title.append('<span class="' + badgeClass + '">' + badgeText + '</span>');
				}

				// Add logout badge
				if ($logoutCheckbox.is(':checked')) {
					$title.append('<span class="ytism-logout-badge">Logout</span>');
				}
			}
			
			// Initialize.
			initYTISM();
			
			// Update on field change.
			$(document).on('input change', '.ytism-icon-field, .ytism-visibility-field, .ytism-logout-redirect-field', function() {
				updateItemPreview($(this).closest('.menu-item'));
			});
			
			// Quick icon click.
			$(document).on('click', '.ytism-quick-icon', function(e) {
				e.preventDefault();
				var icon = $(this).data('icon');
				$(this).closest('.field-ytism-icon').find('.ytism-icon-field').val(icon).trigger('input');
			});
			
			// Reinitialize on menu item added.
			$(document).on('menu-item-added', function() {
				setTimeout(initYTISM, 100);
			});
		});
		</script>
		<?php
	}
}
