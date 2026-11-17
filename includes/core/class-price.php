<?php
namespace YTISM\Core;

use YTISM\Helpers\Functions;
use WP_Error;

class Price {
	/**
	 * @var object|WP_Error  Valid Stripe product object or WP_Error if invalid/fetch failed.
	 */
	private $price_object;

	/**
	 * @param object $price_object Stripe Price object
	 */
	public function __construct( object $price_object ) {
		$required_props = [ 'id', 'currency', 'active', 'billing_scheme' ];
		foreach ( $required_props as $prop ) {
			if ( ! property_exists( $price_object, $prop ) || $price_object->$prop === null || $price_object->$prop === '' || $price_object->$prop === false ) {
				$this->price_object = new WP_Error(
					'invalid_price_object_property',
					sprintf(
						__( 'Price object is missing or has empty "%s" property.', 'ytism' ),
						$prop
					)
				);
				return;
			}
		}

		$this->price_object = $price_object;
	}

	/**
	 * Accessor with safety check.
	 *
	 * @return object|WP_Error
	 */
	public function get_object() {
		return $this->price_object;
	}

	/**
	 * Quick helper to check if constructor ended in WP_Error
	 */
	public function has_error(): bool {
		return is_wp_error( $this->price_object );
	}

	/**
	 * Convenience method: Get error message if any.
	 *
	 * @return string|null
	 */
	public function get_error_message(): ?string {
		return $this->has_error()
			? $this->price_object->get_error_message()
			: null;
	}

	/**
	 * Get Price ID
	 *
	 * @return string
	 */
	public function get_id(): string {
		return $this->has_error() ? null : ( $this->price_object->id ?? null );
	}

	/**
	 * Get Price Name or nickname if set, or a fallback name
	 *
	 * @return string|null
	 */
	public function get_name(): ?string {
		if ( $this->has_error() ) {
			return null;
		}

		if ( property_exists( $this->price_object, 'nickname' ) && ! empty( $this->price_object->nickname ) ) {
			// Define a mapping of common nicknames to their translated equivalents.
			$nickname_map = [
				'basic'      => __( 'Basic', 'ytism' ),
				'standard'   => __( 'Standard', 'ytism' ),
				'premium'    => __( 'Premium', 'ytism' ),
				'pro'        => __( 'Pro', 'ytism' ),
				'enterprise' => __( 'Enterprise', 'ytism' ),
				'annually'   => __( 'Annually', 'ytism' ),
				'annual'     => __( 'Annual', 'ytism' ),
				'yearly'     => __( 'Yearly', 'ytism' ),
				'monthly'    => __( 'Monthly', 'ytism' ),
				'weekly'     => __( 'Weekly', 'ytism' ),
				'daily'      => __( 'Daily', 'ytism' ),
			];

			// Normalize the nickname to lowercase for case-insensitive matching.
			$normalized_nickname = strtolower( $this->price_object->nickname );

			// Return the mapped translation if it exists, otherwise return the original nickname.
			return $nickname_map[ $normalized_nickname ] ?? $this->price_object->nickname;
		}

		return 'Price ' . substr( $this->price_object->id, -4 );
	}

	/**
	 * Get Price interval (if recurring)
	 *
	 * @return string|null
	 */
	public function get_recurring_interval(): ?string {
		if ( $this->has_error() ) {
			return null;
		}

		if ( property_exists( $this->price_object, 'recurring' ) && is_object( $this->price_object->recurring ) && property_exists( $this->price_object->recurring, 'interval' ) ) {
			return $this->price_object->recurring->interval;
		}

		return null;
	}

	/**
	 * Get all available currencies for this price
	 *
	 * @return array
	 */
	public function get_available_currencies(): array {
		$currencies = [];
		if ( $this->price_object->active ) {
			$currencies[] = $this->price_object->currency;

			if ( property_exists( $this->price_object, 'currency_options' ) && is_object( $this->price_object->currency_options ) ) {
				$currencies = array_merge(
					$currencies,
					array_keys( get_object_vars( $this->price_object->currency_options ) )
				);
			}
		}
		return array_unique( $currencies );
	}

	/**
	 * Get price data for a specific currency
	 *
	 * @param string $currency
	 * @return object|null
	 */
	public function get_price_data_for_currency( string $currency ): ?object {
		if ( property_exists( $this->price_object, 'currency_options' ) && is_object( $this->price_object->currency_options ) && property_exists( $this->price_object->currency_options, $currency ) ) {
			return (object) $this->price_object->currency_options->$currency;
		}

		if ( $this->price_object->currency === $currency ) {
			$object = new \stdClass();
			if ( property_exists( $this->price_object, 'tax_behavior' ) ) {
				$object->tax_behavior = $this->price_object->tax_behavior;
			}
			if ( property_exists( $this->price_object, 'unit_amount' ) ) {
				$object->unit_amount = $this->price_object->unit_amount;
			}
			if ( property_exists( $this->price_object, 'unit_amount_decimal' ) ) {
				$object->unit_amount_decimal = $this->price_object->unit_amount_decimal;
			}
			if ( property_exists( $this->price_object, 'custom_unit_amount' ) ) {
				$object->custom_unit_amount = $this->price_object->custom_unit_amount;
			}
			if ( property_exists( $this->price_object, 'tiers' ) ) {
				$object->tiers = $this->price_object->tiers;
			}
			if ( property_exists( $this->price_object, 'recurring' ) ) {
				$object->recurring = $this->price_object->recurring;
			}
			return $object;
		}
		return null;
	}

	/**
	 * Get human-readable price description for a specific currency
	 *
	 * @param string $currency
	 * @return string|null
	 */
	public function get_description_for_currency( string $currency ): ?string {
		if ( $this->has_error() ) {
			return null;
		}

		$currency_price_data = $this->get_price_data_for_currency( $currency );
		if ( ! $currency_price_data ) {
			return null;
		}

		$price_display_text = '';
		$recurring_interval = $this->price_object->recurring->interval ?? null;

		if ( $this->price_object->billing_scheme === 'per_unit' ) {

			$unit_amount = $currency_price_data->unit_amount_decimal ?? $currency_price_data->unit_amount;
			if ( is_numeric( $unit_amount ) ) {
				$price_display_text = Functions::format_stripe_price( (float) $unit_amount, $currency );
			}

			if ( property_exists( $this->price_object, 'transform_quantity' ) && $this->price_object->transform_quantity ) {
				$divide_by = $this->price_object->transform_quantity->divide_by ?? 1;
				if ( $divide_by > 1 ) {
					$price_display_text .= ' ' . sprintf( __( 'per %d units', 'ytism' ), $divide_by );
				} else {
					$price_display_text .= ' ' . __( 'per unit', 'ytism' );
				}
			} elseif ( ! empty( $this->price_object->unit_label ) ) {
				$price_display_text .= ' ' . sprintf( __( 'per %s', 'ytism' ), esc_html( $this->price_object->unit_label ) );
			} else {
				$price_display_text .= ' ' . __( 'per unit', 'ytism' );
			}

			if ( $recurring_interval ) {
				$mapping_intervals    = [
					'day'   => __( 'day', 'ytism' ),
					'week'  => __( 'week', 'ytism' ),
					'month' => __( 'month', 'ytism' ),
					'year'  => __( 'year', 'ytism' ),
				];
				if ( $recurring_interval && array_key_exists( $recurring_interval, $mapping_intervals ) ) {
					$recurring_interval = $mapping_intervals[ $recurring_interval ];
				}
				$price_display_text .= ' / ' . esc_html( $recurring_interval );
			}
		} elseif ( $this->price_object->billing_scheme === 'tiered' && ! empty( $currency_price_data->tiers ) ) {

			$first_tier      = $currency_price_data->tiers[0];
			$flat_amount     = $first_tier->flat_amount_decimal ?? $first_tier->flat_amount ?? 0;
			$unit_amount     = $first_tier->unit_amount_decimal ?? $first_tier->unit_amount ?? 0;
			$has_flat_amount = is_numeric( $flat_amount ) && $flat_amount > 0;
			$has_unit_amount = is_numeric( $unit_amount ) && $unit_amount > 0;

			$price_display_text = __( 'Starts at', 'ytism' ) . ' ';
			if ( $has_unit_amount ) {
				$price_display_text .= Functions::format_stripe_price( (float) $unit_amount, $currency ) . ' ' . __( 'per unit', 'ytism' );
			}

			if ( $has_flat_amount ) {
				if ( $has_unit_amount ) {
					$price_display_text .= ' + ';
				}
				$price_display_text .= Functions::format_stripe_price( (float) $flat_amount, $currency );
			}

			if ( $recurring_interval ) {
				$mapping_intervals    = [
					'day'   => __( 'day', 'ytism' ),
					'week'  => __( 'week', 'ytism' ),
					'month' => __( 'month', 'ytism' ),
					'year'  => __( 'year', 'ytism' ),
				];
				if ( $recurring_interval && array_key_exists( $recurring_interval, $mapping_intervals ) ) {
					$recurring_interval = $mapping_intervals[ $recurring_interval ];
				}
				$price_display_text .= ' / ' . esc_html( $recurring_interval );
			}
		} else {

			$price_display_text = __( '(Price details vary)', 'ytism' );
			if ( $recurring_interval ) {
				$mapping_intervals    = [
					'day'   => __( 'day', 'ytism' ),
					'week'  => __( 'week', 'ytism' ),
					'month' => __( 'month', 'ytism' ),
					'year'  => __( 'year', 'ytism' ),
				];
				if ( $recurring_interval && array_key_exists( $recurring_interval, $mapping_intervals ) ) {
					$recurring_interval = $mapping_intervals[ $recurring_interval ];
				}
				$price_display_text .= ' / ' . esc_html( $recurring_interval );
			}
		}

		return esc_html( $price_display_text );
	}

	/**
	 * Calculate Stripe price including tiers, quantity transformations, and tax behavior.
	 *
	 * @param int    $quantity
	 * @param string $currency
	 * @return array
	 */
	public function calculate_total_for_currency( int $quantity, string $currency ): array|WP_Error {
		$currency_price_data = $this->get_price_data_for_currency( $currency );
		if ( ! $currency_price_data ) {
			return new WP_Error(
				'ytism_currency_unavailable',
				sprintf( "Price '%s' is not available in selected currency (%s).", $this->price_object->id, $currency )
			);
		}

		$total_amount_in_cents           = 0;
		$unit_price_at_quantity_in_cents = 0;

		// ----- Quantity transformation -----
		$effective_quantity = $quantity;
		if ( property_exists( $this->price_object, 'transform_quantity' ) && $this->price_object->transform_quantity ) {
			$divide_by  = $this->price_object->transform_quantity->divide_by;
			$round_mode = $this->price_object->transform_quantity->round;

			if ( $divide_by > 0 ) {
				$raw_transformed = $quantity / $divide_by;
				switch ( $round_mode ) {
					case 'up':
						$effective_quantity = ceil( $raw_transformed );
						break;
					case 'down':
						$effective_quantity = floor( $raw_transformed );
						break;
					case 'nearest':
						$effective_quantity = round( $raw_transformed );
						break;
					default:
						$effective_quantity = $raw_transformed;
						break;
				}
			}
		}
		$effective_quantity = max( 1, (int) $effective_quantity );

		// ----- Base Price Calculation -----
		if ( $this->price_object->billing_scheme === 'per_unit' ) {

			$unit_amount = $currency_price_data->unit_amount_decimal ?? $currency_price_data->unit_amount;
			if ( ! is_numeric( $unit_amount ) ) {
				return new WP_Error(
					'ytism_unit_amount_missing',
					sprintf( 'Per-unit price for %s has no unit_amount specified.', $currency )
				);
			}

			$unit_price_at_quantity_in_cents = (int) $unit_amount;
			$total_amount_in_cents           = $unit_price_at_quantity_in_cents * $effective_quantity;

		} elseif ( $this->price_object->billing_scheme === 'tiered' && ! empty( $currency_price_data->tiers ) ) {

			$tiers = $currency_price_data->tiers;
			usort(
				$tiers,
				function ( $a, $b ) {
					if ( $a->up_to === null ) {
						return 1;
					}
					if ( $b->up_to === null ) {
						return -1;
					}
					return $a->up_to <=> $b->up_to;
				}
			);

			switch ( $this->price_object->tiers_mode ) {
				case 'volume':
					$chosen_tier = null;
					foreach ( $tiers as $tier ) {
						if ( $tier->up_to === null || $effective_quantity <= $tier->up_to ) {
							$chosen_tier = $tier;
							break;
						}
					}

					if ( ! $chosen_tier ) {
						return new WP_Error(
							'ytism_tier_not_found',
							sprintf( 'Quantity exceeds all defined tiers for volume pricing in %s.', $currency )
						);
					}

					$tier_flat_amount = $chosen_tier->flat_amount_decimal ?? $chosen_tier->flat_amount ?? 0;
					$tier_unit_amount = $chosen_tier->unit_amount_decimal ?? $chosen_tier->unit_amount;
					if ( ! is_numeric( $tier_unit_amount ) ) {
						return new WP_Error(
							'ytism_tier_unit_missing',
							sprintf( 'Tiered price (volume) for %s has no unit_amount specified for a tier.', $currency )
						);
					}

					$unit_price_at_quantity_in_cents = (int) $tier_unit_amount;
					$total_amount_in_cents           = $unit_price_at_quantity_in_cents * $effective_quantity + (int) $tier_flat_amount;
					break;

				case 'graduated':
					$remaining_quantity = $effective_quantity;
					$cumulative_amount  = 0;

					foreach ( $tiers as $tier_index => $tier ) {
						$tier_start = ( $tier_index === 0 ) ? 1 : ( ( $tiers[ $tier_index - 1 ]->up_to ?? 0 ) + 1 );
						$tier_end   = $tier->up_to ?? INF;
						if ( $tier_end < $tier_start ) {
							continue;
						}

						$units_in_this_tier           = ( $tier_end === INF ) ? INF : ( $tier_end - $tier_start + 1 );
						$units_to_charge_in_this_tier = min( $remaining_quantity, $units_in_this_tier );

						if ( $units_to_charge_in_this_tier > 0 ) {
							$flat_amount = $tier->flat_amount_decimal ?? $tier->flat_amount ?? 0;
							$unit_amount = $tier->unit_amount_decimal ?? $tier->unit_amount ?? 0;

							if ( is_numeric( $flat_amount ) ) {
								$cumulative_amount += (int) $flat_amount;
							}
							if ( is_numeric( $unit_amount ) ) {
								$cumulative_amount += (int) $unit_amount * $units_to_charge_in_this_tier;
							}

							$remaining_quantity -= $units_to_charge_in_this_tier;
						}
					}

					$total_amount_in_cents           = $cumulative_amount;
					$unit_price_at_quantity_in_cents = $effective_quantity > 0
						? round( $total_amount_in_cents / $effective_quantity )
						: 0;
					break;

				default:
					return new WP_Error(
						'ytism_tiers_mode_unsupported',
						sprintf(
							"Unsupported tiers_mode '%s' for price '%s'.",
							$this->price_object->tiers_mode,
							$this->price_object->id
						)
					);
			}
		} else {
			return new WP_Error(
				'ytism_billing_scheme_unsupported',
				sprintf(
					"Unsupported billing scheme or missing price information for price '%s' in %s.",
					$this->price_object->id,
					$currency
				)
			);
		}

		// ----- Tax Calculation -----
		$tax_fees_in_cents = 0;
		$tax_behavior      = $this->price_object->tax_behavior ?? 'unspecified';

		if ( 'exclusive' === $tax_behavior ) {
			// Optional: apply a custom tax rate.
		}

		$subtotal_in_cents    = $total_amount_in_cents;
		$final_total_in_cents = $subtotal_in_cents + $tax_fees_in_cents;

		// Translate recurring interval.
		$recurring_interval_e = $this->price_object->recurring->interval ?? null;
		$mapping_intervals    = [
			'day'   => __( 'day', 'ytism' ),
			'week'  => __( 'week', 'ytism' ),
			'month' => __( 'month', 'ytism' ),
			'year'  => __( 'year', 'ytism' ),
		];
		if ( $recurring_interval_e && array_key_exists( $recurring_interval_e, $mapping_intervals ) ) {
			$recurring_interval_e = $mapping_intervals[ $recurring_interval_e ];
		}

		return [
			'price_per_unit_raw'      => $unit_price_at_quantity_in_cents,
			'subtotal_raw'            => $subtotal_in_cents,
			'tax_fees_raw'            => $tax_fees_in_cents,
			'total_raw'               => $final_total_in_cents,
			'recurring_interval'      => $this->price_object->recurring->interval ?? null,
			'recurring_interval_i18n' => $recurring_interval_e,
			'price_description'       => $this->get_description_for_currency( $currency ),
			'price_per_unit'          => Functions::format_stripe_price( $unit_price_at_quantity_in_cents, $currency ),
			'subtotal'                => Functions::format_stripe_price( $subtotal_in_cents, $currency ),
			'tax_fees'                => Functions::format_stripe_price( $tax_fees_in_cents, $currency ),
			'total'                   => Functions::format_stripe_price( $final_total_in_cents, $currency ),
			'currency'                => strtoupper( $currency ),
			'currency_symbol'         => Functions::get_currency_symbol( $currency ),
			'zero_price'              => Functions::format_stripe_price( 0, $currency ),
		];
	}
}
