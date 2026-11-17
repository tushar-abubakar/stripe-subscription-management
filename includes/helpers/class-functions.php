<?php
namespace YTISM\Helpers;

use WP_Error;
use DateTimeZone;
use YTISM\Core\AliasUser;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Functions {
	private static $settings = [];

	public function __construct() {
		self::$settings = get_option( 'ytism_settings', [] );
	}

	/**
	 * get options
	 */
	public static function get_settings( $key = null, $default = null ): array|string|null {
		if ( $key ) {
			return self::$settings[ $key ] ?? $default;
		}
		return self::$settings ?: $default;
	}

	/**
	 * Get currency symbol from currency code
	 */
	public static function get_currency_symbol( string $currency_code ): string {
		$currency_code    = strtolower( $currency_code );
		$currency_symbols = [
			'usd' => '&#x24;',
			'aud' => 'A&#x24;',
			'cad' => 'CA&#x24;',
			'nzd' => 'NZ&#x24;',
			'sgd' => 'S&#x24;',
			'hkd' => 'HK&#x24;',
			'mxn' => 'MX&#x24;',
			'twd' => 'NT&#x24;',
			'fjd' => 'FJ&#x24;',
			'bzd' => 'BZ&#x24;',
			'jmd' => 'J&#x24;',
			'dzd' => '&#x62f;.&#x62c;',
			'egp' => '&#xA3;',
			'kwd' => '&#x62f;.&#x643;',
			'bhd' => '&#x62f;.&#x628;',
			'sar' => '&#xFDFC;',
			'qar' => '&#xFDFC;',
			'omr' => '&#xFDFC;',
			'irr' => '&#xFDFC;',
			'aed' => '&#x62f;.&#x625;',
			'ngn' => '&#x20A6;',
			'zar' => 'R',
			'eur' => '&#x20AC;',
			'gbp' => '&#xA3;',
			'inr' => '&#x20B9;',
			'jpy' => '&#xA5;',
			'cny' => '&#xA5;',
			'rub' => '&#x20BD;',
			'brl' => 'R&#x24;',
			'sek' => 'kr',
			'nok' => 'kr',
			'dkk' => 'kr',
			'pln' => 'z&#x142;',
			'czk' => 'K&#x10D;',
			'huf' => 'Ft',
			'ron' => 'lei',
			'uah' => '&#x20B4;',
			'gel' => '&#x20BE;',
			'try' => '&#x20BA;',
			'thb' => '&#x0E3F;',
			'myr' => 'RM',
			'idr' => 'Rp',
			'vnd' => '&#x20AB;',
			'krw' => '&#x20A9;',
			'php' => '&#x20B1;',
			'bdt' => '&#x9F3;',
			'lkr' => 'Rs',
			'mmk' => 'K',
			'khr' => '&#x17DB;',
			'mnt' => '&#x20AE;',
			'mzn' => 'MT',
			'kes' => 'KSh',
			'tzs' => 'TSh',
			'ugx' => 'USh',
			'ghs' => '&#x20B5;',
			'mwk' => 'MK',
			'zmw' => 'ZK',
			'ars' => '&#x24;',
			'clp' => '&#x24;',
			'cop' => '&#x24;',
			'pen' => 'S/.',
			'dop' => 'RD&#x24;',
			'gtq' => 'Q',
			'pyg' => '&#x20B2;',
			'uyu' => '&#x24;',
			'bob' => 'Bs.',
			'pab' => 'B/.',
			'ttd' => 'TT&#x24;',
			'xaf' => 'CFA',
			'xof' => 'CFA',
			'xpf' => 'XPF',
			'mga' => 'Ar',
			'mad' => 'DH',
			'lbp' => '&#x644;.&#x644;',
			'scr' => '&#x20A8;',
			'sbd' => '&#x24;',
			'vuv' => 'Vt',
			'wst' => 'WS&#x24;',
			'afn' => '&#x60b;',
			'all' => 'L',
			'amd' => 'AMD',
			'ang' => '&fnof;',
			'aoa' => 'Kz',
			'awg' => 'Afl.',
			'azn' => '&#8380;',
			'bam' => 'KM',
			'bbd' => '&#36;',
			'bgn' => '&#1083;&#1074;.',
			'bif' => 'Fr',
			'bmd' => '&#36;',
			'bnd' => '&#36;',
			'bsd' => '&#36;',
			'btc' => '&#3647;',
			'btn' => 'Nu.',
			'bwp' => 'P',
			'byr' => 'Br',
			'byn' => 'Br',
			'cdf' => 'Fr',
			'chf' => '&#67;&#72;&#70;',
			'crc' => '&#x20a1;',
			'cuc' => '&#36;',
			'cup' => '&#36;',
			'cve' => '&#36;',
			'djf' => 'Fr',
			'ern' => 'Nfk',
			'etb' => 'Br',
			'fkp' => '&pound;',
			'ggp' => '&pound;',
			'gip' => '&pound;',
			'gmd' => 'D',
			'gnf' => 'Fr',
			'gyd' => '&#36;',
			'hnl' => 'L',
			'hrk' => 'kn',
			'htg' => 'G',
			'ils' => '&#8362;',
			'imp' => '&pound;',
			'iqd' => '&#x62f;.&#x639;',
			'irt' => '&#x062A;&#x0648;&#x0645;&#x0627;&#x0646;',
			'isk' => 'kr.',
			'jep' => '&pound;',
			'jod' => '&#x62f;.&#x627;',
			'kgs' => '&#x441;&#x43e;&#x43c;',
			'kmf' => 'Fr',
			'kpw' => '&#x20a9;',
			'kyd' => '&#36;',
			'kzt' => '&#8376;',
			'lak' => '&#8365;',
			'lrd' => '&#36;',
			'lsl' => 'L',
			'lyd' => '&#x62f;.&#x644;',
			'mdl' => 'MDL',
			'mkd' => '&#x434;&#x435;&#x43d;',
			'mop' => 'P',
			'mru' => 'UM',
			'mur' => '&#x20a8;',
			'mvr' => '.&#x783;',
			'nad' => 'N&#36;',
			'nio' => 'C&#36;',
			'npr' => '&#8360;',
			'omr' => '&#x631;.&#x639;.',
			'pgk' => 'K',
			'pkr' => '&#8360;',
			'prb' => '&#x440;.',
			'rsd' => '&#1088;&#1089;&#1076;',
			'rwf' => 'Fr',
			'sdg' => '&#x62c;.&#x633;.',
			'shp' => '&pound;',
			'sll' => 'Le',
			'sos' => 'Sh',
			'srd' => '&#36;',
			'ssp' => '&pound;',
			'stn' => 'Db',
			'syp' => '&#x644;.&#x633;',
			'szl' => 'E',
			'tjs' => '&#x405;&#x41c;',
			'tmt' => 'm',
			'tnd' => '&#x62f;.&#x62a;',
			'top' => 'T&#36;',
			'ugx' => 'UGX',
			'uzs' => 'UZS',
			'vef' => 'Bs F',
			'ves' => 'Bs.',
			'yer' => '&#xfdfc;',
			'xcd' => '&#36;',
		];
		return $currency_symbols[ $currency_code ] ?? ( ! empty( $currency_code ) ? strtoupper( $currency_code ) : '' );
	}

	/**
	 * Get User country
	 */
	public static function get_user_country( string $default = 'US' ): string {
		$geo = self::get_user_location();

		if ( ! empty( $geo['country'] ) ) {
			return strtoupper( $geo['country'] );
		} else {
			$country_code = self::get_country_code_from_timezone();
			if ( $country_code ) {
				return strtoupper( $country_code );
			}
		}

		return $default;
	}

	/**
	 * Get User currency
	 */
	public static function get_user_currency( string $default = 'USD' ): string {
		$country_code = self::get_user_country();
		return self::get_country_currency( $country_code, $default );
	}

	/**
	 * Get currency name from currency code
	 */
	public static function get_country_name_currency( string $country_code ): string {
		$currency_code      = strtolower( $currency_code );
		$currency_countries = [
			'usd' => __( 'United States Dollar (USD)', 'ytism' ),
			'aud' => __( 'Australian Dollar (AUD)', 'ytism' ),
			'cad' => __( 'Canadian Dollar (CAD)', 'ytism' ),
			'nzd' => __( 'New Zealand Dollar (NZD)', 'ytism' ),
			'sgd' => __( 'Singapore Dollar (SGD)', 'ytism' ),
			'hkd' => __( 'Hong Kong Dollar (HKD)', 'ytism' ),
			'mxn' => __( 'Mexican Peso (MXN)', 'ytism' ),
			'twd' => __( 'New Taiwan Dollar (TWD)', 'ytism' ),
			'fjd' => __( 'Fijian Dollar (FJD)', 'ytism' ),
			'bzd' => __( 'Belize Dollar (BZD)', 'ytism' ),
			'jmd' => __( 'Jamaican Dollar (JMD)', 'ytism' ),
			'dzd' => __( 'Algerian Dinar (DZD)', 'ytism' ),
			'egp' => __( 'Egyptian Pound (EGP)', 'ytism' ),
			'kwd' => __( 'Kuwaiti Dinar (KWD)', 'ytism' ),
			'bhd' => __( 'Bahraini Dinar (BHD)', 'ytism' ),
			'sar' => __( 'Saudi Riyal (SAR)', 'ytism' ),
			'qar' => __( 'Qatari Riyal (QAR)', 'ytism' ),
			'omr' => __( 'Omani Rial (OMR)', 'ytism' ),
			'irr' => __( 'Iranian Rial (IRR)', 'ytism' ),
			'aed' => __( 'United Arab Emirates Dirham (AED)', 'ytism' ),
			'ngn' => __( 'Nigerian Naira (NGN)', 'ytism' ),
			'zar' => __( 'South African Rand (ZAR)', 'ytism' ),
			'eur' => __( 'Euro (EUR)', 'ytism' ),
			'gbp' => __( 'British Pound (GBP)', 'ytism' ),
			'inr' => __( 'Indian Rupee (INR)', 'ytism' ),
			'jpy' => __( 'Japanese Yen (JPY)', 'ytism' ),
			'cny' => __( 'Chinese Yuan (CNY)', 'ytism' ),
			'rub' => __( 'Russian Ruble (RUB)', 'ytism' ),
			'brl' => __( 'Brazilian Real (BRL)', 'ytism' ),
			'sek' => __( 'Swedish Krona (SEK)', 'ytism' ),
			'nok' => __( 'Norwegian Krone (NOK)', 'ytism' ),
			'dkk' => __( 'Danish Krone (DKK)', 'ytism' ),
			'pln' => __( 'Polish Złoty (PLN)', 'ytism' ),
			'czk' => __( 'Czech Koruna (CZK)', 'ytism' ),
			'huf' => __( 'Hungarian Forint (HUF)', 'ytism' ),
			'ron' => __( 'Romanian Leu (RON)', 'ytism' ),
			'uah' => __( 'Ukrainian Hryvnia (UAH)', 'ytism' ),
			'gel' => __( 'Georgian Lari (GEL)', 'ytism' ),
			'try' => __( 'Turkish Lira (TRY)', 'ytism' ),
			'thb' => __( 'Thai Baht (THB)', 'ytism' ),
			'myr' => __( 'Malaysian Ringgit (MYR)', 'ytism' ),
			'idr' => __( 'Indonesian Rupiah (IDR)', 'ytism' ),
			'vnd' => __( 'Vietnamese Dong (VND)', 'ytism' ),
			'krw' => __( 'South Korean Won (KRW)', 'ytism' ),
			'php' => __( 'Philippine Peso (PHP)', 'ytism' ),
			'bdt' => __( 'Bangladeshi Taka (BDT)', 'ytism' ),
			'lkr' => __( 'Sri Lankan Rupee (LKR)', 'ytism' ),
			'mmk' => __( 'Myanmar Kyat (MMK)', 'ytism' ),
			'khr' => __( 'Cambodian Riel (KHR)', 'ytism' ),
			'mnt' => __( 'Mongolian Tögrög (MNT)', 'ytism' ),
			'mzn' => __( 'Mozambican Metical (MZN)', 'ytism' ),
			'kes' => __( 'Kenyan Shilling (KES)', 'ytism' ),
			'tzs' => __( 'Tanzanian Shilling (TZS)', 'ytism' ),
			'ugx' => __( 'Ugandan Shilling (UGX)', 'ytism' ),
			'ghs' => __( 'Ghanaian Cedi (GHS)', 'ytism' ),
			'mwk' => __( 'Malawian Kwacha (MWK)', 'ytism' ),
			'zmw' => __( 'Zambian Kwacha (ZMW)', 'ytism' ),
			'ars' => __( 'Argentine Peso (ARS)', 'ytism' ),
			'clp' => __( 'Chilean Peso (CLP)', 'ytism' ),
			'cop' => __( 'Colombian Peso (COP)', 'ytism' ),
			'pen' => __( 'Peruvian Sol (PEN)', 'ytism' ),
			'dop' => __( 'Dominican Peso (DOP)', 'ytism' ),
			'gtq' => __( 'Guatemalan Quetzal (GTQ)', 'ytism' ),
			'pyg' => __( 'Paraguayan Guaraní (PYG)', 'ytism' ),
			'uyu' => __( 'Uruguayan Peso (UYU)', 'ytism' ),
			'bob' => __( 'Bolivian Boliviano (BOB)', 'ytism' ),
			'pab' => __( 'Panamanian Balboa (PAB)', 'ytism' ),
			'ttd' => __( 'Trinidad and Tobago Dollar (TTD)', 'ytism' ),
			'xaf' => __( 'Central African CFA Franc (XAF)', 'ytism' ),
			'xof' => __( 'West African CFA Franc (XOF)', 'ytism' ),
			'xpf' => __( 'CFP Franc (XPF)', 'ytism' ),
			'mga' => __( 'Malagasy Ariary (MGA)', 'ytism' ),
			'mad' => __( 'Moroccan Dirham (MAD)', 'ytism' ),
			'lbp' => __( 'Lebanese Pound (LBP)', 'ytism' ),
			'scr' => __( 'Seychellois Rupee (SCR)', 'ytism' ),
			'sbd' => __( 'Solomon Islands Dollar (SBD)', 'ytism' ),
			'vuv' => __( 'Vanuatu Vatu (VUV)', 'ytism' ),
			'wst' => __( 'Samoan Tala (WST)', 'ytism' ),
			'afn' => __( 'Afghan Afghani (AFN)', 'ytism' ),
			'all' => __( 'Albanian Lek (ALL)', 'ytism' ),
			'amd' => __( 'Armenian Dram (AMD)', 'ytism' ),
			'ang' => __( 'Netherlands Antillean Guilder (ANG)', 'ytism' ),
			'aoa' => __( 'Angolan Kwanza (AOA)', 'ytism' ),
			'awg' => __( 'Aruban Florin (AWG)', 'ytism' ),
			'azn' => __( 'Azerbaijani Manat (AZN)', 'ytism' ),
			'bam' => __( 'Bosnia and Herzegovina Convertible Mark (BAM)', 'ytism' ),
			'bbd' => __( 'Barbadian Dollar (BBD)', 'ytism' ),
			'bgn' => __( 'Bulgarian Lev (BGN)', 'ytism' ),
			'bif' => __( 'Burundian Franc (BIF)', 'ytism' ),
			'bmd' => __( 'Bermudian Dollar (BMD)', 'ytism' ),
			'bnd' => __( 'Brunei Dollar (BND)', 'ytism' ),
			'bsd' => __( 'Bahamian Dollar (BSD)', 'ytism' ),
			'btc' => __( 'Bitcoin (BTC)', 'ytism' ),
			'btn' => __( 'Bhutanese Ngultrum (BTN)', 'ytism' ),
			'bwp' => __( 'Botswana Pula (BWP)', 'ytism' ),
			'byr' => __( 'Belarusian Ruble (BYR)', 'ytism' ),
			'byn' => __( 'Belarusian Ruble (BYN)', 'ytism' ),
			'cdf' => __( 'Congolese Franc (CDF)', 'ytism' ),
			'chf' => __( 'Swiss Franc (CHF)', 'ytism' ),
			'crc' => __( 'Costa Rican Colón (CRC)', 'ytism' ),
			'cuc' => __( 'Cuban Convertible Peso (CUC)', 'ytism' ),
			'cup' => __( 'Cuban Peso (CUP)', 'ytism' ),
			'cve' => __( 'Cape Verdean Escudo (CVE)', 'ytism' ),
			'djf' => __( 'Djiboutian Franc (DJF)', 'ytism' ),
			'ern' => __( 'Eritrean Nakfa (ERN)', 'ytism' ),
			'etb' => __( 'Ethiopian Birr (ETB)', 'ytism' ),
			'fkp' => __( 'Falkland Islands Pound (FKP)', 'ytism' ),
			'ggp' => __( 'Guernsey Pound (GGP)', 'ytism' ),
			'gip' => __( 'Gibraltar Pound (GIP)', 'ytism' ),
			'gmd' => __( 'Gambian Dalasi (GMD)', 'ytism' ),
			'gnf' => __( 'Guinean Franc (GNF)', 'ytism' ),
			'gyd' => __( 'Guyanese Dollar (GYD)', 'ytism' ),
			'hnl' => __( 'Honduran Lempira (HNL)', 'ytism' ),
			'hrk' => __( 'Croatian Kuna (HRK)', 'ytism' ),
			'htg' => __( 'Haitian Gourde (HTG)', 'ytism' ),
			'ils' => __( 'Israeli New Shekel (ILS)', 'ytism' ),
			'imp' => __( 'Isle of Man Pound (IMP)', 'ytism' ),
			'iqd' => __( 'Iraqi Dinar (IQD)', 'ytism' ),
			'irt' => __( 'Iranian Toman (IRT)', 'ytism' ),
			'isk' => __( 'Icelandic Króna (ISK)', 'ytism' ),
			'jep' => __( 'Jersey Pound (JEP)', 'ytism' ),
			'jod' => __( 'Jordanian Dinar (JOD)', 'ytism' ),
			'kgs' => __( 'Kyrgyzstani Som (KGS)', 'ytism' ),
			'kmf' => __( 'Comorian Franc (KMF)', 'ytism' ),
			'kpw' => __( 'North Korean Won (KPW)', 'ytism' ),
			'kyd' => __( 'Cayman Islands Dollar (KYD)', 'ytism' ),
			'kzt' => __( 'Kazakhstani Tenge (KZT)', 'ytism' ),
			'lak' => __( 'Lao Kip (LAK)', 'ytism' ),
			'lrd' => __( 'Liberian Dollar (LRD)', 'ytism' ),
			'lsl' => __( 'Lesotho Loti (LSL)', 'ytism' ),
			'lyd' => __( 'Libyan Dinar (LYD)', 'ytism' ),
			'mdl' => __( 'Moldovan Leu (MDL)', 'ytism' ),
			'mkd' => __( 'Macedonian Denar (MKD)', 'ytism' ),
			'mop' => __( 'Macanese Pataca (MOP)', 'ytism' ),
			'mru' => __( 'Mauritanian Ouguiya (MRU)', 'ytism' ),
			'mur' => __( 'Mauritian Rupee (MUR)', 'ytism' ),
			'mvr' => __( 'Maldivian Rufiyaa (MVR)', 'ytism' ),
			'nad' => __( 'Namibian Dollar (NAD)', 'ytism' ),
			'nio' => __( 'Nicaraguan Córdoba (NIO)', 'ytism' ),
			'npr' => __( 'Nepalese Rupee (NPR)', 'ytism' ),
			'pgk' => __( 'Papua New Guinean Kina (PGK)', 'ytism' ),
			'pkr' => __( 'Pakistani Rupee (PKR)', 'ytism' ),
			'prb' => __( 'Transnistrian Ruble (PRB)', 'ytism' ),
			'rsd' => __( 'Serbian Dinar (RSD)', 'ytism' ),
			'rwf' => __( 'Rwandan Franc (RWF)', 'ytism' ),
			'sdg' => __( 'Sudanese Pound (SDG)', 'ytism' ),
			'shp' => __( 'Saint Helena Pound (SHP)', 'ytism' ),
			'sll' => __( 'Sierra Leonean Leone (SLL)', 'ytism' ),
			'sos' => __( 'Somali Shilling (SOS)', 'ytism' ),
			'srd' => __( 'Surinamese Dollar (SRD)', 'ytism' ),
			'ssp' => __( 'South Sudanese Pound (SSP)', 'ytism' ),
			'stn' => __( 'São Tomé and Príncipe Dobra (STN)', 'ytism' ),
			'syp' => __( 'Syrian Pound (SYP)', 'ytism' ),
			'szl' => __( 'Swazi Lilangeni (SZL)', 'ytism' ),
			'tjs' => __( 'Tajikistani Somoni (TJS)', 'ytism' ),
			'tmt' => __( 'Turkmenistan Manat (TMT)', 'ytism' ),
			'tnd' => __( 'Tunisian Dinar (TND)', 'ytism' ),
			'top' => __( "Tongan Pa'anga (TOP)", 'ytism' ),
			'uzs' => __( 'Uzbekistani Som (UZS)', 'ytism' ),
			'vef' => __( 'Venezuelan Bolívar Fuerte (VEF)', 'ytism' ),
			'ves' => __( 'Venezuelan Bolívar Soberano (VES)', 'ytism' ),
			'yer' => __( 'Yemeni Rial (YER)', 'ytism' ),
			'xcd' => __( 'East Caribbean Dollar (XCD)', 'ytism' ),
		];
		return $currency_countries[ $currency_code ] ?? ( ! empty( $currency_code ) ? strtoupper( $currency_code ) : '' );
	}

	/**
	 * Get currency code from country code
	 */
	public static function get_country_currency( string $country_code, string $default = 'USD' ): string {
		$country_code          = strtoupper( trim( $country_code ) );
		$country_currency_list = [
			'US' => 'usd',
			'CA' => 'cad',
			'GB' => 'gbp',
			'AU' => 'aud',
			'NZ' => 'nzd',
			'SG' => 'sgd',
			'HK' => 'hkd',
			'MX' => 'mxn',
			'TW' => 'twd',
			'FJ' => 'fjd',
			'BZ' => 'bzd',
			'JM' => 'jmd',
			'DZ' => 'dzd',
			'EG' => 'egp',
			'KW' => 'kwd',
			'BH' => 'bhd',
			'SA' => 'sar',
			'QA' => 'qar',
			'OM' => 'omr',
			'IR' => 'irr',
			'AE' => 'aed',
			'NG' => 'ngn',
			'ZA' => 'zar',
			'EU' => 'eur',
			'IN' => 'inr',
			'JP' => 'jpy',
			'CN' => 'cny',
			'RU' => 'rub',
			'BR' => 'brl',
			'SE' => 'sek',
			'NO' => 'nok',
			'DK' => 'dkk',
			'PL' => 'pln',
			'CZ' => 'czk',
			'HU' => 'huf',
			'RO' => 'ron',
			'UA' => 'uah',
			'GE' => 'gel',
			'TR' => 'try',
			'TH' => 'thb',
			'MY' => 'myr',
			'ID' => 'idr',
			'VN' => 'vnd',
			'KR' => 'krw',
			'PH' => 'php',
			'BD' => 'bdt',
			'LK' => 'lkr',
			'MM' => 'mmk',
			'KH' => 'khr',
			'MN' => 'mnt',
			'MZ' => 'mzn',
			'KE' => 'kes',
			'TZ' => 'tzs',
			'UG' => 'ugx',
			'GH' => 'ghs',
			'MW' => 'mwk',
			'ZM' => 'zmw',
			'AR' => 'ars',
			'CL' => 'clp',
			'CO' => 'cop',
			'PE' => 'pen',
			'DO' => 'dop',
			'GT' => 'gtq',
			'PY' => 'pyg',
			'UY' => 'uyu',
			'BO' => 'bob',
			'PA' => 'pab',
			'TT' => 'ttd',
			'CF' => 'xaf',
			'BJ' => 'xof',
			'PF' => 'xpf',
			'MG' => 'mga',
			'MA' => 'mad',
			'LB' => 'lbp',
			'SC' => 'scr',
			'SB' => 'sbd',
			'VU' => 'vuv',
			'WS' => 'wst',
			'AF' => 'afn',
			'AL' => 'all',
			'AM' => 'amd',
			'AO' => 'aoa',
			'AZ' => 'azn',
			'BA' => 'bam',
			'BB' => 'bbd',
			'BG' => 'bgn',
			'BI' => 'bif',
			'BM' => 'bmd',
			'BN' => 'bnd',
			'BS' => 'bsd',
			'BT' => 'btn',
			'BW' => 'bwp',
			'BY' => 'byn',
			'CD' => 'cdf',
			'CH' => 'chf',
			'CR' => 'crc',
			'CU' => 'cup',
			'CV' => 'cve',
			'DJ' => 'djf',
			'ER' => 'ern',
			'ET' => 'etb',
			'FK' => 'fkp',
			'GM' => 'gmd',
			'GN' => 'gnf',
			'GY' => 'gyd',
			'HN' => 'hnl',
			'HR' => 'hrk',
			'HT' => 'htg',
			'IL' => 'ils',
			'IQ' => 'iqd',
			'IR' => 'irt',
			'IS' => 'isk',
			'JO' => 'jod',
			'KG' => 'kgs',
			'KM' => 'kmf',
			'KP' => 'kpw',
			'KY' => 'kyd',
			'KZ' => 'kzt',
			'LA' => 'lak',
			'LR' => 'lrd',
			'LS' => 'lsl',
			'LY' => 'lyd',
			'MD' => 'mdl',
			'MK' => 'mkd',
			'MO' => 'mop',
			'MR' => 'mru',
			'MU' => 'mur',
			'MV' => 'mvr',
			'NA' => 'nad',
			'NI' => 'nio',
			'NP' => 'npr',
			'PG' => 'pgk',
			'PK' => 'pkr',
			'RS' => 'rsd',
			'RW' => 'rwf',
			'SD' => 'sdg',
			'SH' => 'shp',
			'SL' => 'sll',
			'SO' => 'sos',
			'SR' => 'srd',
			'SS' => 'ssp',
			'ST' => 'stn',
			'SY' => 'syp',
			'SZ' => 'szl',
			'TJ' => 'tjs',
			'TM' => 'tmt',
			'TN' => 'tnd',
			'TO' => 'top',
			'UZ' => 'uzs',
			'VE' => 'ves',
			'YE' => 'yer',
			'XC' => 'xcd',
		];

		return $country_currency_list[ $country_code ] ?? ( ! empty( $country_code ) ? strtoupper( $country_code ) : $default );
	}

	/**
	 * Get country code from WordPress timezone setting
	 */
	public static function get_country_code_from_timezone( string $timezone = null ): ?string {
		if ( ! $timezone ) {
			$timezone = get_option( 'timezone_string' ) ?: 'UTC';
		}

		$tz_countries = [];
		foreach ( DateTimeZone::listIdentifiers() as $tz ) {
			$location = timezone_open( $tz )->getLocation();
			if ( ! empty( $location['country_code'] ) ) {
				$tz_countries[ $tz ] = $location['country_code'];
			}
		}

		return $tz_countries[ $timezone ] ?? null;
	}

	/**
	 * Get the user's real IP address
	 */
	public static function get_user_ip(): string {
		$keys = [
			'HTTP_CLIENT_IP',
			'HTTP_X_FORWARDED_FOR',
			'HTTP_X_FORWARDED',
			'HTTP_X_CLUSTER_CLIENT_IP',
			'HTTP_FORWARDED_FOR',
			'HTTP_FORWARDED',
			'REMOTE_ADDR',
		];

		foreach ( $keys as $key ) {
			if ( ! empty( $_SERVER[ $key ] ) ) {
				foreach ( explode( ',', $_SERVER[ $key ] ) as $ip ) {
					$ip = trim( $ip );
					if ( filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
						return $ip;
					}
				}
			}
		}

		return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
	}

	/**
	 * Get user agent string
	 */
	public static function get_user_agent( int $length = 200 ): string {
		return substr( $_SERVER['HTTP_USER_AGENT'] ?? '', 0, $length );
	}

	/**
	 * Get user location data based on IP address
	 */
	public static function get_user_location(): array {
		$current_ip = self::get_user_ip();

		$cache = ! empty( $_COOKIE['ytism_geo'] ) ? json_decode( stripslashes( $_COOKIE['ytism_geo'] ), true ) : [];
		if ( isset( $cache['ip'] ) && $cache['ip'] === $current_ip && ! empty( $cache['data'] ) ) {
			return $cache['data'];
		}

		$transient_key = 'ytism_geo_' . md5( $current_ip );
		$data          = get_transient( $transient_key );
		if ( $data ) {
			self::schedule_cookie_set( $current_ip, $data );
			return $data;
		}

		$response = wp_remote_get( "https://ipinfo.io/{$current_ip}/json" );
		if ( is_wp_error( $response ) ) {
			return [
				'ip'       => $current_ip,
				'error'    => $response->get_error_message(),
				'country'  => null,
				'region'   => null,
				'city'     => null,
				'loc'      => null,
				'org'      => null,
				'postal'   => null,
				'timezone' => null,
			];
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( ! empty( $data['country'] ) ) {
			set_transient( $transient_key, $data, DAY_IN_SECONDS );
			self::schedule_cookie_set( $current_ip, $data );
		}

		return $data;
	}

	/**
	 * Schedule cookie setting safely.
	 */
	private static function schedule_cookie_set( string $ip, array $data ): void {
		add_action(
			'send_headers',
			function () use ( $ip, $data ) {
				setcookie(
					'ytism_geo',
					wp_json_encode(
						[
							'ip'   => $ip,
							'data' => $data,
						]
					),
					time() + DAY_IN_SECONDS,
					COOKIEPATH ?: '/',
					COOKIE_DOMAIN ?: ''
				);
			}
		);
	}

	/**
	 * Format stripe amount from cents to decimal
	 */
	public static function format_stripe_amount( int|float $amount_in_cents, string $currency_code ) {
		$currency_code   = strtolower( $currency_code );
		$amount_in_cents = (float) $amount_in_cents;

		$no_decimal_currencies = [ 'jpy', 'krw' ];
		$divisor               = in_array( $currency_code, $no_decimal_currencies, true ) ? 1 : 100;

		return $amount_in_cents / $divisor;
	}

	/**
	 * Format stripe amount with currency symbol
	 */
	public static function format_stripe_price( int|float $amount_in_cents, string $currency_code, bool $show_currency = false ): string {
		$currency_code = strtolower( $currency_code );

		$no_decimal_currencies = [ 'jpy', 'krw' ];
		$divisor               = in_array( $currency_code, $no_decimal_currencies, true ) ? 1 : 100;

		$decimals = in_array( $currency_code, $no_decimal_currencies, true ) ? 0 : 2;

		$amount_decimal = number_format( self::format_stripe_amount( $amount_in_cents, $currency_code ), $decimals );

		$currency_symbol = self::get_currency_symbol( $currency_code );

		if ( ! $show_currency ) {
			return trim( $currency_symbol . $amount_decimal );
		}
		return trim( $currency_symbol . $amount_decimal . ' (' . strtoupper( $currency_code ) . ')' );
	}

	/**
	 * Get price with currency symbol
	 */
	public static function format_price( float|int|string $amount, string $currency_code, bool $show_currency = false ): string {
		$currency_code = strtolower( $currency_code );

		$no_decimal_currencies = [ 'jpy', 'krw' ];
		$decimals              = in_array( $currency_code, $no_decimal_currencies, true ) ? 0 : 2;

		$amount_decimal = number_format( (float) $amount, $decimals );

		$currency_symbol = self::get_currency_symbol( $currency_code );

		if ( ! $show_currency ) {
			return trim( $currency_symbol . $amount_decimal );
		}
		return trim( $currency_symbol . $amount_decimal . ' (' . strtoupper( $currency_code ) . ')' );
	}

	/**
	 * Save Log
	 */
	public static function log_debug( $message ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			if ( is_array( $message ) || is_object( $message ) ) {
				$message = print_r( $message, true );
			}
			error_log( '[YTISM] ' . $message );
		}
	}

	/**
	 * Get user's active subscription (validates both status AND date)
	 *
	 * @param int $user_id User ID
	 * @return object|null Subscription object or null if no valid active subscription
	 */
	public static function get_user_active_subscription( $user_id ) {
		if ( empty( $user_id ) || ! is_numeric( $user_id ) ) {
			return null;
		}

		$subscriptions_db = \YTISM\Database\Factory::subscription();
		return $subscriptions_db->get_user_active_subscription( $user_id );
	}

	/**
	 * Check if user has active subscription (validates both status AND date)
	 *
	 * @param int $user_id User ID
	 * @return bool True if user has valid active subscription
	 */
	public static function user_has_active_subscription( $user_id ) {
		if ( empty( $user_id ) || ! is_numeric( $user_id ) ) {
			return false;
		}

		$subscriptions_db = \YTISM\Database\Factory::subscription();
		return $subscriptions_db->user_has_active_subscription( $user_id );
	}

	/**
	 * Get subscriptions with status/date mismatch
	 *
	 * @param int $user_id User ID (optional)
	 * @return array Array of subscriptions marked active but expired
	 */
	public static function get_expired_active_subscriptions( $user_id = null ) {
		$subscriptions_db = \YTISM\Database\Factory::subscription();
		return $subscriptions_db->get_status_mismatched( $user_id );
	}

	/**
	 * Fix expired subscriptions that still show as active
	 *
	 * @param int $user_id User ID (optional, null for all users)
	 * @return int Number of subscriptions fixed
	 */
	public static function fix_expired_subscriptions( $user_id = null ) {
		$subscriptions_db = \YTISM\Database\Factory::subscription();
		return $subscriptions_db->fix_expired_status( $user_id );
	}

	/**
	 * Check if argument is valid JSON
	 *
	 * @param mixed $argument The argument to check
	 * @param bool  $ignore_scalars If true, only objects and arrays are considered valid JSON
	 * @return bool True if argument is valid JSON, false otherwise
	 */
	public static function is_json( $argument, $ignore_scalars = true ) {
		if ( ! is_string( $argument ) || '' === $argument ) {
			return false;
		}

		if ( $ignore_scalars && ! in_array( $argument[0], [ '{', '[' ], true ) ) {
			return false;
		}

		json_decode( $argument, $assoc = true );

		return json_last_error() === JSON_ERROR_NONE;
	}

	/**
	 * Encrypt password for storing (for API later)
	 */
	public static function encrypt_str( $plaintext ) {
		if ( $plaintext === '' || $plaintext === null ) {
			return '';
		}

		$key = hash( 'sha256', SECURE_AUTH_KEY, true );
		$iv  = openssl_random_pseudo_bytes( 16 );

		$ciphertext = openssl_encrypt(
			$plaintext,
			'aes-256-cbc',
			$key,
			OPENSSL_RAW_DATA,
			$iv
		);

		$raw = $iv . $ciphertext;
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}

	/**
	 * Decrypt password
	 */
	public static function decrypt_str( $encrypted ) {
		if ( empty( $encrypted ) ) {
			return '';
		}

		$key = hash( 'sha256', SECURE_AUTH_KEY, true );

		$b64  = strtr( $encrypted, '-_', '+/' );
		$data = base64_decode( $b64, true );

		if ( $data === false || strlen( $data ) < 16 ) {
			return '';
		}

		$iv         = substr( $data, 0, 16 );
		$ciphertext = substr( $data, 16 );

		$decrypted = openssl_decrypt(
			$ciphertext,
			'aes-256-cbc',
			$key,
			OPENSSL_RAW_DATA,
			$iv
		);

		return $decrypted === false ? '' : $decrypted;
	}

	/**
	 * Validate name string
	 *
	 * @param string $name Name string to validate
	 * @return bool True if valid, false otherwise
	 */
	public static function is_valid_name( string $name ): bool {
		$name = trim( $name );

		if ( empty( $name ) ) {
			return false;
		}

		if ( strlen( $name ) < 2 || strlen( $name ) > 50 ) {
			return false;
		}

		if ( ! preg_match( "/^[\p{L}\p{M}' -]+$/u", $name ) ) {
			return false;
		}

		$blocked = [ 'test', 'demo', 'asdf', 'qwerty', 'name', 'username', 'firstname', 'lastname', 'first', 'last', 'admin', 'administrator', 'user', 'null', 'void', 'unknown', 'anonymous', 'sample', 'example', 'invalid', 'fake', 'nobody', 'none', 'na', 'n/a', 'guest', 'root', 'sysadmin', 'system', 'operator', 'owner', 'master', 'superuser', 'super', 'god', 'lord', 'king', 'queen', 'prince', 'princess', 'mr', 'mrs', 'ms', 'miss', 'dr', 'professor', 'sir', 'madam', 'madame', 'saint', 'saintess', 'father', 'mother', 'brother', 'sister', 'uncle', 'aunt', 'cousin', 'nephew', 'niece', 'grandfather', 'grandmother', 'grandpa', 'grandma', 'baby', 'child', 'kid', 'teen', 'teenager', 'youth', 'adult', 'senior', 'elder', 'oldie', 'veteran', 'champion', 'hero', 'legend', 'icon', 'star', 'celebrity', 'famous', 'notable', 'prominent', 'renowned', 'distinguished', 'eminent', 'illustrious', 'acclaimed', 'esteemed', 'respected', 'honored', 'admired', 'revered', 'worshipped', 'venerated', 'exalted', 'glorified', 'magnified', 'hallowed', 'sacred', 'divine', 'holy', 'blessed', 'anointed', 'chosen', 'favored', 'privileged', 'fortunate', 'lucky', 'prosperous', 'wealthy', 'rich', 'affluent', 'opulent', 'well-off', 'comfortable', 'secure', 'stable', 'steady', 'solid', 'strong', 'powerful', 'influential', 'dominant', 'supreme', 'ultimate', 'paramount', 'preeminent', 'foremost', 'leading', 'top', 'best', 'greatest', 'finest', 'superior', 'excellent', 'outstanding', 'exceptional', 'remarkable', 'noteworthy' ];
		if ( in_array( strtolower( $name ), $blocked, true ) ) {
			return false;
		}

		if ( preg_match( '/(.)\1{3,}/u', $name ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Compare new array against old array deeply.
	 * Returns only keys from new array that are new or changed.
	 *
	 * @param array $oldArray
	 * @param array $newArray
	 * @return array
	 */
	public static function array_changes_only_recursive( array $oldArray, array $newArray ): array {
		$diff = [];

		foreach ( $newArray as $key => $newValue ) {
			if ( is_array( $newValue ) ) {
				$oldValue = $oldArray[ $key ] ?? [];
				if ( ! is_array( $oldValue ) ) {
					$diff[ $key ] = $newValue;
				} else {
					$nestedDiff = self::array_changes_only_recursive( $oldValue, $newValue );
					if ( ! empty( $nestedDiff ) ) {
						$diff[ $key ] = $nestedDiff;
					}
				}
			} else {
				$oldValue = $oldArray[ $key ] ?? null;

				if ( ! array_key_exists( $key, $oldArray ) || ! self::values_are_equal( $oldValue, $newValue ) ) {
					$diff[ $key ] = $newValue;
				}
			}
		}

		return $diff;
	}

	/**
	 * Normalize and compare values for equality.
	 *
	 * - Numeric strings and numbers are treated as equal
	 * - "10.50" == 10.5 == "10.5"
	 * - Arrays compared recursively
	 *
	 * @param mixed $a
	 * @param mixed $b
	 * @return bool
	 */
	public static function values_are_equal( $a, $b ): bool {
		if ( is_array( $a ) && is_array( $b ) ) {
			if ( count( $a ) !== count( $b ) ) {
				return false;
			}

			foreach ( $a as $key => $valA ) {
				if ( ! array_key_exists( $key, $b ) || ! self::values_are_equal( $valA, $b[ $key ] ) ) {
					return false;
				}
			}

			return true;
		}

		if ( is_array( $a ) || is_array( $b ) ) {
			return false;
		}

		if ( is_numeric( $a ) && is_numeric( $b ) ) {
			return (float) $a == (float) $b;
		}

		return (string) $a === (string) $b;
	}

	/**
	 * Format Stripe Payment Method details into readable array
	 */
	public static function format_payment_method_details( $paymentMethod ) {
		$details = [
			'id'      => $paymentMethod->id,
			'type'    => $paymentMethod->type,
			'created' => date( 'Y-m-d H:i:s', $paymentMethod->created ),
		];

		switch ( $paymentMethod->type ) {
			case 'card':
				$card                      = $paymentMethod->card;
				$details['method_details'] = [
					'brand'       => ucfirst( $card->brand ),
					'last4'       => $card->last4,
					'exp_month'   => $card->exp_month,
					'exp_year'    => $card->exp_year,
					'funding'     => ucfirst( $card->funding ),
					'country'     => $card->country,
					'fingerprint' => $card->fingerprint,
					'network'     => $card->network ?? 'N/A',
					'wallet'      => $card->wallet ? $card->wallet->type : null,
				];
				break;

			case 'us_bank_account':
				$bankAccount               = $paymentMethod->us_bank_account;
				$details['method_details'] = [
					'bank_name'      => $bankAccount->bank_name,
					'last4'          => $bankAccount->last4,
					'account_type'   => ucfirst( $bankAccount->account_type ),
					'routing_number' => $bankAccount->routing_number,
					'fingerprint'    => $bankAccount->fingerprint,
				];
				break;

			case 'sepa_debit':
				$sepa                      = $paymentMethod->sepa_debit;
				$details['method_details'] = [
					'bank_code'   => $sepa->bank_code,
					'branch_code' => $sepa->branch_code,
					'country'     => $sepa->country,
					'last4'       => $sepa->last4,
					'fingerprint' => $sepa->fingerprint,
				];
				break;

			case 'paypal':
				$paypal                    = $paymentMethod->paypal;
				$details['method_details'] = [
					'payer_email' => $paypal->payer_email ?? 'N/A',
					'payer_id'    => $paypal->payer_id ?? 'N/A',
				];
				break;

			case 'klarna':
				$klarna                    = $paymentMethod->klarna;
				$details['method_details'] = [
					'dob' => $klarna->dob ?? 'N/A',
				];
				break;

			case 'afterpay_clearpay':
				$details['method_details'] = [
					'type' => 'Afterpay / Clearpay',
				];
				break;

			case 'alipay':
				$details['method_details'] = [
					'type' => 'Alipay',
				];
				break;

			case 'wechat_pay':
				$details['method_details'] = [
					'type' => 'WeChat Pay',
				];
				break;

			case 'ideal':
				$ideal                     = $paymentMethod->ideal;
				$details['method_details'] = [
					'bank' => $ideal->bank ?? 'N/A',
					'bic'  => $ideal->bic ?? 'N/A',
				];
				break;

			case 'giropay':
				$details['method_details'] = [
					'type' => 'Giropay',
				];
				break;

			case 'bancontact':
				$details['method_details'] = [
					'type' => 'Bancontact',
				];
				break;

			case 'eps':
				$eps                       = $paymentMethod->eps;
				$details['method_details'] = [
					'bank' => $eps->bank ?? 'N/A',
				];
				break;

			case 'p24':
				$p24                       = $paymentMethod->p24;
				$details['method_details'] = [
					'bank' => $p24->bank ?? 'N/A',
				];
				break;

			case 'sofort':
				$sofort                    = $paymentMethod->sofort;
				$details['method_details'] = [
					'country' => $sofort->country ?? 'N/A',
				];
				break;

			case 'acss_debit':
				$acss                      = $paymentMethod->acss_debit;
				$details['method_details'] = [
					'bank_name'          => $acss->bank_name,
					'last4'              => $acss->last4,
					'institution_number' => $acss->institution_number,
					'transit_number'     => $acss->transit_number,
					'fingerprint'        => $acss->fingerprint,
				];
				break;

			case 'bacs_debit':
				$bacs                      = $paymentMethod->bacs_debit;
				$details['method_details'] = [
					'sort_code'   => $bacs->sort_code,
					'last4'       => $bacs->last4,
					'fingerprint' => $bacs->fingerprint,
				];
				break;

			case 'au_becs_debit':
				$becs                      = $paymentMethod->au_becs_debit;
				$details['method_details'] = [
					'bsb_number'  => $becs->bsb_number,
					'last4'       => $becs->last4,
					'fingerprint' => $becs->fingerprint,
				];
				break;

			case 'cashapp':
				$cashapp                   = $paymentMethod->cashapp;
				$details['method_details'] = [
					'cashtag' => $cashapp->cashtag ?? 'N/A',
				];
				break;

			case 'link':
				$link                      = $paymentMethod->link;
				$details['method_details'] = [
					'email' => $link->email ?? 'N/A',
				];
				break;

			default:
				$details['method_details'] = [
					'type' => ucfirst( str_replace( '_', ' ', $paymentMethod->type ) ),
				];
				break;
		}

		return $details;
	}

	/**
	 * Get human-readable label for payment type
	 */
	public static function get_payment_type_label( string $type ) {
		$labels = [
			'card'              => 'Credit/Debit Card',
			'us_bank_account'   => 'US Bank Account',
			'sepa_debit'        => 'SEPA Direct Debit',
			'paypal'            => 'PayPal',
			'klarna'            => 'Klarna',
			'afterpay_clearpay' => 'Afterpay / Clearpay',
			'alipay'            => 'Alipay',
			'wechat_pay'        => 'WeChat Pay',
			'ideal'             => 'iDEAL',
			'giropay'           => 'Giropay',
			'bancontact'        => 'Bancontact',
			'eps'               => 'EPS',
			'p24'               => 'Przelewy24',
			'sofort'            => 'Sofort',
			'acss_debit'        => 'Canadian Bank Account',
			'bacs_debit'        => 'UK Bank Account',
			'au_becs_debit'     => 'Australian Bank Account',
			'cashapp'           => 'Cash App',
			'link'              => 'Link',
			'amazon_pay'        => 'Amazon Pay',
		];

		return $labels[ $type ] ?? ucfirst( str_replace( '_', ' ', $type ) );
	}

	/**
	 * Merge two arrays recursively, overwriting values from the first array with values from the second array when keys are the same.
	 */
	public static function array_merge_recursive_distinct( array &$array1, array &$array2 ): array {
		$merged = $array1;

		foreach ( $array2 as $key => &$value ) {
			if ( is_array( $value ) && isset( $merged[ $key ] ) && is_array( $merged[ $key ] ) ) {
				$merged[ $key ] = self::array_merge_recursive_distinct( $merged[ $key ], $value );
			} else {
				$merged[ $key ] = $value;
			}
		}

		return $merged;
	}

	/**
	 * Get individual purchase page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function individual_purchase_page_url( string $path = '', array $query_args = [] ) {
		$individual_purchase_page_id = isset( self::$settings['individual']['page_id'] ) ? self::$settings['individual']['page_id'] : null;
		if ( ! $individual_purchase_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		// WPML translation
		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $individual_purchase_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$individual_purchase_page_id = $translated_id;
			}
		}

		$page = get_post( $individual_purchase_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		clean_post_cache( $individual_purchase_page_id );

		$url = rtrim( get_permalink( $individual_purchase_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Family purchase page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function family_purchase_page_url( string $path = '', array $query_args = [] ) {
		$family_purchase_page_id = isset( self::$settings['family']['page_id'] ) ? self::$settings['family']['page_id'] : null;
		if ( ! $family_purchase_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $family_purchase_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$family_purchase_page_id = $translated_id;
			}
		}

		$page = get_post( $family_purchase_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $family_purchase_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Enterprise purchase page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function enterprise_purchase_page_url( string $path = '', array $query_args = [] ) {
		$enterprise_purchase_page_id = isset( self::$settings['enterprise']['page_id'] ) ? self::$settings['enterprise']['page_id'] : null;
		if ( ! $enterprise_purchase_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $enterprise_purchase_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$enterprise_purchase_page_id = $translated_id;
			}
		}

		$page = get_post( $enterprise_purchase_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $enterprise_purchase_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get My Account page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function get_myaccount_page_url( string $path = '', array $query_args = [] ) {
		$myaccount_page_id = isset( self::$settings['myaccount_page_id'] ) ? self::$settings['myaccount_page_id'] : null;
		if ( ! $myaccount_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $myaccount_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$myaccount_page_id = $translated_id;
			}
		}

		$page = get_post( $myaccount_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $myaccount_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Checkout page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function get_checkout_page_url( string $path = '', array $query_args = [] ) {
		$checkout_page_id = isset( self::$settings['checkout_page_id'] ) ? self::$settings['checkout_page_id'] : null;
		if ( ! $checkout_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $checkout_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$checkout_page_id = $translated_id;
			}
		}

		$page = get_post( $checkout_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $checkout_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Thank You page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function get_thankyou_page_url( string $path = '', array $query_args = [] ) {
		$thankyou_page_id = isset( self::$settings['thankyou_page_id'] ) ? self::$settings['thankyou_page_id'] : null;
		if ( ! $thankyou_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $thankyou_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$thankyou_page_id = $translated_id;
			}
		}

		$page = get_post( $thankyou_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $thankyou_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Order Summary page URL (WPML translated if available)
	 *
	 * @return string
	 */
	public static function get_ordersummary_page_url( string $path = '', array $query_args = [] ) {
		$ordersummary_page_id = isset( self::$settings['ordersummary_page_id'] ) ? self::$settings['ordersummary_page_id'] : null;
		if ( ! $ordersummary_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $ordersummary_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$ordersummary_page_id = $translated_id;
			}
		}

		$page = get_post( $ordersummary_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $ordersummary_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Terms and Condition page url
	 *
	 * @param string $path       Optional. Additional path to append to the URL. Default empty.
	 * @param array  $query_args Optional. Query arguments to append to the URL.
	 * @return string
	 */
	public static function get_terms_page_url( string $path = '', array $query_args = [] ): string {
		$terms_page_id = isset( self::$settings['terms_page_id'] ) ? self::$settings['terms_page_id'] : null;
		if ( ! $terms_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $terms_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$terms_page_id = $translated_id;
			}
		}

		$page = get_post( $terms_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $terms_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Privacy Policy page url
	 *
	 * @param string $path       Optional. Additional path to append to the URL. Default empty.
	 * @param array  $query_args Optional. Query arguments to append to the URL.
	 * @return string
	 */
	public static function get_privacy_page_url( string $path = '', array $query_args = [] ): string {
		$privacy_page_id = isset( self::$settings['privacy_page_id'] ) ? self::$settings['privacy_page_id'] : null;
		if ( ! $privacy_page_id ) {
			return '';
		}

		$current_lang = defined( 'ICL_LANGUAGE_CODE' ) ? ICL_LANGUAGE_CODE : null;

		if ( function_exists( 'wpml_object_id_filter' ) && $current_lang ) {
			$translated_id = apply_filters( 'wpml_object_id', $privacy_page_id, 'page', true, $current_lang );
			if ( $translated_id ) {
				$privacy_page_id = $translated_id;
			}
		}

		$page = get_post( $privacy_page_id );
		if ( ! $page || 'page' !== $page->post_type || 'publish' !== $page->post_status ) {
			return '';
		}

		$url = rtrim( get_permalink( $privacy_page_id ), '/' );
		if ( $path ) {
			$url .= '/' . ltrim( $path, '/' );
		} else {
			$url .= '/';
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get Alias Auth page url
	 *
	 * @return string
	 */
	public static function get_auth_page_url( string $path = '', array $query_args = [] ) {
		$url = site_url( '/ytism-alias-auth/' );
		if ( $path ) {
			$url = rtrim( $url, '/' ) . '/' . ltrim( $path, '/' );
		}

		if ( ! empty( $query_args ) ) {
			$url = add_query_arg( $query_args, $url );
		}

		return $url;
	}

	/**
	 * Get My Account tabs list
	 *
	 * @param int|null $wp_user_id WordPress User ID (null for current user).
	 * @return array Associative array of tab slugs and labels.
	 */
	public static function get_myaccount_tabs( ?int $wp_user_id = null ): array {
		if ( null !== $wp_user_id ) {
			if ( intval( $wp_user_id ) <= 0 ) {
				return [];
			}
		}
		$user_id    = $wp_user_id > 0 ? $wp_user_id : get_current_user_id();
		$alias_user = new AliasUser( $user_id );
		$lists      = [];

		if ( $alias_user && $alias_user instanceof AliasUser && $alias_user->exists() ) {
			$current_vars = get_query_var( 'ytism_myaccount_pages' );

			if ( $alias_user->is_enterprise_user() ) {
				$lists = [
					'dashboard'    => [
						'url'       => self::get_myaccount_page_url(),
						'label'     => __( 'Dashboard', 'ytism' ),
						'is_active' => 'dashboard' === $current_vars,
					],
					'transactions' => [
						'url'       => self::get_myaccount_page_url( 'transactions' ),
						'label'     => __( 'Transactions', 'ytism' ),
						'is_active' => 'transactions' === $current_vars,
					],
					'profile'      => [
						'url'       => self::get_myaccount_page_url( 'profile' ),
						'label'     => __( 'Profile', 'ytism' ),
						'is_active' => 'profile' === $current_vars,
					],
					'supermanager' => [
						'url'       => self::get_myaccount_page_url( 'super-manager' ),
						'label'     => __( 'Super Manager', 'ytism' ),
						'is_active' => 'super_manager' === $current_vars,
					],
				];
			} else {
				$lists = [
					'dashboard'    => [
						'url'       => self::get_myaccount_page_url(),
						'label'     => __( 'Dashboard', 'ytism' ),
						'is_active' => 'dashboard' === $current_vars,
					],
					'transactions' => [
						'url'       => self::get_myaccount_page_url( 'transactions' ),
						'label'     => __( 'Transactions', 'ytism' ),
						'is_active' => 'transactions' === $current_vars,
					],
					'profile'      => [
						'url'       => self::get_myaccount_page_url( 'profile' ),
						'label'     => __( 'Profile', 'ytism' ),
						'is_active' => 'profile' === $current_vars,
					],
				];
			}

			// Add filters to overwrite.
			$lists = apply_filters( 'ytism_myaccount_tabs', $lists, $alias_user );
		}

		return $lists;
	}
}
new Functions();
