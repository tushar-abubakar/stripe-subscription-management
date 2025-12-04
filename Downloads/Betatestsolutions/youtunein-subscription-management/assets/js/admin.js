jQuery(function ($) {
    'use strict';
    
    // Check if wp.i18n is available, otherwise use fallback
    const { __, _x, _n, _nx } = typeof wp !== 'undefined' && wp.i18n ? wp.i18n : {};

    /**
     * Initialize Select2 for page and product selects
     */
    function initializeSelect2() {
        if (typeof $.fn.select2 !== 'undefined') {
            $('.ytism-page-select').each(function() {
                if (!$(this).hasClass('select2-hidden-accessible')) {
                    $(this).select2({
                        width: '400px',
                        allowClear: true,
                        placeholder: __('Select a page', 'ytism'),
                        minimumResultsForSearch: 5
                    });
                }
            });

            $('.ytism-product-select').each(function() {
                if (!$(this).hasClass('select2-hidden-accessible')) {
                    $(this).select2({
                        width: '400px',
                        allowClear: true,
                        placeholder: $(this).data('placeholder') || __('Search for a subscription product…', 'ytism'),
                        minimumResultsForSearch: 3
                    });
                }
            });
            
            // Update unique options after initialization
            updateUniqueOptions();
        }
    }

    /**
     * Get selected product IDs except for current select
     */
    function getSelectedProductIdsExcept($current) {
        var vals = [];
        $('.ytism-product-select').each(function () {
            var v = $(this).val();
            if (!v) return;
            if ($current && $(this).is($current)) return;
            vals.push(String(v));
        });
        return vals;
    }

    /**
     * Get selected page IDs except for current select
     */
    function getSelectedPageIdsExcept($current) {
        var vals = [];
        $('.ytism-page-select, select[name*="myaccount_page_id"], select[name*=""], select[name*="checkout_page_id"], select[name*="thankyou_page_id"], select[name*="terms_page_id"], select[name*="privacy_page_id"]').each(function () {
            var v = $(this).val();
            if (!v) return;
            if ($current && $(this).is($current)) return;
            vals.push(String(v));
        });
        return vals;
    }

    /**
     * Update unique page and product options
     */
    function updateUniqueOptions() {
        // Debounce to prevent excessive calls
        clearTimeout(window.ytismUpdateTimeout);
        window.ytismUpdateTimeout = setTimeout(function() {
            updateUniqueOptionsImmediate();
        }, 100);
    }

    /**
     * Immediate update of unique options (internal function)
     */
    function updateUniqueOptionsImmediate() {
        // Handle page uniqueness (including myaccount, checkout, ordersummary and thankyou pages)
        var selectedPages = [];
        $('.ytism-page-select, select[name*="myaccount_page_id"], select[name*="checkout_page_id"], select[name*="ordersummary_page_id"], select[name*="thankyou_page_id"], select[name*="terms_page_id"], select[name*="privacy_page_id"]').each(function() {
            var val = $(this).val();
            if (val && val !== '') selectedPages.push(val.toString());
        });
        
        $('.ytism-page-select, select[name*="myaccount_page_id"], select[name*="checkout_page_id"], select[name*="ordersummary_page_id"], select[name*="thankyou_page_id"], select[name*="terms_page_id"], select[name*="privacy_page_id"]').each(function() {
            var currentVal = $(this).val();
            var $select = $(this);
            
            $select.find('option').each(function() {
                var optVal = $(this).val();
                if (optVal && optVal !== '' && selectedPages.includes(optVal.toString()) && optVal.toString() !== currentVal.toString()) {
                    $(this).prop('disabled', true);
                } else {
                    $(this).prop('disabled', false);
                }
            });
        });
        
        // Handle product uniqueness (only for plan products)
        var selectedProducts = [];
        $('.ytism-product-select').each(function() {
            var val = $(this).val();
            if (val && val !== '') selectedProducts.push(val.toString());
        });
        
        $('.ytism-product-select').each(function() {
            var currentVal = $(this).val();
            var $select = $(this);
            
            $select.find('option').each(function() {
                var optVal = $(this).val();
                if (optVal && optVal !== '' && selectedProducts.includes(optVal.toString()) && optVal.toString() !== currentVal.toString()) {
                    $(this).prop('disabled', true);
                } else {
                    $(this).prop('disabled', false);
                }
            });
        });
        
        // Refresh Select2 to show disabled options (prevent infinite loop)
        $('.ytism-page-select, .ytism-product-select, select[name*="myaccount_page_id"], select[name*="checkout_page_id"], select[name*="ordersummary_page_id"], select[name*="thankyou_page_id"], select[name*="terms_page_id"], select[name*="privacy_page_id"]').each(function() {
            if ($(this).hasClass('select2-hidden-accessible')) {
                $(this).trigger('change.select2');
            }
        });
    }

    /**
     * Show/Hide functionality for password fields
     */
    function initializePasswordToggles() {
        // Secret Key Toggle
        $(document).on('click', '#toggle-secret-key', function(e) {
            e.preventDefault();
            var $input = $('#stripe_secret_key');
            var $icon = $(this).find('.dashicons');
            
            if ($input.attr('type') === 'password') {
                $input.attr('type', 'text');
                $icon.removeClass('dashicons-visibility').addClass('dashicons-hidden');
                $(this).attr('title', __('Hide secret key', 'ytism'));
            } else {
                $input.attr('type', 'password');
                $icon.removeClass('dashicons-hidden').addClass('dashicons-visibility');
                $(this).attr('title', __('Show secret key', 'ytism'));
            }
        });
        
        // Webhook Secret Toggle
        $(document).on('click', '#toggle-webhook-secret', function(e) {
            e.preventDefault();
            var $input = $('#stripe_webhook_secret');
            var $icon = $(this).find('.dashicons');
            
            if ($input.attr('type') === 'password') {
                $input.attr('type', 'text');
                $icon.removeClass('dashicons-visibility').addClass('dashicons-hidden');
                $(this).attr('title', __('Hide webhook secret', 'ytism'));
            } else {
                $input.attr('type', 'password');
                $icon.removeClass('dashicons-hidden').addClass('dashicons-visibility');
                $(this).attr('title', __('Show webhook secret', 'ytism'));
            }
        });
    }

    /**
     * API Testing functionality
     */
    function initializeApiTesting() {
        $(document).on('click', '#ytism-test-stripe-api', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $button = $(this);
            var $result = $('#ytism-api-test-result');
            
            // Check if YTISM_ADMIN is available
            if (typeof YTISM_ADMIN === 'undefined') {
                $result.removeClass('success').addClass('error');
                $result.html(__('Configuration error: YTISM_ADMIN not found.', 'ytism')).show();
                return false;
            }
            
            $button.prop('disabled', true).text(__('Testing...', 'ytism'));
            $result.hide();
            
            $.ajax({
                url: YTISM_ADMIN.ajax_url,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'ytism_test_stripe_api',
                    nonce: YTISM_ADMIN.test_api_nonce,
                    publishable_key: $('input[name="' + YTISM_ADMIN.option_name + '[stripe_publishable_key]"]').val(),
                    secret_key: $('input[name="' + YTISM_ADMIN.option_name + '[stripe_secret_key]"]').val(),
                    webhook_secret: $('input[name="' + YTISM_ADMIN.option_name + '[stripe_webhook_secret]"]').val(),
                    mode: $('select[name="' + YTISM_ADMIN.option_name + '[stripe_mode]"]').val()
                },
                success: function(response) {
                    if (response && typeof response.success !== 'undefined') {
                        $result.removeClass('success error').addClass(response.success ? 'success' : 'error');
                        $result.html(response.data.message).show();
                    } else {
                        $result.removeClass('success').addClass('error');
                        $result.html(__('Invalid response from server.', 'ytism')).show();
                    }
                },
                error: function(xhr, status, error) {
                    $result.removeClass('success').addClass('error');
                    $result.html(__('An error occurred while testing the API.', 'ytism')).show();
                    
                    // Enhanced error logging
                    if (window.console && console.log) {
                        console.group('YTISM API Test Error');
                        console.log('Status:', status);
                        console.log('Error:', error);
                        console.log('Response:', xhr.responseText);
                        console.groupEnd();
                    }
                },
                complete: function() {
                    $button.prop('disabled', false).text(__('Test Stripe API Connection', 'ytism'));
                }
            });
            
            return false;
        });
    }

    /**
     * Orders page functionality
     */
    function initializeOrdersPage() {
        // Select all checkboxes functionality
        $(document).on('change', '#cb-select-all-1', function() {
            var isChecked = $(this).prop('checked');
            $('input[name="order_ids[]"]').prop('checked', isChecked);
        });
        
        // Individual checkbox change
        $(document).on('change', 'input[name="order_ids[]"]', function() {
            var totalCheckboxes = $('input[name="order_ids[]"]').length;
            var checkedCheckboxes = $('input[name="order_ids[]"]:checked').length;
            
            if (checkedCheckboxes === totalCheckboxes) {
                $('#cb-select-all-1').prop('checked', true).prop('indeterminate', false);
            } else if (checkedCheckboxes === 0) {
                $('#cb-select-all-1').prop('checked', false).prop('indeterminate', false);
            } else {
                $('#cb-select-all-1').prop('checked', false).prop('indeterminate', true);
            }
        });
        
        // Bulk actions confirmation
        $(document).on('submit', 'form', function(e) {
            var action = $('select[name="action"], select[name="action2"]').val();
            var checkedItems = $('input[name="order_ids[]"]:checked').length;
            
            if (action === 'bulk_delete' && checkedItems > 0) {
                if (!confirm(__('Are you sure you want to delete the selected orders? This action cannot be undone.', 'ytism'))) {
                    e.preventDefault();
                    return false;
                }
            }
        });

        // Metadata toggle functionality
        $(document).on('click', '.toggle-metadata', function(e) {
            e.preventDefault();
            var orderId = $(this).data('order-id');
            var $metadataContent = $('#metadata-' + orderId);
            var $button = $(this);
            
            if ($metadataContent.is(':visible')) {
                $metadataContent.slideUp(200);
                $button.text(__('View Metadata', 'ytism'));
            } else {
                // Hide all other open metadata first
                $('.ytism-metadata-content:visible').slideUp(200);
                $('.toggle-metadata').text(__('View Metadata', 'ytism'));
                
                // Show this metadata
                $metadataContent.slideDown(200);
                $button.text(__('Hide Metadata', 'ytism'));
            }
        });

        // Row actions for order details
        $(document).on('click', '.view-order-details', function(e) {
            e.preventDefault();
            var orderId = $(this).data('order-id');
            
            // You can implement a modal or expand functionality here
            console.log('View details for order:', orderId);
            
            // For now, just toggle metadata if available
            var $metadataButton = $(this).closest('tr').find('.toggle-metadata');
            if ($metadataButton.length) {
                $metadataButton.trigger('click');
            }
        });
    }

    /**
     * Copy webhook URL functionality
     */
    function initializeWebhookHelpers() {
        // Add copy button for webhook URL if it exists and hasn't been added yet
        var $webhookCode = $('.webhook-instructions code');
        if ($webhookCode.length && !$webhookCode.find('.copy-webhook-btn').length) {
            $webhookCode.css('position', 'relative').append(
                '<button type="button" class="button button-small copy-webhook-btn" style="margin-left: 10px; padding: 2px 8px; font-size: 11px;">' + 
                __('Copy', 'ytism') + '</button>'
            );
            
            $(document).on('click', '.copy-webhook-btn', function(e) {
                e.preventDefault();
                var webhookUrl = $(this).parent().clone().children().remove().end().text().trim();
                
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(webhookUrl).then(function() {
                        var $btn = $(e.target);
                        var originalText = $btn.text();
                        $btn.text(__('Copied!', 'ytism'));
                        setTimeout(function() {
                            $btn.text(originalText);
                        }, 2000);
                    });
                } else {
                    // Fallback for older browsers
                    var textArea = document.createElement('textarea');
                    textArea.value = webhookUrl;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    var $btn = $(e.target);
                    var originalText = $btn.text();
                    $btn.text(__('Copied!', 'ytism'));
                    setTimeout(function() {
                        $btn.text(originalText);
                    }, 2000);
                }
            });
        }
    }

    /**
     * Initialize all functionality
     */
    function init() {
        // Only initialize if we haven't already
        if (window.ytismInitialized) {
            return;
        }
        
        // Initialize Select2 and unique validation
        initializeSelect2();
        
        // Listen for changes to update unique options (debounced)
        $(document).on('change', '.ytism-page-select, .ytism-product-select, select[name*="myaccount_page_id"], select[name*="checkout_page_id"], select[name*="ordersummary_page_id"], select[name*="thankyou_page_id"], select[name*="terms_page_id"], select[name*="privacy_page_id"]', function() {
            updateUniqueOptions();
        });
        
        // Initialize password toggles
        initializePasswordToggles();
        
        // Initialize API testing
        initializeApiTesting();
        
        // Initialize orders page functionality
        initializeOrdersPage();
        
        // Initialize webhook helpers
        initializeWebhookHelpers();
        
        // Mark as initialized
        window.ytismInitialized = true;
    }

    // Initialize when DOM is ready
    $(document).ready(function() {
        init();
    });

    // Remove problematic DOMNodeInserted (deprecated and causes performance issues)
    // Use MutationObserver for modern browsers if needed
    if (window.MutationObserver) {
        var observer = new MutationObserver(function(mutations) {
            var shouldReinit = false;
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    $(mutation.addedNodes).each(function() {
                        if ($(this).hasClass && ($(this).hasClass('ytism-page-select') || $(this).hasClass('ytism-product-select'))) {
                            shouldReinit = true;
                        }
                    });
                }
            });
            
            if (shouldReinit) {
                setTimeout(function() {
                    initializeSelect2();
                }, 200);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
});