<?php
/**
 * Authentication Forms and Handlers
 *
 * @package YTISM
 * @subpackage Includes/Public
 * @since 1.0.0
 */

namespace YTISM\Public;

use YTISM\Core\Api;
use YTISM\Core\Template;
use YTISM\Core\AliasUser;
use libphonenumber\PhoneNumberUtil;
use libphonenumber\NumberParseException;
use YTISM\Helpers\Functions;
use DateTime;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Authentication Forms and Handlers
 */
class Auth {
	/**
	 * Auth slug
	 *
	 * @var string
	 */
	private string $auth_slug = 'ytism-alias-auth';

	/**
	 * Departments list
	 *
	 * @var array<int, string>
	 */
	private array $departments = [];

	/**
	 * Countries list
	 *
	 * @var array<int, string>
	 */
	private array $countries = [];

	/**
	 * Default country
	 *
	 * @var string
	 */
	private string $default_country;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->auth_slug       = sanitize_title( str_replace( ' ', '-', trim( $this->auth_slug, '/' ) ) );
		$this->default_country = Functions::get_user_country( 'US' );
		$this->departments     = [
			1   => 'HR',
			2   => 'IT',
			3   => 'Finance',
			4   => 'Marketing',
			5   => 'Sales',
			6   => 'Operations',
			7   => 'Customer Support',
			8   => 'Research and Development',
			9   => 'Logistics',
			10  => 'Legal',
			11  => 'Strategy and Planning',
			12  => 'Executive Office',
			13  => 'Admissions',
			14  => 'Academic Affairs',
			15  => 'Student Services',
			16  => 'Clinical Operations',
			17  => 'Pharmacy',
			18  => 'Public Health',
			19  => 'Production',
			20  => 'Quality Control',
			21  => 'Engineering',
			22  => 'Data Science',
			23  => 'Content Creation',
			24  => 'Public Relations',
			25  => 'Fundraising',
			26  => 'Programs and Outreach',
			27  => 'Guest Services',
			28  => 'Event Management',
			29  => 'Cultural Affairs',
			30  => 'Diversity, Equity, and Inclusion',
			31  => 'Sustainability',
			32  => 'Corporate Communications',
			33  => 'Procurement',
			34  => 'Compliance',
			35  => 'Facility Management',
			36  => 'Design',
			37  => 'Editorial',
			38  => 'Photography and Videography',
			39  => 'Product Management',
			40  => 'Cybersecurity',
			41  => 'DevOps',
			42  => 'Blockchain',
			43  => 'Nursing Services',
			44  => 'Pathology',
			45  => 'Biotechnology',
			46  => 'Urban Planning',
			47  => 'Public Works',
			48  => 'Emergency Services',
			49  => 'Housekeeping',
			50  => 'Food and Beverage',
			51  => 'Tour Operations',
			52  => 'Maintenance',
			53  => 'Tooling and Die',
			54  => 'Packaging',
			55  => 'Inventory Management',
			56  => 'Customer Experience',
			57  => 'Merchandising',
			58  => 'Ethics and Compliance',
			59  => 'Artificial Intelligence Research',
			60  => 'Environmental Health and Safety',
			61  => 'Grants Management',
			62  => 'Volunteer Coordination',
			63  => 'Donor Relations',
			64  => 'Innovation',
			65  => 'Digital Transformation',
			66  => 'Business Intelligence',
			67  => 'Data Analytics',
			68  => 'Cloud Computing',
			69  => 'Quality Assurance',
			70  => 'Health and Safety',
			71  => 'Supply Chain Management',
			72  => 'Transportation',
			73  => 'Environmental Affairs',
			74  => 'Workplace Wellness',
			75  => 'Internal Audit',
			76  => 'Vendor Management',
			77  => 'Customer Success',
			78  => 'Product Design',
			79  => 'Brand Strategy',
			80  => 'Retail Operations',
			81  => 'Knowledge Management',
			82  => 'Talent Acquisition',
			83  => 'Employee Engagement',
			84  => 'Philanthropy',
			85  => 'Sponsorship',
			86  => 'Labor Relations',
			87  => 'Community Engagement',
			88  => 'Nonprofit Development',
			89  => 'Customer Relationship Management',
			90  => 'Social Media Management',
			91  => 'Affiliate Marketing',
			92  => 'Creative Services',
			93  => 'Influencer Marketing',
			94  => 'Strategic Partnerships',
			95  => 'Sustainability and ESG',
			96  => 'Cyber Intelligence',
			97  => 'wellness',
			98  => '1 on 1 clients',
			99  => 'clients',
			100 => 'family',
			101 => 'friends',
			102 => 'social media',
		];
		$this->countries       = [
			1   => 'Afghanistan',
			2   => 'Andorra',
			3   => 'Angola',
			4   => 'Antigua and Barbuda',
			5   => 'Algeria',
			6   => 'Argentina',
			7   => 'Armenia',
			8   => 'Australia',
			9   => 'Austria',
			10  => 'Azerbaijan',
			11  => 'The Bahamas',
			12  => 'Bangladesh',
			13  => 'Barbados',
			14  => 'Bahrain',
			15  => 'Belarus',
			16  => 'Belgium',
			17  => 'Belize',
			18  => 'Benin',
			19  => 'Bolivia',
			20  => 'Bosnia and Herzegovina',
			21  => 'Botswana',
			22  => 'Brazil',
			23  => 'Brunei',
			24  => 'Bulgaria',
			25  => 'Burkina Faso',
			26  => 'Burundi',
			27  => 'Bhutan',
			28  => 'Cape Verde',
			29  => 'Cameroon',
			30  => 'Cambodia',
			31  => 'Canada',
			32  => 'Central African Republic',
			33  => 'Chad',
			34  => 'China',
			35  => 'Chile',
			36  => 'Cook Islands',
			37  => 'Colombia',
			38  => 'Comoros',
			39  => 'Costa Rica',
			40  => 'Croatia',
			41  => 'Cuba',
			42  => 'Cyprus',
			43  => 'Czech Republic',
			44  => 'Democratic Republic of Congo',
			45  => 'Denmark',
			46  => 'Djibouti',
			47  => 'Dominica',
			48  => 'Dominican Republic',
			49  => 'East Timor',
			50  => 'Ecuador',
			51  => 'Egypt',
			52  => 'El Salvador',
			53  => 'England',
			54  => 'Equatorial Guinea',
			55  => 'Eritrea',
			56  => 'Estonia',
			57  => 'Fiji',
			58  => 'Finland',
			59  => 'France',
			60  => 'Gabon',
			61  => 'Gambia',
			62  => 'Georgia',
			63  => 'Germany',
			64  => 'Grenada',
			65  => 'Greece',
			66  => 'Guatemala',
			67  => 'Guinea',
			68  => 'Guinea-Bissau',
			69  => 'Guyana',
			70  => 'Haiti',
			71  => 'Netherlands',
			72  => 'Honduras',
			73  => 'Hungary',
			74  => 'Iceland',
			75  => 'India',
			76  => 'Indonesia',
			77  => 'Iran',
			78  => 'Ireland',
			79  => 'Israel',
			80  => 'Italy',
			81  => 'Ivory Coast',
			82  => 'Jamaica',
			83  => 'Japan',
			84  => 'Jordan',
			85  => 'Kazakhstan',
			86  => 'Kenya',
			87  => 'Kiribati',
			88  => 'Kyrgyzstan',
			89  => 'Kuwait',
			90  => 'Laos',
			91  => 'Latvia',
			92  => 'Lebanon',
			93  => 'Lesotho',
			94  => 'Liberia',
			95  => 'Liechtenstein',
			96  => 'Lithuania',
			97  => 'Luxembourg',
			98  => 'Libya',
			99  => 'Macedonia',
			100 => 'Madagascar',
			101 => 'Malaysia',
			102 => 'Malawi',
			103 => 'Maldives',
			104 => 'Mali',
			105 => 'Malta',
			106 => 'Mauritius',
			107 => 'Mauritania',
			108 => 'Marshall Islands',
			109 => 'Micronesia',
			110 => 'Mexico',
			111 => 'Morocco',
			112 => 'Moldova',
			113 => 'Monaco',
			114 => 'Mongolia',
			115 => 'Montenegro',
			116 => 'Mozambique',
			117 => 'Myanmar',
			118 => 'Namibia',
			119 => 'Nauru',
			120 => 'Nepal',
			121 => 'New Zealand',
			122 => 'Nicaragua',
			123 => 'Niger',
			124 => 'Nigeria',
			125 => 'Niue',
			126 => 'North Korea',
			127 => 'Norway',
			128 => 'Oman',
			129 => 'Palestine',
			130 => 'Pakistan',
			131 => 'Palau',
			132 => 'Panama',
			133 => 'Papua New Guinea',
			134 => 'Paraguay',
			135 => 'Peru',
			136 => 'Philippines',
			137 => 'Poland',
			138 => 'Portugal',
			139 => 'Qatar',
			140 => 'Romania',
			141 => 'Russia',
			142 => 'Rwanda',
			143 => 'Samoa',
			144 => 'Saint Lucia',
			145 => 'Saint Kitts and Nevis',
			146 => 'San Marino',
			147 => 'Sao Tome and Principe',
			148 => 'Saint Vincent and the Grenadines',
			149 => 'Scotland',
			150 => 'Senegal',
			151 => 'Serbia',
			152 => 'Seychelles',
			153 => 'Sierra Leone',
			154 => 'Singapore',
			155 => 'Slovakia',
			156 => 'Solomon Islands',
			157 => 'Somalia',
			158 => 'South Africa',
			159 => 'South Korea',
			160 => 'South Sudan',
			161 => 'Spain',
			162 => 'Sri Lanka',
			163 => 'Sudan',
			164 => 'Suriname',
			165 => 'Swaziland',
			166 => 'Sweden',
			167 => 'Switzerland',
			168 => 'Syria',
			169 => 'Tajikistan',
			170 => 'Tanzania',
			171 => 'Thailand',
			172 => 'Togo',
			173 => 'Tonga',
			174 => 'Trinidad and Tobago',
			175 => 'Tunisia',
			176 => 'Turkmenistan',
			177 => 'Turkey',
			178 => 'Tuvalu',
			179 => 'Ukraine',
			180 => 'Uganda',
			181 => 'Uruguay',
			182 => 'United Arab Emirates',
			183 => 'United Kingdom',
			184 => 'United States of America',
			185 => 'Uzbekistan',
			186 => 'Vanuatu',
			187 => 'Venezuela',
			188 => 'Vietnam',
			189 => 'Wales',
			190 => 'Yemen',
			191 => 'Zambia',
			192 => 'Zimbabwe',
		];
	}

	/**
	 * Initialize hooks
	 *
	 * @return void
	 */
	public function init(): void {
		add_action( 'init', [ $this, 'add_rewrite' ] );
		add_action( 'template_redirect', [ $this, 'maybe_render_alias_auth' ] );

		// Shortcodes.
		add_shortcode( 'ytism_register_form', [ $this, 'render_register_window' ] );
		add_shortcode( 'ytism_register_enterprise_form', [ $this, 'render_register_enterprise_window' ] );
		add_shortcode( 'ytism_login_form', [ $this, 'render_login_window' ] );
		add_shortcode( 'ytism_logout_form', [ $this, 'render_logout_window' ] );
		add_shortcode( 'ytism_otp_form', [ $this, 'render_verify_otp_window' ] );

		add_action( 'wp_ajax_ytism_auth', [ $this, 'handle_ajax_request' ] );
		add_action( 'wp_ajax_nopriv_ytism_auth', [ $this, 'handle_ajax_request' ] );

		add_action( 'wp_ajax_ytism_auth_load_from', [ $this, 'handle_ajax_load_form_request' ] );
		add_action( 'wp_ajax_nopriv_ytism_auth_load_from', [ $this, 'handle_ajax_load_form_request' ] );
	}

	/**
	 * Get URL for auth actions (login/register/forgot/reset/verify)
	 *
	 * @param string               $path Path segment.
	 * @param array<string, mixed> $args Query arguments.
	 * @return string
	 */
	public function get_auth_url( string $path = '', array $args = [] ): string {
		$url = home_url( trailingslashit( $this->auth_slug ) );

		if ( $path ) {
			$url = trailingslashit( $url . $path );
		}

		if ( ! empty( $args ) ) {
			$url = add_query_arg( $args, $url );
		}

		return $url;
	}

	/**
	 * Add rewrite rule for /alias-auth/
	 *
	 * @return void
	 */
	public function add_rewrite(): void {
		add_rewrite_rule(
			'^' . $this->auth_slug . '/?$',
			'index.php?ytism_alias_auth=login',
			'top'
		);
		add_rewrite_rule(
			'^' . $this->auth_slug . '/register/?$',
			'index.php?ytism_alias_auth=register',
			'top'
		);
		add_rewrite_rule(
			'^' . $this->auth_slug . '/verify-email/?$',
			'index.php?ytism_alias_auth=verify-email',
			'top'
		);
		add_rewrite_rule(
			'^' . $this->auth_slug . '/forget-password/?$',
			'index.php?ytism_alias_auth=forget-password',
			'top'
		);
		add_rewrite_rule(
			'^' . $this->auth_slug . '/reset-password/?$',
			'index.php?ytism_alias_auth=reset-password',
			'top'
		);
		add_rewrite_rule(
			'^' . $this->auth_slug . '/verify-otp/?$',
			'index.php?ytism_alias_auth=verify-otp',
			'top'
		);
		add_rewrite_tag( '%ytism_alias_auth%', '([^&]+)' );
	}

	/**
	 * Intercept request and render alias portal
	 *
	 * @return void
	 */
	public function maybe_render_alias_auth(): void {
		$auth_action = get_query_var( 'ytism_alias_auth' );

		if ( $auth_action ) {
			status_header( 200 );
			nocache_headers();
			$output = $this->handle_request( (string) $auth_action );
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render_alias_auth outputs a full HTML document and is intentionally echoed here.
			echo $this->render_alias_auth( (string) $auth_action, $output );
			exit;
		}
	}

	/**
	 * Handle post request
	 *
	 * @param string $auth_action Authentication action.
	 * @return string
	 */
	private function handle_request( string $auth_action ): string {
		if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			return '';
		}

		$result = [
			'success' => false,
			'message' => __( 'Unknown error', 'ytism' ),
		];

		switch ( $auth_action ) {
			case 'register':
				$result = $this->process_register_core();

				if ( isset( $result['data']['uid'], $result['success'] ) && $result['success'] ) {
					wp_safe_redirect( $this->get_auth_url( 'verify-otp', [ 'uid' => $result['data']['uid'] ] ) );
					exit;
				}

				break;

			case 'forget-password':
				$result = $this->process_forget_password_core();
				break;

			case 'reset-password':
				$result = $this->process_reset_password_core();

				if ( $result['success'] ) {
					wp_safe_redirect( $this->get_auth_url() );
					exit;
				}

				break;

			case 'verify-otp':
				$result = $this->process_otp_verify_core();

				if ( $result['success'] ) {
					wp_safe_redirect( $this->get_auth_url() );
					exit;
				}
				break;

			case 'login':
			default:
				$result        = $this->process_login_core();
				$myaccount_url = Functions::get_myaccount_page_url();
				$redir_url     = ! empty( $myaccount_url ) ? $myaccount_url : home_url( '/' );

				if ( $result['success'] ) {
					wp_safe_redirect( $redir_url );
					exit;
				}
				break;
		}

		return $this->render_response_as_html( $result );
	}

	/**
	 * Handle request (on ajax)
	 *
	 * @return array<string, mixed>
	 */
	public function handle_ajax_request(): array {
		if ( ! defined( 'DOING_AJAX' ) || ! DOING_AJAX || 'POST' !== sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ?? '' ) ) ) {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'Invalid request', 'ytism' ),
				]
			);
		}

		// phpcs:disable WordPress.Security.NonceVerification.Missing
		$action = isset( $_POST['auth_action'] ) ? sanitize_text_field( wp_unslash( $_POST['auth_action'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		$result = [
			'success' => false,
			'message' => __( 'Unknown action.', 'ytism' ),
		];

		switch ( $action ) {
			case 'register':
				$result = $this->process_register_core();

				// If registration is successful, return OTP form HTML.
				if ( isset( $result['success'], $result['data']['uid'] ) && $result['success'] ) {
					$otp_form = do_shortcode( '[ytism_otp_form uid="' . esc_attr( $result['data']['uid'] ) . '"]' );

					$result['message'] = __( 'Registration successful! Please check your email for OTP(One-Time-Password).', 'ytism' );
					$result['html']    = $otp_form;
				}
				break;
			case 'verify-otp':
				$result = $this->process_otp_verify_core();

				// If OTP verification is successful, return login form HTML.
				if ( isset( $result['success'] ) && $result['success'] ) {
					$message = isset( $result['resend_otp'] ) ? __( 'OTP(One-Time-Password) resent successfully. Please check your email.', 'ytism' ) : __( 'OTP(One-Time-Password) verified successfully. Please log in.', 'ytism' );

					$result['message'] = $message;
					$result['html']    = '';
				}
				break;
			case 'login':
				$result = $this->process_login_core();

				// If login is successful, return redirect URL.
				if ( isset( $result['success'] ) && $result['success'] ) {
					$result['message']      = __( 'Login successful! Redirecting...', 'ytism' );
					$result['redirect_url'] = $result['redirect_url'] ?? home_url( '/' );
				}
				break;
			case 'forget-password':
				$result = $this->process_forget_password_core();
				break;

			case 'enterprise-register':
				$result = $this->process_register_enterprise_core();

				if ( isset( $result['success'], $result['data']['uid'] ) && $result['success'] ) {
					$otp_form = do_shortcode( '[ytism_otp_form uid="' . esc_attr( $result['data']['uid'] ) . '"]' );

					$result['message'] = __( 'Registration successful! Please check your email for OTP(One-Time-Password).', 'ytism' );
					$result['html']    = $otp_form;
				}
				break;

			default:
				$result = [
					'success' => false,
					'message' => __( 'Unknown action.', 'ytism' ),
				];
		}

		if ( $result['success'] ) {
			wp_send_json_success( $result );
		} else {
			wp_send_json_error( $result );
		}

		return $result;
	}

	/**
	 * Handle AJAX request to load form dynamically.
	 *
	 * @return void
	 */
	public function handle_ajax_load_form_request(): void {
		// Verify AJAX and request method.
		if ( ! defined( 'DOING_AJAX' ) || ! DOING_AJAX || 'GET' !== sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ?? '' ) ) ) {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'Invalid request.', 'ytism' ),
				]
			);
		}

		// Verify nonce for security.
		$nonce = isset( $_GET['nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'auth_load_from' ) ) {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
				]
			);
		}

		$form_html = '';
		$type      = isset( $_GET['form_type'] ) ? sanitize_text_field( wp_unslash( $_GET['form_type'] ) ) : '';

		switch ( $type ) {
			case 'register':
				$form_html = do_shortcode( '[ytism_register_form]' );
				break;

			case 'login':
			default:
				$form_html = do_shortcode( '[ytism_login_form]' );
				break;
		}

		if ( ! empty( $form_html ) ) {
			wp_send_json_success(
				[
					'success' => true,
					'html'    => $form_html,
				]
			);
		} else {
			wp_send_json_error(
				[
					'success' => false,
					'message' => __( 'Failed to load form.', 'ytism' ),
				]
			);
		}
	}

	/**
	 * Render Alias Portal (login/register/forgot/reset/verify)
	 *
	 * @param string $auth_action Authentication action.
	 * @param string $message Message to display.
	 * @return string
	 */
	private function render_alias_auth( string $auth_action, string $message = '' ): string {
		ob_start(); ?>
		<!DOCTYPE html>
		<html <?php language_attributes(); ?> style="height:100%;">
		<head>
			<meta charset="<?php bloginfo( 'charset' ); ?>">
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<meta name="robots" content="noindex, nofollow">
			<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
			<meta http-equiv="Pragma" content="no-cache">
			<meta http-equiv="Expires" content="0">
			<title><?php esc_html_e( 'Authentication', 'ytism' ); ?></title>
			<?php wp_head(); ?>
		</head>
		<body <?php body_class( 'ytism-alias-auth' ); ?>>
			<div class="ytism-alias-auth-wrapper">
				<div class="ytism-alias-auth-header">
					<?php
					if ( has_custom_logo() ) {
						the_custom_logo();
					} else {
						?>
						<a href="<?php echo esc_url( home_url() ); ?>" class="ytism-site-title">
							<?php bloginfo( 'name' ); ?>
						</a>
						<?php
					}
					?>
				</div>

				<div class="ytism-alias-auth-container">
					<div class="ytism-alias-auth-card">
						<?php
						switch ( $auth_action ) {
							case 'register':
								?>
								<div class="ytism-alias-auth-head">
									<h2 class="ytism-alias-auth-header-heading"><?php esc_html_e( 'Register', 'ytism' ); ?></h2>
								</div>

								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_register_window();
								?>

								<div class="ytism-alias-auth-footer-links">
									<?php esc_html_e( 'Already have an account?', 'ytism' ); ?> <a href="<?php echo esc_url( $this->get_auth_url() ); ?>"><?php esc_html_e( 'Login here', 'ytism' ); ?></a>
								</div>
								<?php
								break;

							case 'forget-password':
								?>
								<div class="ytism-alias-auth-head">
									<h2 class="ytism-alias-auth-header-heading"><?php esc_html_e( 'Forget Password', 'ytism' ); ?></h2>
								</div>

								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_forget_password_window();
								break;

							case 'reset-password':
								?>
								<div class="ytism-alias-auth-head">
									<h2 class="ytism-alias-auth-header-heading"><?php esc_html_e( 'Reset Password', 'ytism' ); ?></h2>
								</div>

								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_reset_password_window();
								break;

							case 'verify-email':
								?>
								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_verify_email_window();
								break;

							case 'verify-otp':
								?>
								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_verify_otp_window();
								break;

							case 'login':
							default:
								?>
								<div class="ytism-alias-auth-head">
									<h2 class="ytism-alias-auth-header-heading"><?php esc_html_e( 'Login', 'ytism' ); ?></h2>
								</div>

								<?php
								if ( $message ) {
									echo wp_kses_post( $message );
								}
								?>
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
								echo $this->render_login_window();
								?>

								<div class="ytism-alias-auth-footer">
									<?php esc_html_e( 'Forgot your Password?', 'ytism' ); ?> <a href="<?php echo esc_url( $this->get_auth_url( 'forget-password' ) ); ?>"><?php esc_html_e( 'Recover here', 'ytism' ); ?></a>
								</div>
								<?php
								break;
						}
						?>
					</div>
				</div>
			</div>
			<?php wp_footer(); ?>
		</body>
		</html>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render response message (for non-AJAX requests)
	 *
	 * @param array $response The response data containing success status, message, errors, and successes.
	 * @return string The rendered HTML message.
	 */
	private function render_response_as_html( array $response ): string {
		$class = $response['success'] ?? false ? 'ytism-success' : 'ytism-error';

		$html  = '<div class="ytism-messages ' . esc_attr( $class ) . '">';
		$html .= '<h3 class="ytism-messages-heading">' . ( $response['success'] ? esc_html__( 'Success', 'ytism' ) : esc_html__( 'Error', 'ytism' ) ) . '</h3>';
		$html .= '<div class="ytism-messages-content">';

		// Main message.
		if ( ! empty( $response['message'] ) ) {
			$html .= '<p>' . wp_kses_post( $response['message'] ) . '</p>';
		}

		// Errors list.
		if ( ! empty( $response['errors'] ) && is_array( $response['errors'] ) ) {
			$html .= '<ul class="ytism-message-list">';
			foreach ( $response['errors'] as $msg ) {
				$html .= '<li>' . wp_kses_post( $msg ) . '</li>';
			}
			$html .= '</ul>';
		}

		// Successes list.
		if ( ! empty( $response['successes'] ) && is_array( $response['successes'] ) ) {
			$html .= '<ul class="ytism-message-list">';
			foreach ( $response['successes'] as $msg ) {
				$html .= '<li>' . wp_kses_post( $msg ) . '</li>';
			}
			$html .= '</ul>';
		}

		$html .= '</div>';
		$html .= '</div>';

		return $html;
	}

	/**
	 * Render Registration Form
	 *
	 * @return string
	 */
	public function render_register_window(): string {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- Nonce verification should be done before this block.
		$first_name = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name  = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$email      = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$terms      = isset( $_POST['terms'] ) ? (bool) sanitize_text_field( wp_unslash( $_POST['terms'] ) ) : false;
		// phpcs:enable WordPress.Security.NonceVerification.Missing.
		?>
		<form method="post" class="ytism-register-form ytism-simple-plan" id="<?php echo esc_attr( $unique_id . '-register-form' ); ?>">
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_first_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'First Name:', 'ytism' ); ?></label>
				<input type="text" name="first_name"
					id="<?php echo esc_attr( $unique_id . '_first_name' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'First name', 'ytism' ); ?>"
					value="<?php echo esc_attr( $first_name ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_last_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Last Name:', 'ytism' ); ?></label>
				<input type="text" name="last_name"
					id="<?php echo esc_attr( $unique_id . '_last_name' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Last name', 'ytism' ); ?>"
					value="<?php echo esc_attr( $last_name ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_email' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Email:', 'ytism' ); ?></label>
				<input type="email" name="email"
					id="<?php echo esc_attr( $unique_id . '_email' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Email address', 'ytism' ); ?>"
					value="<?php echo esc_attr( $email ); ?>">
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_password' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Create a password:', 'ytism' ); ?></label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="password"
						id="<?php echo esc_attr( $unique_id . '_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'Create a password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>">
						<i class='ytism-icon ytism-icon-eye'></i>
					</button>
				</div>
				<div id="<?php echo esc_attr( $unique_id . '_password_meter' ); ?>" class="ytism-form-password-meter"></div>
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>" class="ytism-form-field-label not-require">
					<?php esc_html_e( 'Confirm the password:', 'ytism' ); ?>
				</label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="confirm_password"
						id="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'Re-enter the password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>">
						<i class='ytism-icon ytism-icon-eye'></i>
					</button>
				</div>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_terms' ); ?>" class="ytism-form-field-label ytism-form-field-label-checkbox ytism-form-field-terms require">
					<input type="checkbox" name="terms" id="<?php echo esc_attr( $unique_id . '_terms' ); ?>" required value="1" <?php checked( $terms, true ); ?>/>
					
					<?php
					printf(
						wp_kses_post(
							/* translators: 1: opening anchor tag for Terms of Use, 2: closing anchor tag for Terms of Use, 3: opening anchor tag for Privacy Policy and Subscription Terms, 4: closing anchor tag for Privacy Policy and Subscription Terms. */
							__( 'By clicking Subscribe, you confirm and affirm that you have read, understood and agreed to our %1$sTerms of Use%2$s, %3$sPrivacy Policy and Subscription Terms%4$s.', 'ytism' )
						),
						'<a href="' . esc_url( Functions::get_terms_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
						'</a>',
						'<a href="' . esc_url( Functions::get_privacy_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
						'</a>'
					);
					?>
				</label>
			</div>

			<?php wp_nonce_field( 'ytism_register_nonce', 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="register">

			<button type="submit" name="ytism_register" class="ytism-btn ytism-register-btn" id="<?php echo esc_attr( $unique_id . '_ytism_register' ); ?>">
				<?php esc_html_e( 'Subscribe', 'ytism' ); ?>
				<span class="ytism-btn-spinner" style="display:none;"></span>
			</button>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render email verification
	 *
	 * @return string
	 */
	public function render_verify_email_window(): string {
		ob_start();

		$unique_id = uniqid( 'ytism-' );

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Only reading URL parameters, not processing form data.
		$uid   = isset( $_GET['uid'] ) ? sanitize_text_field( wp_unslash( $_GET['uid'] ) ) : '';
		$token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended.
		$user_id = Functions::decrypt_str( $uid );

		if ( empty( $uid ) || empty( $user_id ) || empty( $token ) || ( (int) $user_id <= 0 ) || ! get_user_by( 'id', $user_id ) ) {
			$message = sprintf(
				wp_kses_post(
					/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the reset password page. */
					__( 'The link is expired or invalid. %1$sClick here%2$s to reset your password.', 'ytism' )
				),
				'<a href="' . esc_url( $this->get_auth_url( 'forget-password' ) ) . '">',
				'</a>'
			);

			return '<div class="ytism-message ytism-error">' . $message . '</div>';
		}

		$alias_verified = get_user_meta( $user_id, 'ytism_alias_verified', true );
		if ( $alias_verified ) {
			$message = sprintf(
				wp_kses_post(
					/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the login page. */
					__( 'Email is already verified. %1$sClick here%2$s to login.', 'ytism' )
				),
				'<a href="' . esc_url( $this->get_auth_url() ) . '">',
				'</a>'
			);

			return '<div class="ytism-message ytism-error">' . $message . '</div>';
		}

		$verification = $this->verify_token_or_otp( $user_id, $token, false );
		if ( is_wp_error( $verification ) ) {
			return '<div class="ytism-message ytism-error">' . wp_kses_post( $verification->get_error_message() ) . '</div>';
		}

		update_user_meta( $user_id, 'ytism_alias_verified', 1 );

		$encrypted_pass = get_user_meta( $user_id, 'ytism_alias_password', true );
		if ( ! empty( $encrypted_pass ) ) {
			$real_pass = Functions::decrypt_str( $encrypted_pass );
			wp_set_password( $real_pass, $user_id );
		}

		echo '<div class="ytism-message ytism-success">' . sprintf(
			wp_kses_post(
				/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the login page. */
				__( 'Email verified successfully! %1$sClick here%2$s to login.', 'ytism' )
			),
			'<a href="' . esc_url( $this->get_auth_url() ) . '">',
			'</a>'
		) . '</div>';

		return ob_get_clean();
	}

	/**
	 * Render Otp verification form
	 *
	 * @param array<string, mixed>|string $atts Shortcode attributes.
	 * @return string
	 */
	public function render_verify_otp_window( $atts = [] ): string {
		if ( ! is_array( $atts ) ) {
			$atts = [ 'uid' => $atts ];
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Reading verification UID from URL, not form input.
		$uid_from_url = isset( $_GET['uid'] ) ? sanitize_text_field( wp_unslash( $_GET['uid'] ) ) : '';

		$atts = shortcode_atts(
			[
				'uid' => $uid_from_url,
			],
			$atts
		);

		ob_start();

		$uid     = $atts['uid'];
		$user_id = Functions::decrypt_str( $uid );

		if ( empty( $uid ) || empty( $user_id ) || $user_id <= 0 || ! get_user_by( 'id', $user_id ) ) {
			$message = sprintf(
				wp_kses_post(
					/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the reset password page. */
					__( 'The link is expired or invalid. %1$sClick here%2$s to reset your password.', 'ytism' )
				),
				'<a href="' . esc_url( $this->get_auth_url( 'forget-password' ) ) . '">',
				'</a>'
			);

			return '<div class="ytism-message ytism-error">' . $message . '</div>';
		}

		$alias_verified = get_user_meta( $user_id, 'ytism_alias_verified', true );
		if ( $alias_verified ) {
			$message = sprintf(
				wp_kses_post(
					/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the login page. */
					__( 'Email is already verified. %1$sClick here%2$s to login.', 'ytism' )
				),
				'<a href="' . esc_url( $this->get_auth_url() ) . '">',
				'</a>'
			);

			return '<div class="ytism-message ytism-error">' . $message . '</div>';
		}

		$unique_id = uniqid( 'ytism-' );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce verification should be done before this block.
		$otp = sanitize_text_field( wp_unslash( $_POST['otp'] ?? '' ) );
		?>
		<form method="post" class="ytism-otp-form" id="<?php echo esc_attr( $unique_id . '-otp-form' ); ?>">
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_otp' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'One-Time Password (OTP):', 'ytism' ); ?></label>
				<input type="text" name="otp"
					id="<?php echo esc_attr( $unique_id . '_otp' ); ?>"
					maxlength="6"
					value="<?php echo esc_attr( $otp ); ?>"
					placeholder="<?php esc_attr_e( 'Enter the OTP (One-Time-Password)', 'ytism' ); ?>"
					>
			</div>

			<?php wp_nonce_field( 'ytism_otp_verify_nonce_' . $user_id, 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="verify-otp">
			<input type="hidden" name="uid" value="<?php echo esc_attr( $uid ); ?>">

			<button type="submit" name="ytism_verify" class="ytism-btn ytism-verify-btn" id="<?php echo esc_attr( $unique_id . '_ytism_verify' ); ?>">
				<?php esc_html_e( 'Verify OTP (One-Time-Password)', 'ytism' ); ?>
				<span class="ytism-btn-spinner" style="display:none;"></span>
			</button>
			<button type="submit" name="resend_otp" class="ytism-btn ytism-resend-btn" id="<?php echo esc_attr( $unique_id . '_resend_otp' ); ?>" style="margin-top:20px;">
				<?php esc_html_e( 'Resend OTP (One-Time-Password)', 'ytism' ); ?>
				<span class="ytism-btn-spinner" style="display:none;"></span>
			</button>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render Forget Password Form
	 *
	 * @return string
	 */
	public function render_forget_password_window(): string {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce verification should be done before this block.
		$username = isset( $_POST['username'] ) ? sanitize_email( wp_unslash( $_POST['username'] ) ) : '';
		?>
		<form method="post" class="ytism-forgot-form" id="<?php echo esc_attr( $unique_id . '-forgot-form' ); ?>">
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_username' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Email:', 'ytism' ); ?></label>
				<input type="email" name="username"
					id="<?php echo esc_attr( $unique_id . '_username' ); ?>"
					maxlength="100"
					placeholder="<?php esc_attr_e( 'Email', 'ytism' ); ?>"
					required
					value="<?php echo esc_attr( $username ); ?>">
			</div>

			<?php wp_nonce_field( 'ytism_forget_pass_nonce', 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="forget-password">
			<button type="submit" name="ytism_forgot" class="ytism-btn ytism-forgot-btn" id="<?php echo esc_attr( $unique_id . '_ytism_forgot' ); ?>">
				<?php esc_html_e( 'Send Reset Link', 'ytism' ); ?>
			</button>
			<div class="ytism-forgot-response" style="disaply:none;"></div>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render Reset Password Form
	 *
	 * @return string
	 */
	public function render_reset_password_window(): string {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		// phpcs:disable WordPress.Security.NonceVerification.Recommended --.
		$uid   = sanitize_text_field( wp_unslash( $_GET['uid'] ?? '' ) );
		$token = sanitize_text_field( wp_unslash( $_GET['token'] ?? '' ) );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended.
		$user_id = Functions::decrypt_str( $uid );

		if ( empty( $uid ) || empty( $token ) || empty( $user_id ) || $user_id <= 0 || ! get_user_by( 'id', $user_id ) ) {
			$message = sprintf(
				wp_kses_post(
					/* translators: %1$s and %2$s are the opening and closing anchor tags linking to the reset password page. */
					__( 'The link is expired or invalid. %1$sClick here%2$s to reset your password.', 'ytism' )
				),
				'<a href="' . esc_url( $this->get_auth_url( 'forget-password' ) ) . '">',
				'</a>'
			);

			return '<div class="ytism-message ytism-error">' . $message . '</div>';
		}

		$verification = $this->verify_token_or_otp( $user_id, $token, false );
		if ( is_wp_error( $verification ) ) {
			return '<div class="ytism-message ytism-error">' . wp_kses_post( $verification->get_error_message() ) . '</div>';
		}
		?>
		<form method="post" class="ytism-reset-form" id="<?php echo esc_attr( $unique_id . '-reset-form' ); ?>">
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_new_password' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'New Password:', 'ytism' ); ?></label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="new_password"
						id="<?php echo esc_attr( $unique_id . '_new_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'New Password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>"><i class='ytism-icon ytism-icon-eye'></i></button>
				</div>
				<div id="<?php echo esc_attr( $unique_id . '_password_meter' ); ?>" class="ytism-form-password-meter"></div>
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>" class="ytism-form-field-label not-require">
					<?php esc_html_e( 'Confirm Password:', 'ytism' ); ?>
				</label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="confirm_password"
						id="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'Re-enter the password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>">
						<i class='ytism-icon ytism-icon-eye'></i>
					</button>
				</div>
			</div>

			<?php wp_nonce_field( 'ytism_reset_pass_nonce_' . $user_id, 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="reset-password">
			<input type="hidden" name="uid" value="<?php echo esc_attr( $uid ); ?>">
			<input type="hidden" name="token" value="<?php echo esc_attr( $token ); ?>">

			<button type="submit" name="ytism_reset" class="ytism-btn ytism-reset-btn" id="<?php echo esc_attr( $unique_id . '_ytism_reset' ); ?>">
				<?php esc_html_e( 'Reset Password', 'ytism' ); ?>
			</button>

			<div class="ytism-reset-response" style="display:none;"></div>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render Login Form
	 *
	 * @return string
	 */
	public function render_login_window(): string {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		$email = '';
		if ( is_user_logged_in() ) {
			$user_id    = get_current_user_id();
			$alias_user = new AliasUser( $user_id );
			if ( $alias_user && $alias_user->exists() ) {
				$email = $alias_user->get_email();
			}
		}

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- Nonce verification should be done before this block.
		$email    = sanitize_text_field( wp_unslash( $_POST['email'] ?? $email ) );
		$remember = isset( $_POST['remember'] ) ? (bool) $_POST['remember'] : false;
		// phpcs:enable WordPress.Security.NonceVerification.Missing.
		?>
		<form method="post" class="ytism-login-form" id="<?php echo esc_attr( $unique_id . '-login-form' ); ?>">
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_email' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Email:', 'ytism' ); ?></label>
				<input type="email" name="email"
					id="<?php echo esc_attr( $unique_id . '_email' ); ?>"
					placeholder="<?php esc_attr_e( 'Email', 'ytism' ); ?>"
					maxlength="100"
					required
					autocomplete="email"
					value="<?php echo esc_attr( $email ); ?>">
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_password' ); ?>" class="ytism-form-field-label not-require">
					<?php esc_html_e( 'Password:', 'ytism' ); ?>
				</label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="password"
						id="<?php echo esc_attr( $unique_id . '_password' ); ?>"
						maxlength="64"
						placeholder="<?php esc_attr_e( 'Enter password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>">
						<i class='ytism-icon ytism-icon-eye'></i>
					</button>
				</div>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_remember' ); ?>" class="ytism-form-field-label ytism-form-field-label-checkbox require">
					<input type="checkbox" name="remember"
						id="<?php echo esc_attr( $unique_id . '_remember' ); ?>" 
						value="1"
						<?php checked( $remember, true ); ?> />
					<?php esc_html_e( 'Remember me', 'ytism' ); ?>
				</label>
			</div>

			<?php wp_nonce_field( 'ytism_login_nonce', 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="login">
			<button type="submit" name="ytism_login" class="ytism-btn ytism-login-btn" id="<?php echo esc_attr( $unique_id . '_ytism_login' ); ?>">
				<?php esc_html_e( 'Login', 'ytism' ); ?>
				<span class="ytism-btn-spinner" style="display:none;"></span>
			</button>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render Logout Form
	 *
	 * @return string
	 */
	public function render_logout_window(): string {
		$current_user = wp_get_current_user();

		ob_start();
		?>
		<div class="ytism-loggedin">
			<p>
				<?php
					printf(
						wp_kses_post(
							/* translators: %1$s and %2$s are the opening and closing <strong> tags wrapping the user’s name. */
							__( 'You are logged in as %1$s%2$s%3$s', 'ytism' )
						),
						'<strong>',
						esc_html( $current_user->display_name ),
						'</strong>'
					);
				?>
			</p>
			<form method="post" class="ytism-logout-form">
				<?php wp_nonce_field( 'ytism_logout_nonce', 'nonce' ); ?>
				<button type="submit" name="ytism_logout" class="ytism-logout-btn">
					<?php esc_html_e( 'Logout', 'ytism' ); ?>
				</button>
			</form>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Send verification email
	 *
	 * @param int  $user_id User ID.
	 * @param bool $is_otp Whether to send OTP.
	 * @param bool $is_forget Whether it's for password reset.
	 * @return array<string, mixed>|WP_Error
	 */
	public function send_verification_email( int $user_id, bool $is_otp = true, bool $is_forget = false ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return new WP_Error( 'user_not_found', __( 'Invalid action. The user does not exist.', 'ytism' ) );
		}

		$email      = null;
		$alias_user = new AliasUser( $user->ID );
		if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() ) {
			$email = $alias_user->get_email();
		} else {
			return new WP_Error( 'not_alias_user', __( 'The user is not an Alias user.', 'ytism' ) );
		}

		if ( empty( $email ) ) {
			return new WP_Error( 'no_email', __( 'No email found for this user.', 'ytism' ) );
		}

		$token_data = get_user_meta( $user_id, 'ytism_alias_token_data', true );
		if ( ! is_array( $token_data ) ) {
			$token_data = [];
		}

		$now         = time();
		$today_start = strtotime( 'today midnight' );
		$sent_count  = isset( $token_data['sent_count'] ) && $token_data['last_reset'] >= $today_start ? intval( $token_data['sent_count'] ) : 0;
		$last_sent   = isset( $token_data['last_sent'] ) ? intval( $token_data['last_sent'] ) : 0;

		$cooldowns = [ 0, 2, 5, 10, 20, 40 ];
		if ( $sent_count >= count( $cooldowns ) && $token_data['last_reset'] >= $today_start ) {
			return new WP_Error( 'daily_limit', __( 'You have reached the maximum number of emails for today.', 'ytism' ) );
		}

		$cooldown_minutes = $cooldowns[ $sent_count ] ?? end( $cooldowns );
		$cooldown         = $cooldown_minutes * MINUTE_IN_SECONDS;

		if ( $last_sent && ( $now - $last_sent ) < $cooldown ) {
			$remaining_seconds = $cooldown - ( $now - $last_sent );
			$minutes           = ceil( $remaining_seconds / 60 );

			return new WP_Error(
				'cooldown',
				sprintf(
					wp_kses_post(
						/* translators: 1: opening <strong> tag with countdown attributes, 2: closing </strong> tag, 3: remaining time (e.g., "2 minutes") */
						__( 'Please wait %1$s%3$s%2$s before requesting another OTP (One-Time Password).', 'ytism' )
					),
					'<strong class="ytism-countdown" data-timestart="' . esc_attr( $now ) . '" data-timeend="' . esc_attr( $now + $remaining_seconds ) . '">',
					'</strong>',
					esc_html(
						sprintf(
							/* translators: %d: number of minutes */
							_n( '%d min', '%d mins', $minutes, 'ytism' ),
							$minutes
						)
					)
				)
			);
		}

		$otp   = wp_rand( 100000, 999999 );
		$token = Functions::encrypt_str( $otp );

		$token_data = [
			'token'      => $token,
			'expiry'     => $now + 15 * MINUTE_IN_SECONDS,
			'sent_count' => $sent_count + 1,
			'last_sent'  => $now,
			'last_reset' => $today_start,
		];
		update_user_meta( $user_id, 'ytism_alias_token_data', $token_data );

		$verify_link = add_query_arg(
			[
				'uid'   => Functions::encrypt_str( $user_id ),
				'token' => $token,
			],
			$this->get_auth_url( $is_forget ? 'reset-password' : 'verify-email' )
		);

		$site_name = get_bloginfo( 'name' );
		$subject   = $is_forget
			? sprintf(
				/* translators: %s: site name. */
				__( 'Recover Your %s Password', 'ytism' ),
				$site_name
			)
			: sprintf(
				/* translators: %s: site name. */
				__( '%s Email Verification', 'ytism' ),
				$site_name
			);

		ob_start();
		Template::load(
			'verification-email.php',
			[
				'email' => [
					'subject'     => $subject,
					'username'    => $user->display_name,
					'verify_link' => $verify_link,
					'is_otp'      => $is_otp,
					'otp'         => $otp,
					'is_forget'   => $is_forget,
				],
			]
		);
		$email_html = ob_get_clean();

		$sent = wp_mail( $email, $subject, $email_html, [ 'Content-Type: text/html; charset=UTF-8' ] );

		if ( ! $sent ) {
			return new WP_Error( 'mail_failed', __( 'Failed to send email. Please try again later.', 'ytism' ) );
		}

		return [
			'success'       => true,
			'message'       => $is_forget ? __( 'Password reset email sent successfully.', 'ytism' ) : __( 'Verification email sent successfully.', 'ytism' ),
			'cooldown_next' => $cooldowns[ $sent_count + 1 ] ?? end( $cooldowns ),
		];
	}

	/**
	 * Verify token or OTP
	 *
	 * @param int    $user_id User ID.
	 * @param string $input   Token or OTP input.
	 * @param bool   $delete_data Whether to delete token data after verification.
	 * @return array<string, mixed>|WP_Error
	 */
	private function verify_token_or_otp( int $user_id, string $input, bool $delete_data = false ): array|WP_Error {
		$user = get_user_by( 'id', $user_id );
		if ( ! $user ) {
			return new WP_Error( 'user_not_found', __( 'The action could not be completed because the user was not found.', 'ytism' ) );
		}

		$token_data = get_user_meta( $user_id, 'ytism_alias_token_data', true );
		if ( ! is_array( $token_data ) || empty( $token_data['token'] ) ) {
			return new WP_Error( 'token_not_found', __( 'The verification token or OTP (One-Time-Password) you entered is invalid.', 'ytism' ) );
		}

		$now = time();
		if ( empty( $token_data['expiry'] ) || $now > intval( $token_data['expiry'] ) ) {
			return new WP_Error( 'expired_token', __( 'This verification link or OTP (One-Time-Password) is no longer valid. Please request a new one.', 'ytism' ) );
		}

		$stored_token = $token_data['token'];
		if ( hash_equals( $stored_token, $input ) ) {
			$is_valid = true;
		} else {
			$decrypted = Functions::decrypt_str( $stored_token );
			$is_valid  = $decrypted && hash_equals( (string) $decrypted, (string) $input );
		}

		if ( ! $is_valid ) {
			return new WP_Error( 'invalid_token', __( 'The verification token or OTP (One-Time-Password) you entered is invalid.', 'ytism' ) );
		}

		if ( $delete_data ) {
			$this->delete_user_token_data( $user_id );
		}

		return [
			'success'     => true,
			'verified_as' => is_numeric( $input ) ? 'otp' : 'token',
			'message'     => __( 'Verification successful! You can now log in to your account.', 'ytism' ),
		];
	}

	/**
	 * Delete user token data
	 *
	 * @param int $user_id User ID.
	 * @return void
	 */
	private function delete_user_token_data( int $user_id ): void {
		$token_data = get_user_meta( $user_id, 'ytism_alias_token_data', true );

		if ( ! is_array( $token_data ) ) {
			$token_data = [];
		}

		// Remove only sensitive token/expiry fields.
		unset( $token_data['token'], $token_data['expiry'] );

		update_user_meta( $user_id, 'ytism_alias_token_data', $token_data );
	}

	/**
	 * Handle register process core
	 *
	 * @return array<string, mixed> Response data
	 */
	private function process_register_core(): array {
		if (
			! isset( $_POST['nonce'] )
			|| ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_register_nonce' )
		) {
			return [
				'success' => false,
				/* translators: Displayed when a security nonce check fails. */
				'message' => esc_html__( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Nonce already verified above.
		$first_name = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name  = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$email      = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Passwords should not be sanitized to avoid altering valid characters.
		$password = isset( $_POST['password'] ) ? wp_unslash( $_POST['password'] ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Passwords should not be sanitized to avoid altering valid characters.
		$confirm_password = isset( $_POST['confirm_password'] ) ? wp_unslash( $_POST['confirm_password'] ) : '';
		$terms            = isset( $_POST['terms'] ) && (bool) $_POST['terms'];
		// phpcs:enable WordPress.Security.NonceVerification.Recommended.

		$filtered = apply_filters(
			'ytism_register_data',
			[
				'first_name'       => $first_name,
				'last_name'        => $last_name,
				'email'            => $email,
				'password'         => $password,
				'confirm_password' => $confirm_password,
				'terms'            => $terms,
				'errors'           => [],
				'response'         => null,
				'user_id'          => null,
				'stage'            => 'before_validation',
			]
		);

		$first_name       = $filtered['first_name'];
		$last_name        = $filtered['last_name'];
		$email            = $filtered['email'];
		$password         = $filtered['password'];
		$confirm_password = $filtered['confirm_password'];
		$terms            = $filtered['terms'];
		$errors           = $filtered['errors'];

		if ( empty( $first_name ) ) {
			$errors['first_name'] = __( 'First name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $first_name ) ) {
			$errors['first_name'] = __( 'Please enter a valid first name.', 'ytism' );
		}
		if ( empty( $last_name ) ) {
			$errors['last_name'] = __( 'Last name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $last_name ) ) {
			$errors['last_name'] = __( 'Please enter a valid last name.', 'ytism' );
		}
		if ( empty( $email ) || ! is_email( $email ) ) {
			$errors['email'] = __( 'Valid email is required.', 'ytism' );
		}
		if ( empty( $password ) || strlen( $password ) < 6 ) {
			$errors['password'] = __( 'Password must be at least 6 characters.', 'ytism' );
		}
		if ( $password !== $confirm_password ) {
			$errors['confirm_password'] = __( 'Passwords do not match.', 'ytism' );
		}
		if ( ! $terms ) {
			$errors['terms'] = __( 'You must agree to the terms and conditions.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		$email_user = AliasUser::load_by_alias_email( $email );
		if ( $email_user && $email_user instanceof AliasUser && $email_user->exists() ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'User with this email already exists.', 'ytism' ),
						],
						'stage'    => 'alias_email_exists',
					]
				)
			)['response'];
		}

		$api      = new Api();
		$register = $api->user_exists( $email );
		$data     = $register['data'] ?? [];

		// check if server issues or not.
		if ( false === $register['success'] ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $register['message'] ?? __( 'Server error, please try again later.', 'ytism' ),
						],
						'stage'    => 'api_error',
					]
				)
			)['response'];
		}

		if ( isset( $data['emailInUse'] ) && $data['emailInUse'] ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'User with this email already exists.', 'ytism' ),
						],
						'stage'    => 'alias_email_exists',
					]
				)
			)['response'];
		}

		// Create Alias User.
		$user_id = AliasUser::add_user(
			[
				'email'    => $email,
				'name'     => $first_name,
				'lastName' => $last_name,
				'password' => $password,
			],
			false
		);

		if ( is_wp_error( $user_id ) ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $user_id->get_error_message(),
						],
						'stage'    => 'wp_user_creation_failed',
					]
				)
			)['response'];
		}

		$verification_email = $this->send_verification_email( $user_id, true, false );
		if ( is_wp_error( $verification_email ) ) {
			// Keep log with error details.
			Functions::log_debug( 'Verification email sending failed after registration for user ID #' . $user_id . '. Error: ' . $verification_email->get_error_message() );
		}

		return apply_filters(
			'ytism_register_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => true,
						'message' => __( 'Registration successful. Please verify your email to login', 'ytism' ),
						'data'    => [
							'uid' => Functions::encrypt_str( (string) $user_id ),
						],
					],
					'stage'    => 'success',
				]
			)
		)['response'];
	}

	/**
	 * Handle forgot password process core
	 */
	private function process_forget_password_core() {
		if (
			! isset( $_POST['nonce'] )
			|| ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_forget_pass_nonce' )
		) {
			return [
				'success' => false,
				/* translators: Displayed when a security nonce check fails. */
				'message' => esc_html__( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		$username = isset( $_POST['username'] ) ? sanitize_text_field( wp_unslash( $_POST['username'] ) ) : '';

		$filtered = apply_filters(
			'ytism_forget_pass_data',
			[
				'username' => $username,
				'errors'   => [],
				'response' => null,
				'stage'    => 'before_validation',
			]
		);

		$username = $filtered['username'];
		$errors   = [];

		if ( empty( $username ) ) {
			$errors['username'] = __( 'Username or email is required.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_forget_pass_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		// Define reusable error response.
		$not_found_response = apply_filters(
			'ytism_forget_pass_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => false,
						'message' => __( 'No matching account was found. Please check your username or email.', 'ytism' ),
					],
					'stage'    => 'invalid_email_or_username',
				]
			)
		)['response'];

		$wp_user_id = null;
		if ( ! is_email( $username ) ) {
			$user = get_user_by( 'login', $username );

			if ( ! $user ) {
				return $not_found_response;
			}

			$alias_user = new AliasUser( $user->ID );
			if ( $alias_user && $alias_user->exists() ) {
				$wp_user_id = $user->ID;
			} else {
				return $not_found_response;
			}
		}

		if ( ! $wp_user_id ) {
			$alias_user = AliasUser::load_by_alias_email( $username );
			if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() ) {
				$wp_user_id = $alias_user->get_wp_user_id();
			} else {
				return $not_found_response;
			}
		}

		$user = get_user_by( 'id', $wp_user_id );
		if ( ! $user ) {
			return $not_found_response;
		}

		// Send verification email.
		$verification_email = $this->send_verification_email( $user->ID, false, true );
		if ( is_wp_error( $verification_email ) ) {
			return apply_filters(
				'ytism_forget_pass_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $verification_email->get_error_message(),
						],
						'stage'    => 'email_send_failed',
					]
				)
			)['response'];
		}

		return apply_filters(
			'ytism_forget_pass_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => true,
						'message' => __( "We've sent you a password reset link or OTP (One-Time-Password) to your email. Please check and follow the instructions to continue.", 'ytism' ),
					],
					'stage'    => 'success',
				]
			)
		)['response'];
	}

	/**
	 * Handle reset password process core
	 */
	private function process_reset_password_core() {
		$uid     = isset( $_POST['uid'] ) ? sanitize_text_field( wp_unslash( $_POST['uid'] ) ) : '';
		$otp     = isset( $_POST['otp'] ) ? sanitize_text_field( wp_unslash( $_POST['otp'] ) ) : '';
		$user_id = Functions::decrypt_str( $uid );

		if ( empty( $user_id ) || $user_id <= 0 || ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_reset_pass_nonce_' . $user_id ) ) {
			return [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Passwords should not be sanitized to avoid altering valid characters.
		$new_password = isset( $_POST['new_password'] ) ? wp_unslash( $_POST['new_password'] ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Passwords should not be sanitized to avoid altering valid characters.
		$confirm_password = isset( $_POST['confirm_password'] ) ? wp_unslash( $_POST['confirm_password'] ) : '';

		$errors = [];

		$filtered = apply_filters(
			'ytism_reset_pass_data',
			[
				'user_id'          => $user_id,
				'new_password'     => $new_password,
				'confirm_password' => $confirm_password,
				'errors'           => [],
				'response'         => null,
				'stage'            => 'before_validation',
			]
		);

		$new_password     = $filtered['new_password'];
		$confirm_password = $filtered['confirm_password'];

		if ( empty( $new_password ) || strlen( $new_password ) < 6 ) {
			$errors['new_password'] = __( 'Valid new password is required (min 6 characters).', 'ytism' );
		}
		if ( $new_password !== $confirm_password ) {
			$errors['confirm_password'] = __( 'Passwords do not match.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_reset_pass_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		$user = get_user_by( 'id', $user_id );
		if ( ! $user ) {
			return apply_filters(
				'ytism_reset_pass_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Invalid action. The user does not exist.', 'ytism' ),
						],
						'stage'    => 'user_not_found',
					]
				)
			)['response'];
		}

		// Update API password.
		// Update wp user password.
		wp_set_password( $new_password, $user_id );
		$encrypted_pass = Functions::encrypt_str( $new_password );
		update_user_meta( $user_id, 'ytism_alias_password', $encrypted_pass );
		update_user_meta( $user_id, 'ytism_alias_verified', 1 );
		$this->delete_user_token_data( $user_id );

		return apply_filters(
			'ytism_reset_pass_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => true,
						'message' => sprintf(
							wp_kses_post(
								/* translators: %1$s and %2$s wrap the login link. */
								__( 'Password has been reset successfully. Click here to %1$slog in%2$s.', 'ytism' )
							),
							'<a href="' . esc_url( $this->get_auth_url() ) . '">',
							'</a>'
						),
					],
					'stage'    => 'success',
				]
			)
		)['response'];
	}

	/**
	 * Handle OTP verification core
	 */
	private function process_otp_verify_core() {
		$uid     = isset( $_POST['uid'] ) ? sanitize_text_field( wp_unslash( $_POST['uid'] ) ) : '';
		$otp     = isset( $_POST['otp'] ) ? sanitize_text_field( wp_unslash( $_POST['otp'] ) ) : '';
		$user_id = Functions::decrypt_str( $uid );

		if ( empty( $user_id ) || $user_id <= 0 || ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_otp_verify_nonce_' . $user_id ) ) {
			return [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		$alias_verified = get_user_meta( $user_id, 'ytism_alias_verified', true );
		if ( $alias_verified ) {
			return [
				'success' => false,
				'message' => __( 'Email already verified — please proceed to login.', 'ytism' ),
			];
		}

		// Resend OTP.
		if ( isset( $_POST['resend_otp'] ) ) {
			$verification_email = $this->send_verification_email( $user_id, true, false );
			if ( is_wp_error( $verification_email ) ) {
				return [
					'success' => false,
					'message' => $verification_email->get_error_message(),
				];
			}

			return [
				'success'    => true,
				'resend_otp' => true,
				'message'    => __( "We've sent you a password reset link or OTP (One-Time-Password) to your email.", 'ytism' ),
			];
		}

		$errors   = [];
		$filtered = apply_filters(
			'ytism_otp_verify_data',
			[
				'user_id'  => $user_id,
				'otp'      => $otp,
				'errors'   => [],
				'response' => null,
				'stage'    => 'before_validation',
			]
		);

		$otp = $filtered['otp'];

		if ( empty( $otp ) || ! preg_match( '/^\d{6}$/', $otp ) ) {
			$errors['otp'] = __( 'Valid OTP (One-Time-Password) is required.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_otp_verify_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		$user = get_user_by( 'id', $user_id );
		if ( ! $user ) {
			return apply_filters(
				'ytism_otp_verify_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Invalid action. The user does not exist.', 'ytism' ),
						],
						'stage'    => 'user_not_found',
					]
				)
			)['response'];
		}

		$verification = $this->verify_token_or_otp( $user_id, $otp, false );
		if ( is_wp_error( $verification ) ) {
			return apply_filters(
				'ytism_otp_verify_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => wp_kses_post( $verification->get_error_message() ),
						],
						'stage'    => 'invalid_otp',
					]
				)
			)['response'];
		}

		$encrypted_pass = get_user_meta( $user_id, 'ytism_alias_password', true );
		if ( ! empty( $encrypted_pass ) ) {
			$real_pass = Functions::decrypt_str( $encrypted_pass );
			wp_set_password( $real_pass, $user_id );
		}
		update_user_meta( $user_id, 'ytism_alias_verified', 1 );
		$this->delete_user_token_data( $user_id );

		// Login the user automatically.
		wp_set_current_user( $user_id );
		wp_set_auth_cookie( $user_id, false );
		do_action( 'wp_login', $user->user_login, $user );

		// Prepare redirect URL if needed.
		$redirect_url   = ! empty( $_POST['redirect_to'] ) ? esc_url_raw( wp_unslash( $_POST['redirect_to'] ) ) : ( ! empty( Functions::get_myaccount_page_url() ) ? Functions::get_myaccount_page_url() : home_url( '/' ) );
		$ytism_plan     = isset( $_POST['ytism_plan'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_plan'] ) ) : '';
		$ytism_price_id = isset( $_POST['ytism_price_id'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_price_id'] ) ) : '';
		$ytism_currency = isset( $_POST['ytism_currency'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_currency'] ) ) : '';
		$ytism_quantity = isset( $_POST['ytism_quantity'] ) ? intval( $_POST['ytism_quantity'] ) : 1;

		if ( ! empty( $ytism_plan ) && ! empty( $ytism_price_id ) && ! empty( $ytism_currency ) ) {
			$redirect_url = Functions::get_checkout_page_url(
				'',
				[
					'plan'     => $ytism_plan,
					'price_id' => $ytism_price_id,
					'currency' => $ytism_currency,
					'quantity' => max( 1, $ytism_quantity ),
				]
			);
		}

		return apply_filters(
			'ytism_otp_verify_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success'      => true,
						'redirect_url' => $redirect_url,
						'message'      => sprintf(
							wp_kses_post(
								/* translators: %1$s and %2$s wrap the login link. */
								__( 'OTP (One-Time-Password) verification successful! %1$sClick here%2$s to log in.', 'ytism' )
							),
							'<a href="' . esc_url( $this->get_auth_url() ) . '">',
							'</a>'
						),
					],
					'stage'    => 'success',
				]
			)
		)['response'];
	}

	/**
	 * Handle login process core
	 */
	private function process_login_core() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_login_nonce' ) ) {
			return [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		$username = isset( $_POST['email'] ) ? sanitize_text_field( wp_unslash( $_POST['email'] ) ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Passwords should not be sanitized to avoid altering valid characters.
		$password = isset( $_POST['password'] ) ? wp_unslash( $_POST['password'] ) : '';
		$remember = isset( $_POST['remember'] ) ? (bool) $_POST['remember'] : false;
		$errors   = [];

		$filtered = apply_filters(
			'ytism_login_data',
			[
				'username' => $username,
				'password' => $password,
				'remember' => $remember,
				'errors'   => [],
				'response' => null,
				'stage'    => 'before_validation',
			]
		);

		// overwrite if filtered changed.
		$username = $filtered['username'];
		$password = $filtered['password'];
		$remember = $filtered['remember'];

		// Prepare redirect URL if needed.
		$redirect_url   = ! empty( $_POST['redirect_to'] ) ? esc_url_raw( wp_unslash( $_POST['redirect_to'] ) ) : ( ! empty( Functions::get_myaccount_page_url() ) ? Functions::get_myaccount_page_url() : home_url( '/' ) );
		$ytism_plan     = isset( $_POST['ytism_plan'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_plan'] ) ) : '';
		$ytism_price_id = isset( $_POST['ytism_price_id'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_price_id'] ) ) : '';
		$ytism_currency = isset( $_POST['ytism_currency'] ) ? sanitize_text_field( wp_unslash( $_POST['ytism_currency'] ) ) : '';
		$ytism_quantity = isset( $_POST['ytism_quantity'] ) ? intval( $_POST['ytism_quantity'] ) : 1;

		if ( ! empty( $ytism_plan ) && ! empty( $ytism_price_id ) && ! empty( $ytism_currency ) ) {
			$redirect_url = Functions::get_checkout_page_url(
				'',
				[
					'plan'     => $ytism_plan,
					'price_id' => $ytism_price_id,
					'currency' => $ytism_currency,
					'quantity' => max( 1, $ytism_quantity ),
				]
			);
		}

		// Basic validation.
		if ( empty( $username ) ) {
			$errors['username'] = __( 'Username or email is required.', 'ytism' );
		}
		if ( empty( $password ) ) {
			$errors['password'] = __( 'Password is required.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_login_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		$email = $username;
		if ( ! is_email( $username ) ) {
			$user = get_user_by( 'login', $username );
			if ( ! $user ) {
				return apply_filters(
					'ytism_login_data',
					array_merge(
						$filtered,
						[
							'response' => [
								'success' => false,
								'message' => __( 'Invalid username/email or password.', 'ytism' ),
							],
							'stage'    => 'user_not_found',
						]
					)
				)['response'];
			}
			$alias_user = new AliasUser( $user->ID );
			if ( $alias_user && $alias_user->exists() ) {
				$email = $alias_user->get_email();
			}
		}

		if ( is_email( $email ) ) {
			$api   = new Api();
			$login = $api->login_user( $email, $password );

			// API error.
			if ( isset( $login['type'] ) && 'error' === $login['type'] ) {
				return apply_filters(
					'ytism_login_data',
					array_merge(
						$filtered,
						[
							'response' => [
								'success' => false,
								'message' => $login['message'] ?? __( 'Login failed. Please try again.', 'ytism' ),
							],
							'stage'    => 'api_error',
						]
					)
				)['response'];
			}

			// API login success.
			if ( isset( $login['success'], $login['type'], $login['data']['token'], $login['data']['user'] ) && 'login_success' ) {
				$data = $login['data'];

				$alias_user = AliasUser::load_by_alias_id( $data['user']['userId'] );
				if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() ) {
					$alias_user->update_user( $data['user'], $data['token'] );
				} else {
					$wp_user_id = AliasUser::add_user( $data['user'], true, false );

					if ( is_wp_error( $wp_user_id ) || ! $wp_user_id || $wp_user_id <= 0 ) {
						$message = is_wp_error( $wp_user_id ) ? $wp_user_id->get_error_message() : __( 'Login failed. Please try again.', 'ytism' );
						return apply_filters(
							'ytism_login_data',
							array_merge(
								$filtered,
								[
									'response' => [
										'success' => false,
										'message' => $message,
									],
									'stage'    => 'alias_user_error',
								]
							)
						)['response'];
					}

					$alias_user = new AliasUser( $wp_user_id );
					if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() ) {
						$alias_user->update_user( $data['user'], $data['token'] );
					}
				}

				if ( ! $alias_user->exists() ) {
					return apply_filters(
						'ytism_login_data',
						array_merge(
							$filtered,
							[
								'response' => [
									'success' => false,
									'message' => __( 'Login failed. Please try again.', 'ytism' ),
								],
								'stage'    => 'alias_user_error',
							]
						)
					)['response'];
				}

				$user = get_user_by( 'id', $alias_user->get_wp_user_id() );

				if ( $user ) {
					$alias_verified = get_user_meta( $user->ID, 'ytism_alias_verified', true );

					if ( 0 === (int) $alias_verified ) {
						return apply_filters(
							'ytism_login_data',
							array_merge(
								$filtered,
								[
									'response' => [
										'success' => false,
										'message' => sprintf(
											wp_kses_post(
												/* translators: %1$s and %2$s wrap the verification link. */
												__( 'Email address is not verified. %1$sClick here%2$s to request a new verification link.', 'ytism' )
											),
											'<a href="' . esc_url( $this->get_auth_url( 'forget-password' ) ) . '">',
											'</a>'
										),
									],
									'stage'    => 'wp_user_not_verified',
								]
							)
						)['response'];
					}

					if ( is_user_logged_in() ) {
						wp_logout();
					}

					$current_time    = time();
					$max_exp_seconds = $remember ? ( 14 * DAY_IN_SECONDS ) : ( 2 * DAY_IN_SECONDS );
					$exp_timestamp   = max( $alias_user->get_token_expiration(), $current_time + $max_exp_seconds );
					$exp_seconds     = min( ( $exp_timestamp - $current_time - 300 ), $max_exp_seconds );

					/**
					 * Adjust the authentication cookie expiration time.
					 *
					 * @param int  $expiration Expiration timestamp for the cookie.
					 * @param int  $user_id    User ID.
					 * @param bool $remember   Whether to remember the user.
					 *
					 * @return int New expiration timestamp.
					 */
					// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- Required parameters for the filter.
					$auth_cookie_filter = static function ( int $expiration, int $user_id, bool $remember ) use ( $exp_seconds ): int {
						return $exp_seconds;
					};

					add_filter( 'auth_cookie_expiration', $auth_cookie_filter, 10, 3 );
					wp_set_current_user( $user->ID );
					wp_set_auth_cookie( $user->ID, true );
					do_action( 'wp_login', $user->user_login, get_userdata( $user->ID ) );
					remove_filter( 'auth_cookie_expiration', $auth_cookie_filter, 10 );

					return apply_filters(
						'ytism_login_data',
						array_merge(
							$filtered,
							[
								'response' => [
									'success'      => true,
									'message'      => __( 'Login successful.', 'ytism' ),
									'redirect_url' => $redirect_url,
									'data'         => [
										'user_id' => $alias_user->get_wp_user_id(),
									],
								],
								'stage'    => 'success',
							]
						)
					)['response'];
				}

				return apply_filters(
					'ytism_login_data',
					array_merge(
						$filtered,
						[
							'response' => [
								'success' => false,
								'message' => __( 'Login failed. Please try again.', 'ytism' ),
							],
							'stage'    => 'wp_user_not_found',
						]
					)
				)['response'];
			}

			// wp fallback if API login failed.
			$alias_user = AliasUser::load_by_alias_email( $email );
			if ( $alias_user && $alias_user->exists() ) {
				$user = get_user_by( 'id', $alias_user->get_wp_user_id() );
				if ( $user ) {
					$alias_verified = get_user_meta( $user->ID, 'ytism_alias_verified', true );

					if ( 1 === (int) $alias_verified ) {
						if ( ! wp_check_password( $password, $user->user_pass, $user->ID ) ) {
							return apply_filters(
								'ytism_login_data',
								array_merge(
									$filtered,
									[
										'response' => [
											'success' => false,
											'message' => __( 'Invalid username/email or password.', 'ytism' ),
										],
										'stage'    => 'wp_user_password_mismatch',
									]
								)
							)['response'];
						}
					} else {
						$stored_pass = Functions::decrypt_str( get_user_meta( $user->ID, 'ytism_alias_password', true ) );
						if ( ! $stored_pass || ! hash_equals( (string) $stored_pass, $password ) ) {
							return apply_filters(
								'ytism_login_data',
								array_merge(
									$filtered,
									[
										'response' => [
											'success' => false,
											'message' => __( 'Invalid username/email or password.', 'ytism' ),
										],
										'stage'    => 'wp_user_password_mismatch',
									]
								)
							)['response'];
						}

						return apply_filters(
							'ytism_login_data',
							array_merge(
								$filtered,
								[
									'response' => [
										'success' => false,
										'message' => sprintf(
											wp_kses_post(
												/* translators: %1$s and %2$s wrap the verification link. */
												__( 'Email address is not verified. %1$sClick here%2$s to request a new verification link.', 'ytism' )
											),
											'<a href="' . esc_url( $this->get_auth_url( 'forget-password' ) ) . '">',
											'</a>'
										),
									],
									'stage'    => 'wp_user_not_verified',
								]
							)
						)['response'];
					}

					if ( is_user_logged_in() ) {
						wp_logout();
					}

					$wp_user = wp_signon(
						[
							'user_login'    => $user->user_login,
							'user_password' => $password,
							'remember'      => $remember,
						],
						false
					);

					if ( is_wp_error( $wp_user ) ) {
						return apply_filters(
							'ytism_login_data',
							array_merge(
								$filtered,
								[
									'response' => [
										'success' => false,
										'message' => $wp_user->get_error_message(),
									],
									'stage'    => 'wp_signon_failed',
								]
							)
						)['response'];
					}

					return apply_filters(
						'ytism_login_data',
						array_merge(
							$filtered,
							[
								'response' => [
									'success'      => true,
									'message'      => __( 'Login successful.', 'ytism' ),
									'redirect_url' => $redirect_url,
									'data'         => [
										'user_id' => $wp_user->ID,
									],
								],
								'stage'    => 'success',
							]
						)
					)['response'];
				}

				return apply_filters(
					'ytism_login_data',
					array_merge(
						$filtered,
						[
							'response' => [
								'success' => false,
								'message' => __( 'Invalid action. The user does not exist.', 'ytism' ),
							],
							'stage'    => 'wp_user_not_found',
						]
					)
				)['response'];
			}

			// API failed & no WP fallback.
			return apply_filters(
				'ytism_login_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $login['message'] ?? __( 'Invalid response, please try again later.', 'ytism' ),
						],
						'stage'    => 'invalid_api_response',
					]
				)
			)['response'];
		}

		return apply_filters(
			'ytism_login_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => false,
						'message' => __( 'Invalid login details.', 'ytism' ),
					],
					'stage'    => 'invalid_input',
				]
			)
		)['response'];
	}

	/**
	 * Handle user logout.
	 */
	private function process_logout_core() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_logout_nonce' ) ) {
			return [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		if ( is_user_logged_in() ) {
			wp_logout();
		}

		return apply_filters(
			'ytism_logout_data',
			[
				'response' => [
					'success' => true,
					'message' => __( 'Logout successful.', 'ytism' ),
				],
				'stage'    => 'success',
			]
		)['response'];
	}

	/**
	 * Render Registration Form
	 */
	public function render_register_enterprise_window() {
		ob_start();
		$unique_id = uniqid( 'ytism-' );

		$organization_name = isset( $_POST['organization_name'] ) ? sanitize_text_field( wp_unslash( $_POST['organization_name'] ) ) : '';
		$organization_type = isset( $_POST['organization_type'] ) ? sanitize_text_field( wp_unslash( $_POST['organization_type'] ) ) : '';
		$departments       = isset( $_POST['departments'] ) && is_array( $_POST['departments'] ) ? array_map( 'intval', $_POST['departments'] ) : [];
		$country           = isset( $_POST['country'] ) ? intval( $_POST['country'] ) : '';
		$first_name        = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name         = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$phone_number      = isset( $_POST['phone_number_full'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number_full'] ) ) : ( isset( $_POST['phone_number'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number'] ) ) : '' );
		$email             = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$terms             = isset( $_POST['terms'] ) ? (bool) $_POST['terms'] : false;
		?>
		<form method="post" class="ytism-register-form ytism-enterprise-register-form" id="<?php echo esc_attr( $unique_id . '-enterprise-register-form' ); ?>">
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_organization_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Organization Name:', 'ytism' ); ?></label>
				<input type="text" name="organization_name"
					id="<?php echo esc_attr( $unique_id . '_organization_name' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Organization name', 'ytism' ); ?>"
					value="<?php echo esc_attr( $organization_name ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_organization_type' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Organization Name:', 'ytism' ); ?></label>
				<select name="organization_type" class="ytism-select2"
					id="<?php echo esc_attr( $unique_id . '_organization_type' ); ?>"
					placeholder="<?php esc_attr_e( 'Select organization type', 'ytism' ); ?>"
					required>
					<option value=""><?php esc_html_e( 'Select organization type', 'ytism' ); ?></option>
					<option value="1" <?php selected( $organization_type, 'Corporate' ); ?>><?php esc_html_e( 'Company', 'ytism' ); ?></option>
					<option value="2" <?php selected( $organization_type, 'QR Code Plan' ); ?>><?php esc_html_e( 'QR Code Plan', 'ytism' ); ?></option>
				</select>
				<div class="ytism-form-text">
					<?php esc_html_e( 'QR Code Plan - For hotels; Company Plan - For corporate organizations.', 'ytism' ); ?>
				</div>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_department' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Department:', 'ytism' ); ?></label>
				<select name="departments[]" class="ytism-select2" id="<?php echo esc_attr( $unique_id . '_department' ); ?>" placeholder="<?php echo esc_attr__( 'Select department', 'ytism' ); ?>" multiple required>
					<?php foreach ( $this->departments as $id => $name ) : ?>
						<option
							value="<?php echo esc_attr( $id ); ?>"
							<?php selected( in_array( $id, (array) $departments, true ) ); ?>
						>
							<?php echo esc_html( $name ); ?>
						</option>
					<?php endforeach; ?>
				</select>
				<div class="ytism-form-text"><?php esc_html_e( 'Your selected departments will be reflected once your organization has been created.', 'ytism' ); ?></div>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_country' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Coutry:', 'ytism' ); ?></label>
				<select name="country" class="ytism-select2" id="<?php echo esc_attr( $unique_id . '_country' ); ?>" placeholder="<?php echo esc_attr__( 'Select country', 'ytism' ); ?>" required>
					<option value="">
						<?php echo esc_html__( 'Select country', 'ytism' ); ?>
					</option>

					<?php foreach ( $this->countries as $id => $name ) : ?>
						<option
							value="<?php echo esc_attr( $id ); ?>"
							<?php selected( $country, $id ); ?>
						>
							<?php echo esc_html( $name ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_first_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Contact person first name:', 'ytism' ); ?></label>
				<input type="text" name="first_name"
					id="<?php echo esc_attr( $unique_id . '_first_name' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Contact person first name', 'ytism' ); ?>"
					value="<?php echo esc_attr( $first_name ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_last_name' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Contact person last name:', 'ytism' ); ?></label>
				<input type="text" name="last_name"
					id="<?php echo esc_attr( $unique_id . '_last_name' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Contact person last name', 'ytism' ); ?>"
					value="<?php echo esc_attr( $last_name ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_phone_number' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Phone number:', 'ytism' ); ?></label>
				<input type="tel" name="phone_number" class="ytism-intl-tel-input"
					id="<?php echo esc_attr( $unique_id . '_phone_number' ); ?>"
					maxlength="25"
					required
					placeholder="<?php esc_attr_e( 'Phone number', 'ytism' ); ?>"
					value="<?php echo esc_attr( $phone_number ); ?>">
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_email' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Contact Person Email:', 'ytism' ); ?></label>
				<input type="email" name="email"
					id="<?php echo esc_attr( $unique_id . '_email' ); ?>"
					maxlength="100"
					required
					placeholder="<?php esc_attr_e( 'Contact person email address', 'ytism' ); ?>"
					value="<?php echo esc_attr( $email ); ?>">
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_password' ); ?>" class="ytism-form-field-label not-require"><?php esc_html_e( 'Create a password:', 'ytism' ); ?></label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="password"
						id="<?php echo esc_attr( $unique_id . '_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'Create a password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>"><i class='ytism-icon ytism-icon-eye'></i></button>
				</div>
				<div id="<?php echo esc_attr( $unique_id . '_password_meter' ); ?>" class="ytism-form-password-meter"></div>
			</div>
			<div class="ytism-form-field ytism-form-password-field">
				<label for="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>" class="ytism-form-field-label not-require">
					<?php esc_html_e( 'Confirm the password:', 'ytism' ); ?>
				</label>
				<div class="ytism-form-field-password-wrapper">
					<input type="password" name="confirm_password"
						id="<?php echo esc_attr( $unique_id . '_confirm_password' ); ?>"
						minlength="6"
						maxlength="64"
						autocomplete="new-password"
						placeholder="<?php esc_attr_e( 'Re-enter the password', 'ytism' ); ?>"
						required>
					<button type="button" class="ytism-form-toggle-password" aria-label="<?php esc_attr_e( 'Toggle Password', 'ytism' ); ?>">
						<i class='ytism-icon ytism-icon-eye'></i>
					</button>
				</div>
			</div>
			<div class="ytism-form-field">
				<label for="<?php echo esc_attr( $unique_id . '_terms' ); ?>" class="ytism-form-field-label ytism-form-field-label-checkbox ytism-form-field-terms require">
					<input type="checkbox" name="terms" id="<?php echo esc_attr( $unique_id . '_terms' ); ?>" required value="1" <?php checked( $terms, true ); ?>/>
					
					<?php
					printf(
						wp_kses_post(
							/* translators: 1: opening anchor tag for Terms of Use, 2: closing anchor tag for Terms of Use, 3: opening anchor tag for Privacy Policy and Subscription Terms, 4: closing anchor tag for Privacy Policy and Subscription Terms. */
							__( 'By clicking Subscribe, you confirm and affirm that you have read, understood and agreed to our %1$sTerms of Use%2$s, %3$sPrivacy Policy and Subscription Terms%4$s.', 'ytism' )
						),
						'<a href="' . esc_url( Functions::get_terms_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
						'</a>',
						'<a href="' . esc_url( Functions::get_privacy_page_url() ) . '" target="_blank" rel="noopener noreferrer">',
						'</a>'
					);
					?>
				</label>
			</div>

			<?php wp_nonce_field( 'ytism_register_enterprise_nonce', 'nonce' ); ?>
			<input type="hidden" name="auth_action" value="enterprise-register" />

			<button type="submit" name="ytism_register" class="ytism-btn ytism-register-enterprise-btn" id="<?php echo esc_attr( $unique_id . '_ytism_register' ); ?>">
				<?php esc_html_e( 'Subscribe', 'ytism' ); ?>
				<span class="ytism-btn-spinner" style="display:none;"></span>
			</button>
		</form>
		<?php
		return ob_get_clean();
	}

	/**
	 * Handle enterprise registration process core
	 */
	private function process_register_enterprise_core() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['nonce'] ) ), 'ytism_register_enterprise_nonce' ) ) {
			return [
				'success' => false,
				'message' => __( 'Security check failed. Please refresh the page and try again.', 'ytism' ),
			];
		}

		$phone_util        = PhoneNumberUtil::getInstance();
		$organization_name = isset( $_POST['organization_name'] ) ? sanitize_text_field( wp_unslash( $_POST['organization_name'] ) ) : '';
		$organization_type = isset( $_POST['organization_type'] ) ? intval( $_POST['organization_type'] ) : '';
		$departments       = isset( $_POST['departments'] ) && is_array( $_POST['departments'] ) ? array_map( 'intval', $_POST['departments'] ) : [];
		$country           = isset( $_POST['country'] ) ? intval( $_POST['country'] ) : '';
		$first_name        = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name         = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$phone_number      = isset( $_POST['phone_number_full'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number_full'] ) ) : ( isset( $_POST['phone_number'] ) ? sanitize_text_field( wp_unslash( $_POST['phone_number'] ) ) : '' );
		$email             = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Sanitization not needed here.
		$password = isset( $_POST['password'] ) ? wp_unslash( $_POST['password'] ) : '';
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Sanitization not needed here.
		$confirm_password = isset( $_POST['confirm_password'] ) ? wp_unslash( $_POST['confirm_password'] ) : '';
		$terms            = isset( $_POST['terms'] ) ? (bool) $_POST['terms'] : false;
		$errors           = [];

		$filtered = apply_filters(
			'ytism_enterprise_register_data',
			[
				'organization_name' => $organization_name,
				'organization_type' => $organization_type,
				'departments'       => $departments,
				'country'           => $country,
				'first_name'        => $first_name,
				'last_name'         => $last_name,
				'phone_number'      => $phone_number,
				'email'             => $email,
				'password'          => $password,
				'confirm_password'  => $confirm_password,
				'terms'             => $terms,
				'errors'            => [],
				'response'          => null,
				'stage'             => 'before_validation',
			]
		);

		// overwrite if filtered changed.
		$organization_name = $filtered['organization_name'];
		$organization_type = $filtered['organization_type'];
		$departments       = $filtered['departments'];
		$country           = $filtered['country'];
		$first_name        = $filtered['first_name'];
		$last_name         = $filtered['last_name'];
		$phone_number      = $filtered['phone_number'];
		$email             = $filtered['email'];
		$password          = $filtered['password'];
		$confirm_password  = $filtered['confirm_password'];
		$terms             = $filtered['terms'];
		if ( empty( $organization_name ) ) {
			$errors['organization_name'] = __( 'Organization name is required.', 'ytism' );
		}
		if ( empty( $organization_type ) || ! in_array( $organization_type, [ 1, 2 ], true ) ) {
			$errors['organization_type'] = __( 'Valid organization type is required.', 'ytism' );
		}
		if ( empty( $departments ) ) {
			$errors['departments[]'] = __( 'At least one department is required.', 'ytism' );
		} else {
			foreach ( $departments as $dept ) {
				if ( ! in_array( $dept, array_keys( $this->departments ), true ) ) {
					$errors['departments[]'] = __( 'Valid department is required.', 'ytism' );
					break;
				}
			}
		}
		if ( empty( $country ) || ! in_array( $country, array_keys( $this->countries ), true ) ) {
			$errors['country'] = __( 'Valid country is required.', 'ytism' );
		}
		if ( empty( $first_name ) ) {
			$errors['first_name'] = __( 'First name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $first_name ) ) {
			$errors['first_name'] = __( 'Please enter a valid first name.', 'ytism' );
		}
		if ( empty( $last_name ) ) {
			$errors['last_name'] = __( 'Last name is required.', 'ytism' );
		} elseif ( ! Functions::is_valid_name( $last_name ) ) {
			$errors['last_name'] = __( 'Please enter a valid last name.', 'ytism' );
		}
		if ( empty( $phone_number ) ) {
			$errors['phone_number'] = __( 'Phone number is required.', 'ytism' );
		} else {
			try {
				if ( strpos( $phone_number, '+' ) === 0 ) {
					$parsed_number = $phone_util->parse( $phone_number, $this->default_country );
				} else {
					$parsed_number = $phone_util->parse( $phone_number );
				}

				if ( ! $phone_util->isValidNumber( $parsed_number ) ) {
					$errors['phone_number'] = __( 'Invalid phone number.', 'ytism' );
				}
			} catch ( NumberParseException $e ) {
				$errors['phone_number'] = __( 'Invalid phone number format.', 'ytism' );
			}
		}
		if ( empty( $email ) || ! is_email( $email ) ) {
			$errors['email'] = __( 'Valid email address is required.', 'ytism' );
		}
		if ( empty( $password ) || strlen( $password ) < 6 ) {
			$errors['password'] = __( 'Valid password is required (min 6 characters).', 'ytism' );
		}
		if ( $password !== $confirm_password ) {
			$errors['confirm_password'] = __( 'Password confirmation does not match.', 'ytism' );
		}
		if ( ! $terms ) {
			$errors['terms'] = __( 'You must agree to the terms.', 'ytism' );
		}

		if ( ! empty( $errors ) ) {
			return apply_filters(
				'ytism_enterprise_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Please fix the errors.', 'ytism' ),
							'errors'  => $errors,
						],
						'stage'    => 'validation_failed',
					]
				)
			)['response'];
		}

		$email_user = AliasUser::load_by_alias_email( $email );
		if ( $email_user && $email_user instanceof AliasUser && $email_user->exists() ) {
			return apply_filters(
				'ytism_enterprise_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'User with this email already exists.', 'ytism' ),
						],
						'stage'    => 'alias_email_exists',
					]
				)
			)['response'];
		}

		$org_user = AliasUser::load_by_organization_name( $organization_name );
		if ( $org_user && $org_user instanceof AliasUser && $org_user->exists() ) {
			return apply_filters(
				'ytism_enterprise_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Organization name already in use, please choose another.', 'ytism' ),
						],
						'stage'    => 'alias_organization_exists',
					]
				)
			)['response'];
		}

		$api           = new Api();
		$register      = $api->user_exists(
			[
				'email'            => $email,
				'organizationName' => $organization_name,
			]
		);
		$response_data = $register['data'] ?? [];

		if ( isset( $response_data['emailInUse'] ) && true === $response_data['emailInUse'] ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'User with this email already exists.', 'ytism' ),
						],
						'stage'    => 'api_email_exists',
					]
				)
			)['response'];
		}

		if ( isset( $response_data['organizationNameInUse'] ) && true === $response_data['organizationNameInUse'] ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => __( 'Organization name already in use, please choose another.', 'ytism' ),
						],
						'stage'    => 'api_organization_exists',
					]
				)
			)['response'];
		}

		// check if server issues or not.
		if ( false === $register['success'] ) {
			return apply_filters(
				'ytism_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $register['message'] ?? __( 'Server error, please try again later.', 'ytism' ),
						],
						'stage'    => 'api_error',
					]
				)
			)['response'];
		}

		$country_code    = null;
		$national_number = null;
		if ( ! empty( $phone_number ) ) {
			try {
				if ( strpos( $phone_number, '+' ) === 0 ) {
					$parsed_number = $phone_util->parse( $phone_number, $this->default_country );
				} else {
					$parsed_number = $phone_util->parse( $phone_number );
				}

				if ( $phone_util->isValidNumber( $parsed_number ) ) {
					$country_code    = $parsed_number->getCountryCode();
					$national_number = $parsed_number->getNationalNumber();
				}
			} catch ( NumberParseException $e ) {
				Functions::log_debug(
					sprintf(
						'Phone number parse failed: %s. Error: %s',
						sanitize_text_field( $phone_number ),
						sanitize_text_field( $e->getMessage() )
					)
				);
			}
		}

		// Create Alias user.
		$user_id = AliasUser::add_user(
			[
				'email'               => $email,
				'name'                => $first_name,
				'lastName'            => $last_name,
				'password'            => $password,
				'phoneCountryCode'    => $country_code,
				'phoneNationalNumber' => $national_number,
				'phoneNumberFull'     => $phone_number,
				'countryId'           => $country,
				'countryName'         => $this->countries[ $country ] ?? '',
				'organizationName'    => $organization_name,
				'departmentsId'       => $departments,
				'organizationType'    => $organization_type,
				'organization'        => [
					'name' => $organization_name,
				],
			],
			false
		);

		if ( is_wp_error( $user_id ) ) {
			return apply_filters(
				'ytism_enterprise_register_data',
				array_merge(
					$filtered,
					[
						'response' => [
							'success' => false,
							'message' => $user_id->get_error_message(),
						],
						'stage'    => 'wp_user_creation_failed',
					]
				)
			)['response'];
		}

		$verification_email = $this->send_verification_email( $user_id, true, false );
		if ( is_wp_error( $verification_email ) ) {
			// Keep log with error details.
			Functions::log_debug( 'Verification email sending failed after registration for user ID ' . $user_id . '. Error: ' . $verification_email->get_error_message() );
		}

		return apply_filters(
			'ytism_enterprise_register_data',
			array_merge(
				$filtered,
				[
					'response' => [
						'success' => true,
						'message' => __( 'Registration successful. Please verify your email to login', 'ytism' ),
						'data'    => [
							'uid' => Functions::encrypt_str( (string) $user_id ),
						],
					],
					'stage'    => 'success',
				]
			)
		)['response'];
	}
}
