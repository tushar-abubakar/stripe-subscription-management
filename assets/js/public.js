jQuery(function ($) {
    'use strict';
    const { __, _x, _n, _nx, sprintf } = typeof wp !== 'undefined' && wp.i18n ? wp.i18n : {};

    class YTISM_Price {
        constructor() {
            this.validPlans = ['individual', 'family', 'enterprise'];
            this.priceMap = {};
            this.containerSelector = '.ytism-product-container[data-plan]';
            this.latestSelections = {};
        }

        init() {
            $(document).on('change', `${this.containerSelector} select[name="ytism_currency"]`, e => this._handleCurrencyChange(e));
            $(document).on('change', `${this.containerSelector} input[name="ytism_price_id"][type="radio"]:not(.disabled)`, e => this._handlePriceOptionChange(e));
            $(document).on('input', `${this.containerSelector} input[name="ytism_quantity"]`, this._debounce(this._handleQuantityChange.bind(this), 800));

            this._initialActions();
        }

        getLatestSelection(planId = null) {
            if (planId) {
                const sel = this.latestSelections[planId] || null;
                if (sel && sel.priceId && sel.currency) {
                    return sel;
                }
                return null;
            }

            const keys = Object.keys(this.latestSelections);
            if (!keys.length) return null;

            const lastSel = this.latestSelections[keys[keys.length - 1]];
            if (lastSel && lastSel.priceId && lastSel.currency) {
                return lastSel;
            }
            return null;
        }

        _debounce(fn, delay) {
            let timer;
            return function (...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        }

        _updateLatestSelection($container) {
            if (!$container || $container.length === 0) return;

            const plan = $container.data('plan') || '';
            if (!plan) return;

            this.latestSelections[plan] = {
                plan: plan,
                currency: $container.find('[name="ytism_currency"]').first().val() || '',
                quantity: parseInt($container.find('input[name="ytism_quantity"]').first().val(), 10) || 1,
                priceId: $container.find('input[name="ytism_price_id"][type="radio"]:checked').first().val() || ''
            };
        }

        _initialActions() {
            const self = this;
            $(self.containerSelector).each(function () {
                const $container = $(this),
                    plan = $container.data('plan'), 
                    currency = $container.find('[name="ytism_currency"]').first().val();

                if (!plan || !currency || !self.validPlans.includes(plan)) {
                    console.warn('YTISM Price: Invalid or missing plan for container', $container);
                    return;
                }
            
                //self._updatePriceOptions($container, currency);

                const updatedPriceId = $container.find('input[name="ytism_price_id"][type="radio"]:checked').first().val(),
                    qty = parseInt($container.find('input[name="ytism_quantity"]').first().val(), 10) || 1;

                self._updateLatestSelection($container);
                self._fetchDataFromAjax($container, updatedPriceId, qty, currency, plan);
            });
        }

        _ensureContainer($el) {
            return $el.closest(this.containerSelector);
        }

        _resetSummaryDisplay($container) {
            if (!$container || $container.length === 0) {
                console.warn('YTISM Price: Container not found for resetting summary');
                return;
            }

            const $priceSummary = $container.find('.ytism-price-summary').first();
            if ($priceSummary.length === 0) {
                console.warn('YTISM Price: Price summary element not found for resetting summary');
                return;
            }

            $priceSummary.find('.ytism-price-subtotal').text("---");
            $priceSummary.find('.ytism-price-details > .ytism-price-unit').text("---");
            $priceSummary.find('.ytism-price-details > .ytism-price-desc').empty();
        }

        _showError($container, message) {
            if (!$container || $container.length === 0 || !message) return;

            let $errorBox = $container.find('.ytism-error-message').first();

            if ($errorBox.length === 0) {
                $errorBox = $('<div class="ytism-error-message"></div>');
                $container.append($errorBox);
            }

            $errorBox.text(message).show();
        }

        _fetchDataFromAjax($container, priceId, quantity, currency, plan) {
            const self = this;

            if (!$container || $container.length === 0) {
                console.warn('YTISM Price: Container not found');
                return;
            }

            if (!priceId || !currency || !plan || !this.validPlans.includes(plan)) {
                console.warn('YTISM Price: Missing or invalid price ID, currency, or plan');
                return;
            }

            const $priceSummary = $container.find('.ytism-price-summary').first();

            if ($priceSummary.length === 0) {
                console.warn('YTISM Price: Price summary element not found');
                return;
            }

            const priceMapId = `${plan}_${priceId}_${currency}_${quantity}`;
            const cachedData = self.priceMap[priceMapId];

            if (
                cachedData &&
                cachedData.subtotalDisplay &&
                cachedData.perUnitPrice &&
                cachedData.priceDescription &&
                typeof cachedData.recurringInterval !== "undefined" &&
				typeof cachedData.recurringIntervalI18n !== "undefined"
            ) {
                const recurringInterval = cachedData.recurringInterval || '';
                const recurringText = cachedData.recurringIntervalI18n
                    ? `<span class="ytism-price-recurring-interval">/${cachedData.recurringIntervalI18n}</span>`
                    : '';

                if ( plan === 'individual' ) {
                    $priceSummary.find('.ytism-price-subtotal').html(cachedData.priceName);
                    $priceSummary.find('.ytism-price-details > .ytsim-price-unit').html(cachedData.subtotalDisplay + recurringText);
                    $priceSummary.find('.ytism-price-details > .ytism-price-desc').html(cachedData.priceDescription);
                } else {
                    $priceSummary.find('.ytism-price-subtotal').html(cachedData.subtotalDisplay + recurringText);
                    $priceSummary.find('.ytism-price-details > .ytsim-price-unit').html(cachedData.perUnitPrice);
                    $priceSummary.find('.ytism-price-details > .ytism-price-desc').html(cachedData.priceDescription);
                }

                // Show or hide trial info based on plan and interval
                if ( plan === 'individual' && recurringInterval === 'year' ) {
                    const $trialInfo = $container.find('.ytism-trail-info');
                    if ( $trialInfo.length ) {
                        $trialInfo.show();
                    }

					if ( $(".ytism-zero-price").length ) {
						$(".ytism-zero-price").html(cachedData.zeroPrice);
					}
                } else {
                    const $trialInfo = $container.find('.ytism-trail-info');
                    if ( $trialInfo.length ) {
                        $trialInfo.hide();
                    }

					if ( $(".ytism-zero-price").length ) {
						$(".ytism-zero-price").html(cachedData.subtotalDisplay);
					}
                }

                // Update URL parameters without reloading the page
                if ( plan === 'family' ) {
                    const newUrl = self._updateUrlParams(window.location.href, {"members": quantity, "price_id": priceId, "currency": currency});
                    window.history.replaceState({}, '', newUrl);
                } else if ( plan === 'enterprise' ) {
                    const newUrl = self._updateUrlParams(window.location.href, {"seats": quantity, "price_id": priceId, "currency": currency});
                    window.history.replaceState({}, '', newUrl);
                } else if ( plan === 'individual' ) {
                    const newUrl = self._updateUrlParams(window.location.href, {"price_id": priceId, "currency": currency});
                    window.history.replaceState({}, '', newUrl);
                }

                $priceSummary.filter(':hidden').show();
                return;
            }

            $.ajax({
                url: YTISM_PUBLIC.ajax_url,
                type: 'POST',
                data: {
                    action: 'ytism_calculate_price',
                    price_id: priceId,
                    quantity: quantity,
                    currency: currency,
                    plan: plan,
                    nonce: YTISM_PUBLIC.price_calculation_nonce,
                },
                beforeSend: function() {
                    $container.find('.ytism-error-message').hide().empty();
                    $container.find('input[name="ytism_quantity"]').prop("disabled", true);
                    $container.find('[name="ytism_currency"]').prop("disabled", true);

                    // Show loading and hide response
                    if ( $priceSummary.find('.ytism-price-loading').length ) {
                        $priceSummary.find('.ytism-calculated-response').hide();
                        $priceSummary.find('.ytism-price-loading').fadeIn(200);
                    }
                },
                success: function(response) {
                    if (response.success && response.data) {
                        const { 
                            subtotal_display = "", 
                            recurring_interval = "",
							recurring_interval_i18n = "", 
                            price_per_unit_display = "", 
                            price_description = "",
							zero_price = "",
                            price_name = "" 
                        } = response.data || {};

                        const recurringText = recurring_interval_i18n
                            ? `<span class="ytism-price-recurring-interval">/${recurring_interval_i18n}</span>`
                            : '';

                        if ( plan === 'individual' ) {
                            $priceSummary.find('.ytism-price-subtotal').html(price_name);
                            $priceSummary.find('.ytism-price-details > .ytsim-price-unit').html(subtotal_display + recurringText);
                            $priceSummary.find('.ytism-price-details > .ytism-price-desc').html(price_description);
                        } else {
                            $priceSummary.find('.ytism-price-subtotal').html(subtotal_display + recurringText);
                            $priceSummary.find('.ytism-price-details > .ytsim-price-unit').html(price_per_unit_display);
                            $priceSummary.find('.ytism-price-details > .ytism-price-desc').html(price_description);
                        }
						if ( recurring_interval === 'year' && plan === 'individual' && $(".ytism-zero-price").length ) {
							$(".ytism-zero-price").html(zero_price);
						} else if ( $(".ytism-zero-price").length ) {
							$(".ytism-zero-price").html(subtotal_display);
						}

                        // Show or hide trial info based on plan and interval
                        if ( plan === 'individual' && recurring_interval === 'year' ) {
                            const $trialInfo = $priceSummary.find('.ytism-trail-info');
                            if ( $trialInfo.length ) {
                                $trialInfo.show();
                            }
                        } else {
                            const $trialInfo = $priceSummary.find('.ytism-trail-info');
                            if ( $trialInfo.length ) {
                                $trialInfo.hide();
                            }
                        }

                        // Cache the data
                        if (subtotal_display && price_per_unit_display && price_description) {
                            self.priceMap[priceMapId] = {
                                subtotalDisplay: subtotal_display,
                                recurringInterval: recurring_interval,
								recurringIntervalI18n: recurring_interval_i18n,
                                perUnitPrice: price_per_unit_display,
                                priceDescription: price_description,
								zeroPrice: zero_price,
                                priceName: price_name,
                            };

                            // Update URL parameters without reloading the page
                            if ( plan === 'family' ) {
                                const newUrl = self._updateUrlParams(window.location.href, {"members": quantity, "price_id": priceId, "currency": currency});
                                window.history.replaceState({}, '', newUrl);
                            } else if ( plan === 'enterprise' ) {
                                const newUrl = self._updateUrlParams(window.location.href, {"seats": quantity, "price_id": priceId, "currency": currency});
                                window.history.replaceState({}, '', newUrl);
                            } else if ( plan === 'individual' ) {
                                const newUrl = self._updateUrlParams(window.location.href, {"price_id": priceId, "currency": currency});
                                window.history.replaceState({}, '', newUrl);
                            }
                        }
                    } else {
                        self._resetSummaryDisplay($container);
                        self._showError($container, response.data?.message || __("Failed to fetch price details. Please try again.", "ytism"));
                    }
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    const message = textStatus === 'timeout'
                        ? __("Request timed out. Please try again.", "ytism")
                        : __("Network error. An error occurred while fetching price details.", "ytism");

                    self._showError($container, message);
                    self._resetSummaryDisplay($container);
                },
                complete: function() {
                    $container.find('input[name="ytism_quantity"]').prop("disabled", false);
                    $container.find('[name="ytism_currency"]').prop("disabled", false);

                    // Hide loading and show response
                    if ( $priceSummary.find('.ytism-price-loading').length ) {
                        $priceSummary.find('.ytism-price-loading').hide();
                        $priceSummary.find('.ytism-calculated-response').fadeIn(200);
                    }
                }
            });
        }

        _getPriceInfoForCurrency(priceObject, currency) {
            if (!priceObject || typeof priceObject !== 'object' || !currency || typeof currency !== 'string') return null;

            if (
                priceObject.hasOwnProperty('currency_options') &&
                priceObject.currency_options &&
                typeof priceObject.currency_options === 'object' &&
                priceObject.currency_options[currency]
            ) {
                return priceObject.currency_options[currency];
            }
            if (
                priceObject.hasOwnProperty('currency') &&
                typeof priceObject.currency === 'string' &&
                priceObject.currency === currency
            ) {
                return priceObject;
            }
            return null;
        }

        _updatePriceOptions($container, currency) {
            const self = this;

            if (!$container || $container.length === 0) {
                console.warn('YTISM Price: Container not found for updating price options');
                return;
            }

            const $priceOptions = $container.find('input[name="ytism_price_id"][type="radio"]');
            if ($priceOptions.length === 0) {
                console.warn('YTISM Price: No price options found in container');
                return;
            }

            let hasValidOption = false;
            let firstValidIndex = -1;
            let checkedValidIndex = -1;

            $priceOptions.each(function (i, el){
                const $option = $(el),
                    $optionBtn = $option.closest('.ytism-price-option'),
                    priceObject = $option.data('price-object') || null;

                if (!priceObject) {
                    $option.prop("disabled", true).prop('checked', false);
                    $optionBtn.removeClass("ytism-price-option-checked").hide();
                    return;
                }

                const currencyPrice = self._getPriceInfoForCurrency(priceObject, currency);

                if (currencyPrice) {
                    $option.prop("disabled", false);
                    $optionBtn.show();

                    // Track first valid and checked valid options
                    if (firstValidIndex === -1) firstValidIndex = i;
                    if ($option.is(":checked")) checkedValidIndex = i;

                    hasValidOption = true;
                } else {
                    $option.prop('checked', false).prop("disabled", true);
                    $optionBtn.removeClass("ytism-price-option-checked").hide();
                }
            });

            $priceOptions.each(function (i, el){
                const $option = $(el),
                    $optionBtn = $option.closest('.ytism-price-option');

                if (!$option.prop('disabled')) {
                    if (i === checkedValidIndex) {
                        $option.prop('checked', true);
                        $optionBtn.addClass("ytism-price-option-checked");
                    } else if (checkedValidIndex === -1 && i === firstValidIndex) {
                        $option.prop('checked', true);
                        $optionBtn.addClass("ytism-price-option-checked");
                    } else {
                        $option.prop('checked', false);
                        $optionBtn.removeClass("ytism-price-option-checked");
                    }
                }
            });

            if (!hasValidOption) {
                this._resetSummaryDisplay($container);
                this._showError($container, __("No available pricing options for the selected currency.", "ytism"));
            } else {
                $container.find('.ytism-error-message').hide().empty();
            }
        }
        
        _updateUrlParams(url, params = {}) {
            try {
                const urlObj = new URL(url, window.location.origin);

                // Loop through params and set/replace them
                $.each(params, function(key, value) {
                    if (value === null || value === undefined) {
                        urlObj.searchParams.delete(key);
                    } else {
                        urlObj.searchParams.set(key, value);
                    }
                });

                return urlObj.toString();
            } catch (err) {
                let anchor = '';
                if (url.includes('#')) {
                    const parts = url.split('#');
                    url = parts[0];
                    anchor = '#' + parts[1];
                }

                let [base, query] = url.split('?');
                const queryParams = new URLSearchParams(query || '');

                $.each(params, function(key, value) {
                    if (value === null || value === undefined) {
                        queryParams.delete(key);
                    } else {
                        queryParams.set(key, value);
                    }
                });

                const newQuery = queryParams.toString();
                return base + (newQuery ? '?' + newQuery : '') + anchor;
            }
        }

        _handleCurrencyChange(e) {
            if (!e || !e.currentTarget) return;

            const $el = $(e.currentTarget),
                $container = this._ensureContainer($el),
                currency = $el.val(),
                plan = $container.data('plan'),
                qty = $container.find('input[name="ytism_quantity"]').first().val() || 1,
                priceId = $container.find('input[name="ytism_price_id"][type="radio"]:checked').first().val() || '';

            // Update price options for the selected currency
            this._updatePriceOptions($container, currency);

            // After updating options, get the new checked priceId
            const updatedPriceId = $container.find('input[name="ytism_price_id"][type="radio"]:checked').first().val() || '';

            if (!currency || !updatedPriceId || !qty || !plan) {
                console.warn('YTISM Price: Missing currency, price ID, quantity, or plan');
                return;
            }

            this._updateLatestSelection($container);
            this._fetchDataFromAjax($container, updatedPriceId, qty, currency, plan);
        }

        _handleQuantityChange(e) {
            if (!e || !e.currentTarget) return;

            const $el = $(e.currentTarget),
                $container = this._ensureContainer($el),
                quantity = parseInt($el.val(), 10) || 1,
                currency = $container.find('[name="ytism_currency"]').first().val() || '',
                plan = $container.data('plan'),
                priceId = $container.find('input[name="ytism_price_id"][type="radio"]:checked').first().val() || '';

            if (!currency || !priceId || !quantity || !plan) {
                console.warn('YTISM Price: Missing currency, price ID, quantity, or plan');
                return;
            }

            if (quantity < 1) {
                $el.val(1);
                return;
            }

            this._updateLatestSelection($container);
            this._fetchDataFromAjax($container, priceId, quantity, currency, plan);
        }

        _handlePriceOptionChange(e) {
            if (!e || !e.currentTarget) return;

            const $el = $(e.currentTarget),
                $container = this._ensureContainer($el),
                priceId = $el.val() || '',
                currency = $container.find('[name="ytism_currency"]').first().val() || '',
                plan = $container.data('plan'),
                qty = $container.find('input[name="ytism_quantity"]').first().val() || 1;

            if (!currency || !priceId || !qty || !plan) {
                console.warn('YTISM Price: Missing currency, price ID, quantity, or plan');
                return;
            }

            // Update checked state visually
            $container.find('.ytism-price-option').removeClass("ytism-price-option-checked");
            $el.closest('.ytism-price-option').addClass("ytism-price-option-checked");

            this._updateLatestSelection($container);
            this._fetchDataFromAjax($container, priceId, qty, currency, plan);
        }
    }

    const price_handler = new YTISM_Price();
    price_handler.init();


    class YTISM_Payment {
        constructor() {
            this.stripe = null;
            this.activePayments = new Map();
            this.containerSelector = YTISM_PUBLIC.is_checkout_page ? '.ytism-checkout-cart' : '.ytism-subscription-container[data-plan]';
        }
        
        init() {
            if (
                typeof Stripe === 'undefined' ||
                !YTISM_PUBLIC.stripe_public_key ||
                !YTISM_PUBLIC.ajax_url ||
                !YTISM_PUBLIC.order_summary_link ||
				$(this.containerSelector).length === 0
            ) {
                console.warn('YTISM Payment: Missing Stripe.js, configuration, or valid subscription container');
                return;
            }

			const stripeLocale = YTISM_PUBLIC.locale ? YTISM_PUBLIC.locale.replace('_', '-').replace(' ', '-') : 'auto';
			this.stripe = Stripe(YTISM_PUBLIC.stripe_public_key, { locale: stripeLocale });
			
			// If is in checkout page
			if ( YTISM_PUBLIC.is_checkout_page && YTISM_CHECKOUT !== 'undefined' ) {
				this._setupPayment($(this.containerSelector), YTISM_CHECKOUT);
			} else {
				if ( ["individual", "family", "enterprise"].indexOf($(this.containerSelector).first().data('plan')) === -1) {
					console.warn('YTISM Payment: Invalid plan in subscription container');
					return;
				}
			}

            // Subscribe button
            $(document).on('click', `${this.containerSelector} .ytism-subscribe-button`, (e) => {
                e.preventDefault();
                this._createSubscription($(e.currentTarget));
            });
            
            // Payment form
            $(document).on('submit', `${this.containerSelector} .ytism-payment-section form.ytism-stripe-payment-form`, (e) => {
                e.preventDefault();
                this._handlePayment($(e.currentTarget));
            });

            // Download invoice
            $(document).on('click', `${this.containerSelector} .ytism-invoice-card .ytism-invoice-download-btn`, (e) => {
                e.preventDefault();
                this._handleDownload($(e.currentTarget));
            });

            // Cancel payment
            $(document).on('click', `${this.containerSelector} .ytism-cancel-section .ytism-payment-cancel-button:not('.disabled')`, (e) => {
                e.preventDefault();
                this._handleCancel($(e.currentTarget));
            });
        }

        _getContainerKey($container) {
            let id = $container.data('ytism-paykey');
            if (!id) {
                id = 'ytism-' + Date.now() + Math.random().toString(36).substr(2, 9);
                $container.data('ytism-paykey', id);
            }
            return id;
        }
        
        _createSubscription($btn) {
            const $container = $btn.closest(this.containerSelector);
            const $subSection = $container.find('.ytism-subscribe-section');
            const plan = $container.data('plan') || 'individual';
            let pricedata = price_handler.getLatestSelection(plan);

            if ( !pricedata || !pricedata.priceId || $subSection.length === 0 ) {
                this._showResponseMessage($container, __("Price selection is invalid. Please select a valid option.", "ytism"), "error");
                return;
            }

            const priceId = pricedata.priceId;
            const quantity = pricedata.quantity || 1;
            const hasTrial = pricedata.hasTrial || true;
            const currency = pricedata.currency || '';
            
            $container.find('.ytism-response-message').remove();
            let btnHtml = $btn.html() || __("Continue to Payment", "ytism");

            $.ajax({
                url: YTISM_PUBLIC.ajax_url,
                type: 'POST',
                data: {
                    action: 'ytism_create_subscription',
                    plan: plan,
                    price_id: priceId,
                    quantity: quantity || 1,
                    has_trial: hasTrial,
                    currency: currency,
                    nonce: YTISM_PUBLIC.create_subscription_nonce,
                },
                beforeSend: () => {
                    $container.find('.ytism-error').fadeOut(300);
                    $container.find('.ytism-subscribe-section').fadeOut(300);
                    $container.find('.ytism-payment-interface').fadeOut(300);
                    $container.find('.ytism-loading-skeleton').show();

                    $btn.prop('disabled', true).text( __("Loading...", "ytism") );

                    // Diable Currency, Quantity and Price Options
                    $('.ytism-product-container[data-plan="'+plan+'"]').find('[name="ytism_currency"]').prop("disabled", true);
                    $('.ytism-product-container[data-plan="'+plan+'"]').find('input[name="ytism_quantity"]').prop("disabled", true);
                    $('.ytism-product-container[data-plan="'+plan+'"]').find('input[name="ytism_price_id"][type="radio"]').addClass('disabled');
                },
                success: (res) => {
                    if (res.success) {
                        if ( res.data && res.data.intent_id && res.data.client_secret && res.data.sub_order_id && res.data.plan && res.data.invoice && res.data.invoice.amount_due && res.data.invoice.invoice_id ) {
                            this._setupPayment($container, res.data);
                        } else {
                            this._showResponseMessage($subSection, __("Incomplete payment data received. Please try again.", "ytism"), "error");
                            
                            $container.find('.ytism-subscribe-section').fadeIn(300);
                            $container.find('.ytism-payment-interface').fadeOut(300);
                            return;
                        }
                    } else {
                        this._showResponseMessage($subSection, res.data?.message || __("Failed to create subscription. Please try again.", "ytism"), "error");
                    }
                },
                error: () => {
                    this._showResponseMessage($subSection, __("Network error. An error occurred while creating the subscription. Please try again.", "ytism"), "error");

                    $container.find('.ytism-subscribe-section').fadeIn(300);
                    $container.find('.ytism-payment-interface').fadeOut(300);
                },
                complete: () => {
                    $btn.prop('disabled', false).html(btnHtml);

                    $container.find('.ytism-loading-skeleton').fadeOut(300);
                }
            });
        }
        
        _setupPayment($container, data) {
            const $form = $container.find('form.ytism-stripe-payment-form');
            const containerKey = this._getContainerKey($container);

            if ( !data || !data.intent_id || !data.client_secret || !data.sub_order_id || !data.plan || !data.invoice || !data.invoice.amount_due || !data.invoice.invoice_id ) {
                this._showResponseMessage($container, __("Incomplete payment data received. Please try again.", "ytism"), "error");

                $container.find('.ytism-subscribe-section').fadeIn(300);
                $container.find('.ytism-payment-interface').fadeOut(300);
                return;
            }

            // Setup invoice
            const $invoice = $container.find('.ytism-invoice-card');
            $invoice.find('.ytism-invoice-price').html(data?.invoice?.amount_due || '');
            $invoice.find('.ytism-invoice-download-btn').attr('data-invoice-id', data?.invoice?.invoice_id || '');

            if ( data?.invoice?.due_date ) {
                $invoice.find('.ytism-invoice-due-date').html(data?.invoice?.due_date);
            }
            if ( data?.invoice?.account_name ) {
                $invoice.find('.ytism-invoice-account-name').html(data?.invoice?.account_name);
            }
            if ( data?.invoice?.description ) {
                $invoice.find('.ytism-invoice-desc').html(data?.invoice?.description);
            }

            // Setup Stripe Elements
            if ( this.activePayments.has(containerKey) ) {
                const existing = this.activePayments.get(containerKey);
                if ( existing && existing.elements && existing.paymentElement ) {
                    existing.elements.unmount();
                }
                this.activePayments.delete(containerKey);
            }

            if ( !$form || $form.length === 0 ) {
                this._showResponseMessage($container, __("Payment form not found. Please refresh and try again.", "ytism"), "error");
                $container.find('.ytism-subscribe-section').fadeIn(300);
                $container.find('.ytism-payment-interface').fadeOut(300);
                return;
            }

            if ( !$form.hasClass('ytism-stripe-payment-form') ) {
                this._showResponseMessage($container, __("Payment form is invalid. Please refresh and try again.", "ytism"), "error");
                $container.find('.ytism-subscribe-section').fadeIn(300);
                $container.find('.ytism-payment-interface').fadeOut(300);
                return;
            }

            if ( !this.stripe ) {
                this._showResponseMessage($container, __("Stripe.js is not initialized. Please refresh and try again.", "ytism"), "error");
                $container.find('.ytism-subscribe-section').fadeIn(300);
                $container.find('.ytism-payment-interface').fadeOut(300);
                return;
            }
            
            // Pass the appearance object to the Elements instance
			const elements = this.stripe.elements({ 
                clientSecret: data.client_secret,
                appearance: {
                    theme: 'flat',
                    variables: {
                        fontLineHeight: '1.4',
                        borderRadius: '0.625rem',
                        colorPrimary: '#ffffff',
                        colorText: '#ffffff',
                        colorDanger: '#980002',
                        colorTextSecondary: '#eeeeee',
                        colorBackground: '#D9D9D980',
                        iconColor: '#ffffff',
                        accessibleColorOnColorBackground: '#D9D9D980',
                        accessibleColorOnColorPrimary: '#4A4063',
                    },
                    rules: {
                        '.Block': {
                            backgroundColor: '#D9D9D980',
                            boxShadow: 'none',
                        },
                        '.Label': {
                            color: '#ffffff',
                            fontWeight: '500'
                        },
                        '.Input': {
                            color: '#4A4063',
                            backgroundColor: '#ffffff',
                        },
                        '.Input::placeholder': {
                            color: '#9F9F9F',
                        },
                        '.Input:disabled, .Input--invalid:disabled': {
                            color: 'lightgray'
                        },
                        '.Tab': {
                            padding: '0.625rem 0.75rem 0.5rem 0.75rem',
                            border: 'none',
                            color: '#4A4063',
                        },
                        '.TabLabel': {
                            color: '#ffffff',
                        },
                        '.TabIcon': {
                            color: '#ffffff',
                        },
                        '.Tab--selected, .Tab--selected:focus, .Tab--selected:hover': {
                            border: 'none',
                            backgroundColor: '#fff',
                            boxShadow: '0 0 0 0.09375rem var(--colorPrimaryText), 0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.03), 0 0.1875rem 0.4375rem rgba(18, 42, 66, 0.04)',
                        },
                        '.TabLabel--selected': {
                            color: '#4A4063',
                        },
                        '.TabIcon--selected': {
                            color: '#4A4063',
                        },
                        '.Tab:focus': {
                            boxShadow: '0 0 0 0.09375rem var(--colorPrimaryText), 0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.03), 0 0.1875rem 0.4375rem rgba(18, 42, 66, 0.04)',
                            outline: 'none',
                        },
                        '.Input:focus': {
                            boxShadow: '0 0 0 0.09375rem var(--colorPrimaryText), 0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.03), 0 0.1875rem 0.4375rem rgba(18, 42, 66, 0.04)',
                            outline: 'none',
                        },
                        '.Input--invalid': {
                            boxShadow: '0 0 0 0.09375rem #fa755a, 0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.03), 0 0.1875rem 0.4375rem rgba(18, 42, 66, 0.04)',
                        },
                        '.Input--invalid:focus': {
                            boxShadow: '0 0 0 0.09375rem #fa755a, 0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.03), 0 0.1875rem 0.4375rem rgba(18, 42, 66, 0.04)',
                            outline: 'none',
                        },
                        '.Error': {
                            color: '#980002',
                            fontWeight: '500'
                        }
                    }
                }
            });

            const paymentElement = elements.create('payment', {
                layout: 'tabs'
            });

            $form.empty();
            paymentElement.mount($form[0]);

            this.activePayments.set(containerKey, {
                elements: elements,
                paymentElement: paymentElement,
				intentId: data.intent_id,
                subOrderId: data.sub_order_id,
                plan: data.plan,
                hasTrial: data.has_trial || false,
                isReady: false,
                attemptCount: 0,
            });

            let btnHtml;
            if (data.has_trial) {
                btnHtml = __("Start Free Trial", "ytism");
            } else {
                btnHtml = data?.invoice?.amount_due ? sprintf(__("Pay %s", "ytism"), data.invoice.amount_due) : __("Pay Now", "ytism");
            }

            const $submitBtn = $('<button>', {
                type: 'submit',
                class: 'ytism-pay-button ytism-btn',
                html: btnHtml,
                disabled: true
            });

            $form.append($submitBtn);

            paymentElement.on('change', (event) => {
                if ( event.error ) {
                    this._showResponseMessage($container, event.error.message || ___("An error occurred. Please check your details.", "ytism"), "error");
                }

                if ( event.complete ) {
                    $form.find('.ytism-pay-button').prop('disabled', false);
                    this.activePayments.get(containerKey).isReady = true;
                } else {
                    $form.find('.ytism-pay-button').prop('disabled', true);
                }
            });

            $form.closest('.ytism-payment-interface').fadeIn(300);
        }

        _showResponseMessage($parentSection, msg, type = "error") {
            let $msgBox = $parentSection.find('.ytism-response-message');
            let className = 'ytism-error';
            let heading = __("Error", "ytism");
            switch (type) {
                case 'success':
                    className = 'ytism-success';
                    heading = __("Success", "ytism");
                    break;
                case 'info':
                    className = 'ytism-info';
                    heading = __("Info", "ytism");
                    break;
                case 'warning':
                    className = 'ytism-warning';
                    heading = __("Warning", "ytism");
                    break;
                case 'error':
                default:
                    className = 'ytism-error';
                    heading = __("Error", "ytism");
                    break;
            }

            // Message inner HTML
            const innerHtml = `
                <div class="ytism-response-message-text">
                    <h3 class="ytism-response-message-text-heading">${heading}</h3>
                    <p class="ytism-response-message-body">${msg}</p>
                </div>
                <div class="ytism-response-message-close"><i class="ytism-icon ytism-icon-cross"></i></div>
            `;

            if (!$msgBox.length) {
                $msgBox = $('<div class="ytism-response-message"></div>');
                $parentSection.prepend($msgBox);
            }

            $msgBox.html(innerHtml).removeClass('ytism-success ytism-error ytism-info ytism-warning').addClass(className).fadeIn();

            // Scroll to message
            $('html, body').animate({
                scrollTop: Math.max(0, $msgBox.offset().top - 50)
            }, 400);

            // Close button event
            $msgBox.find('.ytism-response-message-close').off('click').on('click', function () {
                $msgBox.fadeOut();
            });
        }
        
        async _handlePayment($form) {
            const $container = $form.closest(this.containerSelector);
            const $paymentSection = $container.find('.ytism-payment-section');
            const containerKey = this._getContainerKey($container);
            const paymentData = this.activePayments.get(containerKey);

            // Clear previous errors
            $container.find('.ytism-response-message').empty().fadeOut(300);

            // Basic validation
            if ( !paymentData || $paymentSection.length === 0 || !this.stripe || !paymentData.elements || !paymentData.paymentElement || paymentData.isReady === false ) {
                this._showResponseMessage($container, __("Payment system not properly initialized. Please refresh and try again.", "ytism"), 'error');
                return;
            }

            if ( !paymentData.intentId || !paymentData.subOrderId || !paymentData.plan ) {
                this._showResponseMessage($paymentSection, __("Missing payment information. Please refresh and try again.", "ytism"), "error");
                return;
            }

            paymentData.attemptCount = paymentData.attemptCount || 0;

            if (paymentData.attemptCount >= 4) {
                this._showResponseMessage($paymentSection, sprintf(__("Too many failed attempts (%d). Redirecting to order summary...", "ytism"), paymentData.attemptCount), "error");
                return;
            }

            // Submit Stripe Elements
            const { error: submitError } = await paymentData.elements.submit();
            if (submitError) {
                this._showResponseMessage($paymentSection, submitError.message || __("Failed to submit payment details. Please check your information and try again.", "ytism"), "error");
                return;
            }

            $container.find('.ytism-cancel-section .ytism-payment-cancel-button').addClass('disabled').prop('disabled', true);
            const $btn = $form.find(".ytism-pay-button");
            const btnHtml = $btn.html();
            $btn.prop("disabled", true).html(__("Processing...", "ytism"));

            // Prepare Stripe confirm intent
            let return_url = YTISM_PUBLIC.order_summary_link + '/?ytism_stripe_action=true&sub_order_id=' + paymentData.subOrderId + '&payment_intent=' + paymentData.intentId + '&plan=' + paymentData.plan;
            if (paymentData.hasTrial) {
                return_url = YTISM_PUBLIC.order_summary_link + '/?ytism_stripe_action=true&sub_order_id=' + paymentData.subOrderId + '&setup_intent=' + paymentData.intentId + '&plan=' + paymentData.plan;
            }
            const confirmIntent = paymentData.hasTrial ? this.stripe.confirmSetup : this.stripe.confirmPayment;

            let result;
            try {
                result = await confirmIntent({
                    elements: paymentData.elements,
                    confirmParams: { return_url },
                    // redirect: 'if_required'
                });
            } catch (err) {
                this._showResponseMessage($paymentSection, __("Payment confirmation failed. Please try again.", "ytism"), "error");
                $btn.prop("disabled", false).html(btnHtml);
                
                $container.find('.ytism-cancel-section .ytism-payment-cancel-button').removeClass('disabled').prop('disabled', false);
                paymentData.attemptCount++;
                return;
            }

            // Handle Stripe result
            if (result.error) {
                paymentData.attemptCount++;
                $container.find('.ytism-cancel-section .ytism-payment-cancel-button').removeClass('disabled').prop('disabled', false);

                if (paymentData.attemptCount >= 4) {
                    $btn.prop("disabled", true).html(btnHtml);
                    this._showResponseMessage($paymentSection, sprintf(__("Too many failed attempts (%d). Redirecting to order summary...", "ytism"), paymentData.attemptCount), "error");

                    setTimeout(() => {
                        window.location.replace(YTISM_PUBLIC.order_summary_link + '/?sub_order_id=' + paymentData.subOrderId + '&status=failed');
                    }, 1500);
                    return;
                } else {
                    $btn.prop("disabled", false).html(btnHtml);

                    this._showResponseMessage($paymentSection, result.error.message || __("Payment confirmation failed. Please try again.", "ytism"), "error");
                }
                return;
            } else {
                // Successful submission, redirecting
                $container.find('.ytism-cancel-section .ytism-payment-cancel-button').addClass('disabled').prop('disabled', true);
            }
        }

        _handleDownload($button) {
            const $container = $button.closest(this.containerSelector);
            const $invoiceSection = $container.find('.ytism-invoice-card');
            const containerKey = this._getContainerKey($container);
            const paymentData = this.activePayments.get(containerKey);
            const invoiceId = $button.data('invoice-id');

            if (!invoiceId || $invoiceSection.length === 0) {
                this._showResponseMessage($invoiceSection, __('Invalid invoice ID or invoice section not found.', 'ytism'), 'error');
                return;
            }

            const downloadUrl = `${YTISM_PUBLIC.ajax_url}?action=ytism_download_invoice&nonce=${YTISM_PUBLIC.download_invoice_nonce}&invoice_id=${invoiceId}`;

            try {
                const downloadWindow = window.open(downloadUrl, '_blank');
                if (!downloadWindow || downloadWindow.closed || typeof downloadWindow.closed == 'undefined') {
                    this._showResponseMessage($invoiceSection, __('Popup blocked. Please allow popups for this site and try again.', 'ytism'), 'error');
                }
            } catch (error) {
                this._showResponseMessage($invoiceSection, __('Download failed. Please try again.', 'ytism'), 'error');
            }
        }

        _handleCancel($button) {
            const $container = $button.closest(this.containerSelector);
            const $cancelSection = $container.find('.ytism-cancel-section');
            const $paymentSection = $container.find('.ytism-payment-section');
            const containerKey = this._getContainerKey($container);
            const paymentData = this.activePayments.get(containerKey);

            if ( !$cancelSection || $cancelSection.length === 0 ) {
                this._showResponseMessage($container, __("Cancel section not found. Please refresh and try again.", "ytism"), "error");
                return;
            }

            if ( !paymentData || !paymentData.subOrderId ) {
                this._showResponseMessage($cancelSection, __("Missing payment information. Please refresh and try again.", "ytism"), "error");
                return;
            }

            const btnHtml = $button.html();
            $button.prop("disabled", true).addClass('disabled').html(__("Canceling...", "ytism"));
            paymentData.isReady = false;

            $.ajax({
                url: YTISM_PUBLIC.ajax_url,
                type: 'POST',
                data: {
                    action: 'ytism_cancel_payment',
                    sub_order_id: paymentData.subOrderId,
                    nonce: YTISM_PUBLIC.cancel_subscription_nonce,
                },
                beforeSend: () => {
                    $container.find('.ytism-error').fadeOut(300);
                    $paymentSection.find('.ytism-response-message').empty().fadeOut(300);
                },
                success: (res) => {
                    if (res.success) {
                        this._showResponseMessage($paymentSection, res.data?.message || __("Subscription canceled successfully.", "ytism"), "success");
                        
                        // Destroy Stripe Elements
                        if ( paymentData && paymentData.elements && paymentData.paymentElement ) {
                            paymentData.paymentElement.unmount();
                            this.activePayments.delete(containerKey);
                        }

                        // Reset UI
                        $container.find('.ytism-subscribe-section').fadeIn(300);
                        $container.find('.ytism-payment-interface').fadeOut(300);

                        // Re-enable Currency, Quantity and Price Options
                        const plan = $container.data('plan');
                        $('.ytism-product-container[data-plan="'+plan+'"]').find('[name="ytism_currency"]').prop("disabled", false);
                        $('.ytism-product-container[data-plan="'+plan+'"]').find('input[name="ytism_quantity"]').prop("disabled", false);
                        $('.ytism-product-container[data-plan="'+plan+'"]').find('input[name="ytism_price_id"][type="radio"]').removeClass('disabled');
                    } else {
                        this._showResponseMessage($paymentSection, res.data?.message || __("Failed to cancel subscription. Please try again.", "ytism"), "error");
                    }
                },
                error: () => {
                    this._showResponseMessage($paymentSection, __("Network error. An error occurred while canceling the subscription. Please try again.", "ytism"), "error");
                },
                complete: () => {
                    $button.prop("disabled", false).removeClass('disabled').html(btnHtml);
                    paymentData.isReady = true;
                }
            });
        }
    }

    if ( YTISM_PUBLIC.is_logged_in ) {
        const payment_handler = new YTISM_Payment();
        payment_handler.init();
    }

	/**
	 * jQuery Validation Custom Messages
	 * @see https://jqueryvalidation.org/documentation/
	 * @see https://stackoverflow.com/questions/2457032/
	 */
	$.extend($.validator.messages, {
        required: __('This field is required.', 'ytism'),
        remote: __('Please fix this field.', 'ytism'),
        minlength: $.validator.format(__('Please enter at least {0} characters.', 'ytism')),
        maxlength: $.validator.format(__('Please enter no more than {0} characters.', 'ytism')),
        rangelength: $.validator.format(__('Please enter a value between {0} and {1} characters long.', 'ytism')),
        min: $.validator.format(__('Please enter a value greater than or equal to {0}.', 'ytism')),
        max: $.validator.format(__('Please enter a value less than or equal to {0}.', 'ytism')),
        range: $.validator.format(__('Please enter a value between {0} and {1}.', 'ytism')),
        step: $.validator.format(__('Please enter a multiple of {0}.', 'ytism')),
        email: __('Please enter a valid email address.', 'ytism'),
        url: __('Please enter a valid URL.', 'ytism'),
        date: __('Please enter a valid date.', 'ytism'),
        dateISO: __('Please enter a valid date (ISO).', 'ytism'),
        number: __('Please enter a valid number.', 'ytism'),
        digits: __('Please enter only digits.', 'ytism'),
        equalTo: __('Please enter the same value again.', 'ytism'),

        // --- Additional methods ---
        accept: __('Please enter a file with a valid type.', 'ytism'),
        creditcard: __('Please enter a valid credit card number.', 'ytism'),
        extension: __('Please enter a file with a valid extension.', 'ytism'),
        phoneUS: __('Please enter a valid US phone number.', 'ytism'),
        require_from_group: $.validator.format(__('Please fill at least {0} of these fields.', 'ytism'))
    });
	
	/**
	 * Custom validator for jQuery Validate
	 * @see https://jqueryvalidation.org/jQuery.validator.addMethod/
	 */
    $.validator.addMethod("strongPassword", function (value, element) {
        if (!value) return false;

        if (typeof wp === "undefined" || !wp.passwordStrength || typeof wp.passwordStrength.meter !== "function") {
            return (value.length >= 6 && /[A-Za-z]/.test(value) && /\d/.test(value));
        }

        const blacklist = ["password", "123456", "qwerty", "letmein"];
        const strength = wp.passwordStrength.meter(value, blacklist, value);
        
        return strength >= 2;
    }, __("Enter a secure password (mix of letters, numbers)", "ytism"));

    $.validator.addMethod("validPhone", function(value, element) {
        var instance = itiInstances[element.id];
        if (!instance) return false;

        var iti = instance.iti;
        return this.optional(element) || iti.isValidNumber();
    }, __("Please enter a valid phone number", "ytism"));

    $.validator.addMethod("requiredSelect2", function(value, element) {
        if ($(element).hasClass("select2-hidden-accessible")) {
            let val = $(element).val();
            return val && val.length > 0 && val.filter(v => v !== "").length > 0;
        }
        return true;
    }, __("This field is required.", "ytism"));

	/**
	 * Select2 Custom Language Settings
	 * @see https://select2.org/i18n
	 */
	$.fn.select2.defaults.set('language', {
        errorLoading: function() {
            return __('The results could not be loaded.', 'ytism');
        },
        inputTooLong: function(args) {
            var overChars = args.input.length - args.maximum;
            return __('Please delete {0} character(s).', 'ytism').replace('{0}', overChars);
        },
        inputTooShort: function(args) {
            var remainingChars = args.minimum - args.input.length;
            return __('Please enter {0} or more characters.', 'ytism').replace('{0}', remainingChars);
        },
        loadingMore: function() {
            return __('Loading more results…', 'ytism');
        },
        maximumSelected: function(args) {
            return __('You can only select {0} item(s).', 'ytism').replace('{0}', args.maximum);
        },
        noResults: function() {
            return __('No results found', 'ytism');
        },
        searching: function() {
            return __('Searching…', 'ytism');
        },
        removeAllItems: function() {
            return __('Remove all items', 'ytism');
        }
    });
	
	/**
	 * Show response message in a section
	 * @param {jQuery} $section - The jQuery section element to show the message in
	 * @param {string} msg - The message to display
	 * @param {string} type - The type of message: "error" or "success"
	 * @param {boolean} showClose - Whether to show the close button (default: true)
	 */
    function showResponse($section, msg, type = "error", showClose = true) {
        let $msgBox = $section.find('.ytism-response-message');
        const isError = type === 'error';
        const heading = isError ? __("Error", "ytism") : __("Success", "ytism");

        // Message inner HTML
        const innerHtml = `
            <div class="ytism-response-message-text">
                <h3 class="ytism-response-message-text-heading">${heading}</h3>
                <p class="ytism-response-message-body">${msg}</p>
            </div>
            ${(showClose && showClose === true) ? `<div class="ytism-response-message-close"><i class="ytism-icon ytism-icon-cross"></i></div>` : ""}
        `;

        if (!$msgBox.length) {
            $msgBox = $('<div class="ytism-response-message"></div>');
            $section.prepend($msgBox);
        }

        $msgBox.html(innerHtml).removeClass('ytism-success ytism-error').addClass(isError ? 'ytism-error' : 'ytism-success').fadeIn();

        // Scroll to message.
        $('html, body').animate({
            scrollTop: Math.max(0, $msgBox.offset().top - 50)
        }, 400);

        // Close button event.
        $msgBox.find('.ytism-response-message-close').off('click').on('click', function () {
            $msgBox.fadeOut();
        });
    }
	
	/**
	 * Submit question answers via AJAX
	 */
    $(document).on("click", '.ytism-thankyou .ytism-questions form.ytism-questions-form [name="submit_action"]', function(e) {
        e.preventDefault();
        const action = $(this).val() || 'submit';
        const $container = $(this).closest('.ytism-thankyou');
        const $form = $container.find('form.ytism-questions-form');
        const formData = $form.serialize() + "&action=ytism_submit_question_answers&submit_action=" + action;

        $.ajax({
            url: YTISM_PUBLIC.ajax_url,
            type: 'POST',
            data: formData,
            beforeSend: function() {
                $form.find('input, select, textarea, button').prop('disabled', true);
                $form.find('.ytism-questions-button').addClass('disabled').prop('disabled', true);
            },
            success: function(response) {
                if (response.success) {
                    if (response.data && response.data.response_html) {
                        $container.fadeOut(300, function() {
                            let $newContent = $(response.data.response_html);
                            if ($newContent.hasClass('ytism-thankyou')) {
                                $newContent = $newContent.removeClass('ytism-thankyou');
                            }
                            $container.html($newContent.html()).fadeIn(300);
                        });
                    }
                } else {
                    showResponse($container, response.data?.message || __("An error occurred while submitting your answers. Please try again.", "ytism"), "error");
                }
            },
            error: function(xhr, status, error) {
                const message = textStatus === 'timeout'
                ? __("Request timed out. Please try again.", "ytism")
                : __("A network error occurred. Please check your connection and try again.", "ytism");

                showResponse($container, message, "error");
            },
            complete: function() {
                $form.find('input, select, textarea, button').prop('disabled', false);
                $form.find('.ytism-questions-button').prop('disabled', false).removeClass('disabled');
            }
        });
    });

    $(document).on('click', '#ytism-cancnel-intent', function(e) {
        e.preventDefault();
        const $btn = $(this);
        const intentId = $btn.data('intent-id') || '';

        $.ajax({
            url: YTISM_PUBLIC.ajax_url,
            type: 'POST',
            data: {
                action: 'ytism_cancel_payment_intent',
                intent_id: intentId,
                nonce: YTISM_PUBLIC.cancel_intent_nonce
            },
            beforeSend: function() {
                $btn.prop('disabled', true).text(__('Canceling...', 'ytism'));
            },
            success: function(response) {
                console.log('Cancel intent response:', response);
            },
            error: function(xhr, status, error) {
                console.error('Failed to cancel intent:', { xhr, status, error });
            },
            complete: function() {
                $btn.prop('disabled', false).text(__('Cancel Payment', 'ytism'));
            }
        });
    });


    $(document).on("input", ".ytism-form-password-field input[name='password']", function () {
        const $field = $(this).closest(".ytism-form-password-field");
        const $passwordInput = $field.find("input[name='password']");
        const $meter = $field.find(".ytism-form-password-meter");

        const val = $passwordInput.val().trim();

        if (!val.length) {
            $meter.text("").removeAttr("data-strength");
            return;
        }

        if ($meter.length === 0 || typeof wp === "undefined" || !wp.passwordStrength || typeof wp.passwordStrength.meter !== "function") {
            return;
        }

        const blacklist = ["password", "123456", "qwerty", "letmein"];
        const strength = wp.passwordStrength.meter(val, blacklist, val);

        let text = "";
        switch (strength) {
            case 0: text = __("Very Weak", "ytism"); break;
            case 1: text = __("Weak", "ytism"); break;
            case 2: text = __("Medium", "ytism"); break;
            case 3:
            case 4: text = __("Strong", "ytism"); break;
            default: text = "";
        }

        $meter.text(text).attr("data-strength", strength).show();
    });

    // Toggle password visibility
    $(document).on("click", ".ytism-form-password-field .ytism-form-toggle-password", function (e) {
        e.preventDefault();

        const $field = $(this).closest(".ytism-form-password-field");
        const $inputs = $field.find("input[type='password'], input[type='text']").filter(function() {
            return $(this).attr("name") === "password" || $(this).attr("name") === "new_password" || $(this).attr("name") === "confirm_password";
        });

        $inputs.each(function() {
            const $input = $(this);
            const isPassword = $input.attr("type") === "password";
            $input.attr("type", isPassword ? "text" : "password");
        });

        const isNowText = $inputs.first().attr("type") === "text";
        $(this).html(isNowText ? "<i class='ytism-icon ytism-icon-eye-off'></i>" : "<i class='ytism-icon ytism-icon-eye'></i>");
    });

    // Countdown for OTP resend
	function initCountdown($element) {
		$element.each(function () {
			const $c = $(this);
			const start = parseInt($c.data('timestart'), 10);
			const end = parseInt($c.data('timeend'), 10);
			let offset = Math.floor(Date.now() / 1000) - start;
			const $resendBtn = $c.closest('.ytism-auth-form').find("button[name='resend_otp']");

			if ($resendBtn.length) {
				$resendBtn.prop('disabled', true);
			}

			const i = setInterval(function () {
				let remaining = (end - start) - offset;
				if (remaining < 0) remaining = 0;

				const hours = Math.floor(remaining / 3600);
				const minutes = Math.floor((remaining % 3600) / 60);
				const seconds = remaining % 60;

				const paddedSeconds = seconds < 10 ? '0' + seconds : seconds;

				let text = '';

				if (hours > 0) {
					text += sprintf(
						/* translators: %d: number of hours */
						_n('%d hr ', '%d hrs ', hours, 'ytism'),
						hours
					);
				}

				if (minutes > 0) {
					text += sprintf(
						/* translators: %d: number of minutes */
						_n('%d min ', '%d mins ', minutes, 'ytism'),
						minutes
					);
				}

				if (seconds > 0 || text === '') {
					text += sprintf(
						/* translators: %d: number of seconds */
						_n('%d sec', '%d secs', seconds, 'ytism'),
						paddedSeconds
					);
				}

				$c.text(text.trim());

				if (remaining === 0) {
					clearInterval(i);

					if ($resendBtn.length) {
						$resendBtn.prop('disabled', false);
					}

					const $msg = $c.closest('.ytism-response-message').find('.ytism-response-message-close');
					if ($msg.length) {
						$msg.fadeOut(300);
					}
					return;
				}

				offset++;
			}, 1000);

			$c.attr('data-countdown-initialized', true);
		});
	}

    var itiInstances = {};
    $(".ytism-intl-tel-input").each(function(i, element) {
        var $input = $(element);

        var hiddenName = $input.attr("name") + "_full";
        var hiddenId   = $input.attr("id") + "_hidden";

        var $hidden = $("<input>", {
            type: "hidden",
            name: hiddenName,
            id: hiddenId
        });

        $input.after($hidden);

        // Init intlTelInput
        var iti = window.intlTelInput(element, {
            initialCountry: YTISM_PUBLIC.user_country,
            countrySearch: true,
            separateDialCode: false,
            autoHideDialCode: true,
            nationalMode: false,
            showFlags: true,
            formatAsYouType: true,
            formatOnDisplay: true,
            strictMode: true,
        });

        itiInstances[element.id] = { iti: iti, hidden: $hidden };
    });

    $(document).on("blur", ".ytism-intl-tel-input", function() {
        var instance = itiInstances[this.id];
        if (instance) {
            instance.hidden.val(instance.iti.getNumber());
        }
        $(this).valid();
    });
    
    $("select.ytism-select2").each(function(i, element) {
        let $el = $(element);
        if (typeof $.fn.select2 !== "undefined" && !$el.hasClass('select2-hidden-accessible')) {
            let placeholder = $el.attr('placeholder') || __("Select an option", "ytism");

            $el.select2({
                placeholder: placeholder,
                width: '100%',
                allowClear: $el.prop("multiple"),
                minimumResultsForSearch: 0,
                dropdownCssClass: "ytism-select2-dropdown",
            });
            $el.trigger('change');
        }
    });

    $(document).on("change", "select.ytism-select2", function () {
        if (typeof $.fn.validate !== "undefined" && $(this).closest("form").data("validator")) {
            $(this).valid();
        }
    });


    $('input[type="date"].ytism-date-picker').each(function(i, element) {
        $(element).datepicker({
            dateFormat: "yy-mm-dd",
            minDate: 0,
            changeMonth: true,
            changeYear: true,
            onSelect: function(dateText, inst) {
                $(this).valid();
            }
        });
    });


    // Normal form validation
    function initIndividualFormValidation($form) {
        if ($form.data("validator")) {
            $form.validate().destroy();
        }

        return $form.validate({
            errorClass: "ytism-field-error",
            errorElement: "div",
            rules: {
                first_name: { required: true },
                last_name: { required: true },
                email: { required: true, email: true },
                password: { required: true, minlength: 6 },
                confirm_password: { required: true, equalTo: $form.find("input[name='password']") },
                terms: { required: true },
            },
            messages: {
                first_name: __("First name is required.", "ytism"),
                last_name: __("Last name is required.", "ytism"),
                email: {
                    required: __("Email is required.", "ytism"),
                    email: __("Enter a valid email address.", "ytism"),
                },
                password: {
                    required: __("Password is required.", "ytism"),
                    minlength: __("Password must be at least 6 characters.", "ytism"),
                },
                confirm_password: {
                    required: __("Please confirm your password.", "ytism"),
                    equalTo: __("Passwords do not match.", "ytism"),
                },
                terms: __("You must agree to the terms.", "ytism"),
            },
            highlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').addClass("ytism-error-input");
                } else {
                    $(element).addClass("ytism-error-input");
                }
            },
            unhighlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').removeClass("ytism-error-input");
                } else {
                    $(element).removeClass("ytism-error-input");
                }
            },
            errorPlacement: function (error, element){
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(error).insertAfter($(element).next('.select2-container'));
                } else if ($(element).hasClass("ytism-intl-tel-input") && $(element).closest(".iti").length) {
                    $(error).insertAfter($(element).closest(".iti"));
                } else if ( ($(element).is("input[name='password']") && $(element).parent(".ytism-form-field-password-wrapper").length) || ($(element).is("input[name='confirm_password']") && $(element).parent(".ytism-form-field-password-wrapper").length) ) {
                    $(error).insertAfter($(element).parent(".ytism-form-field-password-wrapper"));
                } else if ($(element).is(":checkbox") || $(element).is(":radio")) {
                    $(error).appendTo($(element).closest(".ytism-form-field"));
                } else {
                    $(error).insertAfter($(element));
                }
            },
            submitHandler: function (formEl) {
                let $form = $(formEl),
                    formData = $form.serialize() + "&action=ytism_auth",
                    $btn = $form.find(".ytism-register-btn"),
                    $spinner = $btn.find(".ytism-btn-spinner"),
                    $formParent = $form.parent();

                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "POST",
                    data: formData,
                    beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
                        $btn.prop("disabled", true);
                        $spinner.show();
                    },
                    success: function (res) {
                        if (res?.success) {
                            showResponse($formParent, (res?.data?.message || __("Registration completed, check your email for further instruction.", "ytism")), "success");
                            
                            if (res?.data?.html) {
                                $form.parent().append(res.data.html);
                                $form.hide();
                                
                                $form.parent().find("form.ytism-otp-form").each(function() {
                                    initOTPFormValidation($(this));
                                });
                            }
                            $form[0].reset();
                        } else if (res?.data?.errors) {
                            if (res?.data?.message) {
                                showResponse($formParent, res.data.message, "error");
                            }

                            $form.validate().showErrors(res.data.errors);
                        } else {
                            showResponse($formParent, (res?.data?.message || __("Registration failed.", "ytism")), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while processing your registration.", "ytism");

                        showResponse($formParent, message, "error");
                    },
                    complete: function () {
                        $btn.prop("disabled", false);
                        $spinner.hide();
                    }
                });
                return false;
            }
        });
    }

	// Add supermanage form validation
	function initSuperManageFormValidation($form) {
		if ($form.data("validator")) {
			$form.validate().destroy();
		}

		return $form.validate({
			errorClass: "ytism-field-error",
			errorElement: "div",
			rules: {
				first_name: { required: true },
                last_name: { required: true },
				email: { required: true, email: true },
				phone_number: { required: true, validPhone: true },
				terms: { required: true },
			},
			messages: {
				first_name: __("First name is required.", "ytism"),
				last_name: __("Last name is required.", "ytism"),
				email: {
					required: __("Email is required.", "ytism"),
					email: __("Enter a valid email address.", "ytism"),
				},
				phone_number: {
					required: __("Phone number is required.", "ytism"),
					validPhone: __("Enter a valid phone number.", "ytism"),
				},
				terms: __("You must agree to the terms.", "ytism"),
			},
			highlight: function (element) {
				if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
					$(element).next('.select2-container').addClass("ytism-error-input");
				} else {
					$(element).addClass("ytism-error-input");
				}
			},
			unhighlight: function (element) {
				if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
					$(element).next('.select2-container').removeClass("ytism-error-input");
				} else {
					$(element).removeClass("ytism-error-input");
				}
			},
			errorPlacement: function (error, element){
				if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
					$(error).insertAfter($(element).next('.select2-container'));
				} else if ($(element).hasClass("ytism-intl-tel-input") && $(element).closest(".iti").length) {
					$(error).insertAfter($(element).closest(".iti"));
				} else if ($(element).is(":checkbox") || $(element).is(":radio")) {
					$(error).appendTo($(element).closest(".ytism-form-field"));
				} else {
					$(error).insertAfter($(element));
				}
			},
			submitHandler: function (formEl) {
				let $form = $(formEl),
					formData = $form.serialize() + "&action=ytism_add_supermanager",
					$btn = $form.find(".ytism-add-supermanager-btn"),
					$spinner = $btn.find(".ytism-btn-spinner"),
					$formParent = $form.parent();

				$.ajax({
					url: YTISM_PUBLIC.ajax_url,
					type: "POST",
					data: formData,
					beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
						$btn.prop("disabled", true);
						$spinner.show();
					},
					success: function (res) {
						if (res?.success) {
							showResponse($formParent, (res?.data?.message || __("Super manager added successfully, check you email for further instruction.", "ytism")), "success");
							$form[0].reset();
						} else if (res?.data?.errors) {
							if (res?.data?.message) {
								showResponse($formParent, res.data.message, "error");
							}

							$form.validate().showErrors(res.data.errors);
						} else {
							showResponse($formParent, (res?.data?.message || __("Failed to add super manager.", "ytism")), "error");
						}
					},
					error: function(jqXHR, textStatus, errorThrown) {
						const message = textStatus === 'timeout'
							? __("Request timed out. Please try again.", "ytism")
							: __("Network error. An error occurred while adding the super manager.", "ytism");

						showResponse($formParent, message, "error");
					},
					complete: function () {
						$btn.prop("disabled", false);
						$spinner.hide();
					}
				});
				return false;
			}
		});
	}

	// Apply promocode form validation
	function initRedeemCodeFormValidation($form) {
		if ($form.data("validator")) {
			$form.validate().destroy();
		}

		return $form.validate({
			errorClass: "ytism-field-error",
			errorElement: "div",
			rules: {
				promo_code: { required: true },
				email: { required: true, email: true },
			},
			messages: {
				promo_code: __("Promocode is required.", "ytism"),
				email: {
					required: __("Email is required.", "ytism"),
					email: __("Enter a valid email address.", "ytism"),
				},
			},
			submitHandler: function (formEl) {
				let $form = $(formEl),
					formData = $form.serialize() + "&action=ytism_redeem_promocode",
					$btn = $form.find(".ytism-apply-promocode-btn"),
					$spinner = $btn.find(".ytism-btn-spinner"),
					$formParent = $form.parent();

				$.ajax({
					url: YTISM_PUBLIC.ajax_url,
					type: "POST",
					data: formData,
					beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
						$btn.prop("disabled", true);
						$spinner.show();
					},
					success: function (res) {
						if (res?.success) {
							showResponse($formParent, (res?.data?.message || __("Promocode redeemed successfully.", "ytism")), "success");
							$form[0].reset();
						} else {
							showResponse($formParent, (res?.data?.message || __("Failed to redeem promocode.", "ytism")), "error");
						}
					},
					error: function(jqXHR, textStatus, errorThrown) {
						const message = textStatus === 'timeout'
							? __("Request timed out. Please try again.", "ytism")
							: __("Network error. An error occurred while redeeming the promocode.", "ytism");

						showResponse($formParent, message, "error");
					},
					complete: function () {
						$btn.prop("disabled", false);
						$spinner.hide();
					}
				});
				return false;
			}
		});
	}

    // Corporate form validation
    function initCorporateFormValidation($form) {
        if ($form.data("validator")) {
            $form.validate().destroy();
        }

        return $form.validate({
            ignore: [],
            errorClass: "ytism-field-error",
            errorElement: "div",
            rules: {
                organization_name: { required: true },
                organization_type: { required: true, digits: true },
                departments: { required: true, requiredSelect2: true, digits: true },
                country: { required: true, digits: true },
                first_name: { required: true },
                last_name: { required: true },
                email: { required: true, email: true },
                phone_number: { required: true, validPhone: true },
                password: { required: true, minlength: 6 },
                confirm_password: { required: true, equalTo: $form.find("input[name='password']") },
                terms: { required: true },
            },
            messages: {
                organization_name: __("Organization name is required.", "ytism"),
                organization_type: {
                    required: __("Organization type is required.", "ytism"),
                    digits: __("Select a valid Organization type.", "ytism"),
                },
                departments: {
                    required: __("Department is required.", "ytism"),
					requiredSelect2: __("Department is required.", "ytism"),
                    digits: __("Select a valid Department.", "ytism"),
                },
                country: {
                    required: __("Country is required.", "ytism"),
                    digits: __("Select a valid Country.", "ytism"),
                },
                first_name: __("First name is required.", "ytism"),
                last_name: __("Last name is required.", "ytism"),
                email: {
                    required: __("Email is required.", "ytism"),
                    email: __("Enter a valid email address.", "ytism"),
                },
                phone_number: {
                    required: __("Phone number is required.", "ytism"),
                    validPhone: __("Enter a valid phone number.", "ytism"),
                },
                password: {
                    required: __("Password is required.", "ytism"),
                    minlength: __("Password must be at least 6 characters.", "ytism"),
                },
                confirm_password: {
                    required: __("Please confirm your password.", "ytism"),
                    equalTo: __("Passwords do not match.", "ytism"),
                },
                terms: __("You must agree to the terms.", "ytism"),
            },
            highlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').addClass("ytism-error-input");
                } else {
                    $(element).addClass("ytism-error-input");
                }
            },
            unhighlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').removeClass("ytism-error-input");
                } else {
                    $(element).removeClass("ytism-error-input");
                }
            },
            errorPlacement: function (error, element){
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(error).insertAfter($(element).next('.select2-container'));
                } else if ($(element).hasClass("ytism-intl-tel-input") && $(element).closest(".iti").length) {
                    $(error).insertAfter($(element).closest(".iti"));
                } else if ( ($(element).is("input[name='password']") && $(element).parent(".ytism-form-field-password-wrapper").length) || ($(element).is("input[name='confirm_password']") && $(element).parent(".ytism-form-field-password-wrapper").length) ) {
                    $(error).insertAfter($(element).parent(".ytism-form-field-password-wrapper"));
                } else if ($(element).is(":checkbox") || $(element).is(":radio")) {
                    $(error).appendTo($(element).closest(".ytism-form-field"));
                } else {
                    $(error).insertAfter($(element));
                }
            },
            submitHandler: function (formEl) {
                let $form = $(formEl),
                    formData = $form.serialize() + "&action=ytism_auth",
                    $btn = $form.find(".ytism-register-enterprise-btn"),
                    $spinner = $btn.find(".ytism-btn-spinner"),
                    $formParent = $form.parent();

                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "POST",
                    data: formData,
                    beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
                        $btn.prop("disabled", true);
                        $spinner.show();
                    },
                    success: function (res) {
                        if (res?.success) {
                            showResponse($formParent, (res?.data?.message || __("Registration completed, check you email for further process.", "ytism")), "success");

                            if (res?.data?.html) {
                                $form.parent().append(res.data.html);
                                $form.hide();
                                
                                $form.parent().find("form.ytism-otp-form").each(function() {
                                    initOTPFormValidation($(this));
                                });
                            }
                            $form[0].reset();
                        } else if (res?.data?.errors) {
                            if (res?.data?.message) {
                                showResponse($formParent, res.data.message, "error");
                            }

                            $form.validate().showErrors(res.data.errors);
                        } else {
                            showResponse($formParent, (res?.data?.message || __("Registration failed.", "ytism")), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while registering.", "ytism");

                        showResponse($formParent, message, "error");
                    },
                    complete: function () {
                        $btn.prop("disabled", false);
                        $spinner.hide();
                    }
                });
                return false;
            }
        });
    }

    // OTP form validation
    function initOTPFormValidation($form) {
        if ($form.data("validator")) {
            $form.validate().destroy();
        }

        let validator = $form.validate({
            errorClass: "ytism-field-error",
            errorElement: "div",
            rules: {
                otp: {
                    required: true,
                    digits: true,
                    minlength: 6,
                    maxlength: 6
                },
            },
            messages: {
                otp: {
                    required: __("OTP is required.", "ytism"),
                    digits: __("Enter a valid OTP.", "ytism"),
                    minlength: __("OTP must be 6 digits.", "ytism"),
                    maxlength: __("OTP must be 6 digits.", "ytism"),
                },
            },
            highlight: function (element) {
                $(element).addClass("ytism-error-input");
            },
            unhighlight: function (element) {
                $(element).removeClass("ytism-error-input");
            },
            errorPlacement: function (error, element){
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(error).insertAfter($(element).next('.select2-container'));
                } else if ($(element).hasClass("ytism-intl-tel-input") && $(element).closest(".iti").length) {
                    $(error).insertAfter($(element).closest(".iti"));
                } else if ( ($(element).is("input[name='password']") && $(element).parent(".ytism-form-field-password-wrapper").length) || ($(element).is("input[name='confirm_password']") && $(element).parent(".ytism-form-field-password-wrapper").length) ) {
                    $(error).insertAfter($(element).parent(".ytism-form-field-password-wrapper"));
                } else if ($(element).is(":checkbox") || $(element).is(":radio")) {
                    $(error).appendTo($(element).closest(".ytism-form-field"));
                } else {
                    $(error).insertAfter($(element));
                }
            },
            submitHandler: function (formEl) {
                let $form = $(formEl),
                    $btn = $form.find("button[name='ytism_verify']"),
                    $spinner = $btn.find(".ytism-btn-spinner"),
                    $formParent = $form.parent();

                let formData = $form.serialize() + "&action=ytism_auth&redirect_to=" + encodeURIComponent(window.location.href);

				// Add plan, price, qty, currency data if present
                const $planContainer = $(".ytism-plan-container");
                if ($planContainer.length) {
                    const data = {
                        ytism_price_id: $planContainer.find("input[type='radio'][name='ytism_price_id']:checked").val(),
                        ytism_currency: $planContainer.find("[name='ytism_currency']").val(),
                        ytism_quantity: parseInt($planContainer.find("input[name='ytism_quantity']").val(), 10) || 1,
                        ytism_plan: $planContainer.find('.ytism-product-container').data("plan"),
                    };
                    Object.entries(data).forEach(([key, value]) => {
                        if (value !== undefined && value !== null && value !== "") {
                            formData += `&${key}=${encodeURIComponent(value)}`;
                        }
                    });
                }

                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "POST",
                    data: formData,
                    beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
                        $btn.prop("disabled", true);
                        $spinner.show();
                    },
                    success: function (res) {
                        if (res?.success) {
							$form[0].reset();

                            showResponse($formParent, __("OTP verified successfully. Redirecting...", "ytism"), "success");

                            if (res?.data?.redirect_url && res.data.redirect_url.length > 0) {
                                setTimeout(function() {
                                    window.location.replace(res.data.redirect_url);
                                }, 1000);
                                return;
                            }
                        } else if (res?.data?.errors) {
                            if (res?.data?.message) {
                                showResponse($formParent, res.data.message, "error");
                            }

                            validator.showErrors(res.data.errors);
                        } else {
                            showResponse($formParent, (res?.data?.message || __("OTP verification failed.", "ytism")), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while verifying OTP.", "ytism");

                        showResponse($formParent, message, "error");
                    },
                    complete: function () {
                        $btn.prop("disabled", false);
                        $spinner.hide();
                    }
                });

                return false;
            }
        });

        // Initialize countdown if needed
        let $countdown = $(".ytism-countdown");
        if ($countdown.length && !$countdown.attr('data-countdown-initialized')) {
            initCountdown($countdown);
        }

        // Resend OTP button click
        $form.on("click", "button[name='resend_otp']", function(e) {
            e.preventDefault();
            let $btn = $(this), 
                $spinner = $btn.find(".ytism-btn-spinner"),
                $formParent = $form.parent();

            if ($btn.prop('disabled')) return;

            // Clear previous messages
            $form.find(".ytism-form-response").empty().hide();

            // Clear OTP field
            $form.find("input[name='otp']").val("");
            validator.resetForm();

            // Temporarily make OTP not required
            validator.settings.rules['otp'] = {};
            validator.settings.messages['otp'] = {};
            
            $formParent.find(".ytism-response-message").empty().hide();

            $.ajax({
                url: YTISM_PUBLIC.ajax_url,
                type: "POST",
                data: $form.serialize() + "&action=ytism_auth&resend_otp=1",
                beforeSend: function() {
					$formParent.find('.ytism-response-message').empty().hide();
                    $btn.prop('disabled', true);
                    $spinner.show();
                },
                success: function(res) {
                    if (res?.success) {
                        showResponse($formParent, res.data.message || __("OTP (One-Time-Password) resent successfully. Please check your email.", "ytism"), "success");
                        
                        // Restart countdown
                        let $countdown = $formParent.find(".ytism-response-message").find(".ytism-countdown");
                        if ($countdown.length && !$countdown.attr('data-countdown-initialized')) {
                            $formParent.find(".ytism-response-message-close").hide();
                            initCountdown($countdown);
                        }
                    } else {
                        showResponse($formParent, (res?.data?.message || __("Failed to resend OTP (One-Time-Password).", "ytism")), "error");

                        let $countdown = $formParent.find(".ytism-response-message").find(".ytism-countdown");
                        if ($countdown.length && !$countdown.attr('data-countdown-initialized')) {
                            $formParent.find(".ytism-response-message-close").hide();
                            initCountdown($countdown);
                        }
                    }
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    const message = textStatus === 'timeout'
                        ? __("Request timed out. Please try again.", "ytism")
                        : __("Network error. An error occurred while resending OTP.", "ytism");

                    showResponse($formParent, message, "error");
                },
                complete: function() {
                    $btn.prop('disabled', false);
                    $spinner.hide();

                    // Restore OTP required rule
                    validator.settings.rules['otp'] = {
                        required: true,
                        digits: true,
                        minlength: 6,
                        maxlength: 6
                    };
                    validator.settings.messages['otp'] = {
                        required: __("OTP is required.", "ytism"),
                        digits: __("Enter a valid OTP.", "ytism"),
                        minlength: __("OTP must be 6 digits.", "ytism"),
                        maxlength: __("OTP must be 6 digits.", "ytism"),
                    };
                }
            });
        });
    }

    // Login form valiadtion
    function initLoginFormValidation($form) {
        if ($form.data("validator")) {
            $form.validate().destroy();
        }

        return $form.validate({
            errorClass: "ytism-field-error",
            errorElement: "div",
            rules: {
                email: { required: true, email: true },
                password: { required: true },
            },
            messages: {
                email: {
                    required: __("Email is required.", "ytism"),
                    email: __("Enter a valid email address.", "ytism"),
                },
                password: { required: __("Password is required.", "ytism") },
            },
            highlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').addClass("ytism-error-input");
                } else {
                    $(element).addClass("ytism-error-input");
                }
            },
            unhighlight: function (element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(element).next('.select2-container').removeClass("ytism-error-input");
                } else {
                    $(element).removeClass("ytism-error-input");
                }
            },
            errorPlacement: function (error, element) {
                if ($(element).hasClass('ytism-select2') && $(element).next('.select2-container').length) {
                    $(error).insertAfter($(element).next('.select2-container'));
                } else if ($(element).hasClass("ytism-intl-tel-input") && $(element).closest(".iti").length) {
                    $(error).insertAfter($(element).closest(".iti"));
                } else if ( ($(element).is("input[name='password']") && $(element).parent(".ytism-form-field-password-wrapper").length) || ($(element).is("input[name='confirm_password']") && $(element).parent(".ytism-form-field-password-wrapper").length) ) {
                    $(error).insertAfter($(element).parent(".ytism-form-field-password-wrapper"));
                } else if ($(element).is(":checkbox") || $(element).is(":radio")) {
                    $(error).appendTo($(element).closest(".ytism-form-field"));
                } else {
                    $(error).insertAfter($(element));
                }
            },
            submitHandler: function (formEl) {
                let $form = $(formEl), 
					currentUrl = window.location.href,
                    formData = $form.serialize() + "&action=ytism_auth&redirect_to=" + encodeURIComponent(currentUrl),
                    $btn = $form.find(".ytism-login-btn"),
                    $spinner = $btn.find(".ytism-btn-spinner"),
                    $formParent = $form.parent();

                // Add plan, price, qty, currency data if present
                const $planContainer = $(".ytism-plan-container");
                if ($planContainer.length) {
                    const data = {
                        ytism_price_id: $planContainer.find("input[type='radio'][name='ytism_price_id']:checked").val(),
                        ytism_currency: $planContainer.find("[name='ytism_currency']").val(),
                        ytism_quantity: parseInt($planContainer.find("input[name='ytism_quantity']").val(), 10) || 1,
                        ytism_plan: $planContainer.find('.ytism-product-container').data("plan"),
                    };
                    Object.entries(data).forEach(([key, value]) => {
                        if (value !== undefined && value !== null && value !== "") {
                            formData += `&${key}=${encodeURIComponent(value)}`;
                        }
                    });
                }

                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "POST",
                    data: formData,
                    beforeSend: function () {
						$formParent.find('.ytism-response-message').empty().hide();
                        $btn.prop("disabled", true);
                        $spinner.show();
                    },
                    success: function (res) {
                        if (res?.success) {
                            $form[0].reset();

                            showResponse($formParent, res?.data?.message || __("Login succeed. Redirecting...", "ytism"), "success");

							if (res?.data?.redirect_url && res.data.redirect_url.length > 0) {
                                setTimeout(function() {
                                    window.location.replace(res.data.redirect_url);
                                }, 1000);
                                return;
                            }
                        } else if (res?.data?.errors) {
                            if (res?.data?.message) {
                                showResponse($formParent, res.data.message, "error");
                            }
                            $form.validate().showErrors(res.data.errors);
                        } else {
                            showResponse($formParent, (res?.data?.message || __("Login failed.", "ytism")), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while logging in.", "ytism");

                        showResponse($formParent, message, "error");
                    },
                    complete: function () {
                        $btn.prop("disabled", false);
                        $spinner.hide();
                    }
                });
                return false;
            }
        });
    }
    
    if ( ! YTISM_PUBLIC.is_auth_page ) {
        var $authContainer = $('.ytism-auth-container'), $authForm = $authContainer.find('.ytism-auth-form'), $formOption = $authContainer.find('.ytism-auth-options');

		const $loginFormOption = `
			<p>
				<span>
					${ __( "Don't have an account?", 'ytism' ) }
					<a href="javascript:void(0)" class="ytism-show-register">
						${ __( 'Register here', 'ytism' ) }
					</a>
				</span>
			</p>
			<p>
				<span>
					${ __( 'Forgotten password?', 'ytism' ) }
					<a href="${ YTISM_PUBLIC.site_url + '/ytism-alias-auth/forget-password/' }" class="ytism-show-reset-password">
						${ __( 'Reset Password', 'ytism' ) }
					</a>
				</span>
			</p>
		`;

		const $registerFormOption = `
			<p>
				<span>
					${ __( 'Already have an account?', 'ytism' ) }
					<a href="#" class="ytism-show-login">
						${ __( 'Login here', 'ytism' ) }
					</a>
				</span>
			</p>
		`;


        $(document).on('click', '.ytism-auth-container .ytism-auth-options .ytism-show-register:not(.disabled)', function(e){
            e.preventDefault();

            let $link = $(this), $container = $link.closest('.ytism-auth-container'), $authform = $container.find('.ytism-auth-form'), $option = $container.find('.ytism-auth-options');

            if ( $authform.find('.ytism-register-form').length ) {
                $authform.children().not('.ytism-register-form').hide();
                $authform.find('.ytism-register-form').show();
                $option.html($registerFormOption);
            } else {
                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "GET",
                    data: {
                        action: 'ytism_auth_load_from',
                        form_type: 'register',
						nonce: YTISM_PUBLIC.auth_load_form_nonce,
                    },
                    beforeSend: function () {
                        $link.addClass('disabled');
                    },
                    success: function (res) {
                        if (res?.success) {
                            if (res?.data?.html) {
                                $authform.append(res.data.html);
                                $authform.find('.ytism-register-form').show();
                                $authform.children().not('.ytism-register-form').hide();
                                $option.html($registerFormOption);

                                if ( $authform.find('form.ytism-register-form').length ) {
                                    initIndividualFormValidation( $authform.find('form.ytism-register-form') );
                                }
                            } else {
                                showResponse($authform, res?.data?.message || __("Failed to load registration form.", "ytism"), "error");
                            }
                        } else {
                            showResponse($authform, res?.data?.message || __("Failed to load registration form.", "ytism"), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while loading registration form.", "ytism");

                        showResponse($authform, message, "error");
                    },
                    complete: function () {
                        $link.removeClass("disabled");
                    }
                });
            }
        });

        $(document).on('click', '.ytism-auth-container .ytism-auth-options .ytism-show-login:not(.disabled)', function(e){
            e.preventDefault();
            let $link = $(this), $container = $link.closest('.ytism-auth-container'), $authform = $container.find('.ytism-auth-form'), $option = $container.find('.ytism-auth-options');

            if ( $authform.find('.ytism-login-form').length ) {
                $authform.children().not('.ytism-login-form').hide();
                $authform.find('.ytism-login-form').show();
                $option.html($loginFormOption);
            } else {
                $.ajax({
                    url: YTISM_PUBLIC.ajax_url,
                    type: "GET",
                    data: {
                        action: 'ytism_auth_load_from',
                        form_type: 'login',
						nonce: YTISM_PUBLIC.auth_load_form_nonce,
                    },
                    beforeSend: function () {
                        $link.addClass('disabled');

                        // Hide Form
                        $authform.find('.ytism-register-form').hide();

                        // Add skeleton
                        let $enterpriseFormSkeleton = $authform.find('.ytism-form-skeleton');
                        if (!$enterpriseFormSkeleton.length) {
                            $enterpriseFormSkeleton = $(`<div class="ytism-login-form-skeleton"> <div class="ytism-skeleton ytism-skeleton-input"></div><div class="ytism-skeleton ytism-skeleton-password"></div> <div class="ytism-skeleton-checkbox"> <div class="ytism-skeleton ytism-skeleton-checkbox-box"></div> <div class="ytism-skeleton ytism-skeleton-checkbox-text"></div> </div> <div class="ytism-skeleton ytism-skeleton-submit ytism-skeleton-w-70"></div><div class="ytism-skeleton-text"> <div class="ytism-skeleton-text-line"></div> <div class="ytism-skeleton-text-line"></div> </div> </div>`);
                            $authform.append($enterpriseFormSkeleton);
                        }
                        $enterpriseFormSkeleton.fadeIn(300);
                    },
                    success: function (res) {
                        if (res?.success) {
                            if (res?.data?.html) {
                                $authform.append(res.data.html);
                                $authform.find('.ytism-login-form').show();
                                $authform.children().not('.ytism-login-form').hide();
                                $option.html($loginFormOption);

                                if ( $authform.find('form.ytism-login-form').length ) {
                                    initLoginFormValidation( $authform.find('form.ytism-login-form') );
                                }
                            } else {
                                showResponse($authform, res?.data?.message || __("Failed to load login form.", "ytism"), "error");
                            }
                        } else {
                            showResponse($authform, res?.data?.message || __("Failed to load login form.", "ytism"), "error");
                        }
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        const message = textStatus === 'timeout'
                            ? __("Request timed out. Please try again.", "ytism")
                            : __("Network error. An error occurred while loading login form.", "ytism");

                        showResponse($authform, message, "error");
                    },
                    complete: function () {
                        $link.removeClass("disabled");
                        $authform.find('.ytism-form-skeleton').fadeOut(300);
                    }
                });
            }
        });

        // Validate Registration Form
        if ( $("form.ytism-register-form").length ) {
            $("form.ytism-register-form").each(function() {
                initIndividualFormValidation($(this));
            });
        }

		// Validate Add Super Manager Form
		if ( $("form.ytism-add-supermanager-form").length ) {
			$("form.ytism-add-supermanager-form").each(function() {
				initSuperManageFormValidation($(this));
			});
		}

		// Validate Redeem Code Form
		if ( $("form.ytism-apply-promocode-form").length ) {
			$("form.ytism-apply-promocode-form").each(function() {
				initRedeemCodeFormValidation($(this));
			});
		}
        
        // Validate Corporate Registration Form
        if ( $("form.ytism-enterprise-register-form").length ) {
            $("form.ytism-enterprise-register-form").each(function() {
                initCorporateFormValidation($(this));
            });
        }

        // Validate OTP Form
        if ( $("form.ytism-otp-form").length ) {
            $("form.ytism-otp-form").each(function() {
                initOTPFormValidation($(this));
            });
        }

        // Validate Login Form
        if ( $("form.ytism-login-form").length ) {
            $("form.ytism-login-form").each(function() {
                initLoginFormValidation($(this));
            });
        }
    }

	/** 
	 * Individual plan form
	 */
	$(document).on('change', '.ytism-price-items > label > .ytism-plan-item > input[type="radio"][name="price_id"]', function (e) {
		var $this   = $(this),
			$items  = $this.closest('.ytism-price-items'),
			$label  = $this.closest('label'),
			interval = $label.data('interval'),
			buttonlabel = ( interval === 'year' ) ? __( 'Start Your Free Trial', 'ytism' ) : __( 'Continue to Subscribe', 'ytism' );

		$items.find('label').removeClass('checked');
		$label.addClass('checked');

		if ( $this.closest('form').find('button.ytism-plan-submit').length ) {
			$this.closest('form').find('button.ytism-plan-submit').text( buttonlabel );
		}
	});

    /**
     * Reedem Code
     */
    $(document).on('submit', '#redeem-family-code-form', function(e) {
        e.preventDefault();

        var form = $(this);
        var responseBox = $('.response-message-container');

        $.ajax({
            url: YTISM_PUBLIC.ajax_url,
            type: 'POST',
            dataType: 'json',
            data: {
                action: 'redeem_family_code',
                security: YTISM_PUBLIC.redeem_code_nonce,
                familyCode: form.find('[name="familyCode"]').val(),
                name: form.find('[name="name"]').val(),
                lastName: form.find('[name="lastName"]').val(),
                email: form.find('[name="email"]').val(),
                password: form.find('[name="password"]').val(),
                language: form.find('[name="language"]').val(),
            },
            beforeSend: function() {
                responseBox.html(__('Processing...', 'ytism')).show();
            },
            success: function(res) {
                if (res.success) {
                    form[0].reset();
                    $('.promo-code-section').hide();
                    $('.promocode-section').show();

                    // Smooth scroll
                    window.scrollBy({
                        top: 100,
                        behavior: 'smooth'
                    });

                    responseBox.html(
                        `<h3 style="color:white;font-size:1.75rem;font-weight:800;">${res.data.message}</h3>
                         <div class="user-info">
                            <p><strong>${__('Name:', 'ytism')}</strong> ${res.data.name}</p>
                            <p>${__('Great! You still have', 'ytism')} <strong>${res.data.seats}</strong> ${__('coupons to redeem.', 'ytism')}</p>
                         </div>`
                    );

                    $('.family-plan.shadow').show();
                    $('.downloadqr-section').show();

                } else {
                    responseBox.html(`<span style="color:#f6da46;">${res.data.message}</span>`);
                }
            },
            error: function(jqXHR, textStatus, errorThrown) {
                const message = textStatus === 'timeout' 
                    ? __("Request timed out. Please try again.", "ytism")
                    : __("Network error. An error occurred while redeeming the code.", "ytism");

                responseBox.html(`<span style="color:red;">${message}</span>`);
            },
            complete: function() {
                setTimeout(function() {
                    responseBox.fadeOut();
                }, 10000);
            }
        });
    });
});