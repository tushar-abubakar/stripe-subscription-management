<?php

namespace YTISM\Database;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Factory {
    private static $subscription;
    private static $payment;
    private static $event;
    
    public static function subscription() {
        if (null === self::$subscription) {
            self::$subscription = new Subscription();
        }
        return self::$subscription;
    }
    
    public static function payment() {
        if (null === self::$payment) {
            self::$payment = new Payment();
        }
        return self::$payment;
    }
    
    public static function event() {
        if (null === self::$event) {
            self::$event = new Event();
        }
        return self::$event;
    }
}


/*
=== USAGE WITH NAMESPACE ===

use YTISM\Database\Factory;
use YTISM\Database\Subscription;
use YTISM\Database\Payment;
use YTISM\CoDatabasere\Event;

Factory::subscription()->create_subscription($data);
Factory::payment()->update_status($id, 'succeeded');
Factory::event()->get_subscription_timeline($subscription_id);

Direct Class Usage:
$subscription = new Subscription();
$subscription->create_subscription($data);

Global Function Helpers:
function ytism_subscription() {
    return \YTISM\Database\Factory::subscription();
}

function ytism_payment() {
    return \YTISM\Database\Factory::payment();
}

function ytism_event() {
    return \YTISM\Database\Factory::event();
}

// Usage:
ytism_subscription()->create_subscription($data);
ytism_payment()->update_status($id, 'succeeded');

USAGE EXAMPLES:

// Create subscription with automatic logging
$subscription_id = Factory::subscription()->create_subscription([
    'user_id' => 123,
    'payment_gateway' => 'stripe',
    'amount' => 29.99,
    'currency' => 'USD'
]);

// Process payment
$payment_id = Factory::payment()->create_payment([
    'subscription_id' => $subscription_id,
    'amount' => 29.99,
    'currency' => 'USD'
]);

Factory::payment()->update_status($payment_id, 'succeeded', [
    'transaction_id' => 'txn_123456'
]);

// Get complete timeline
$timeline = Factory::event()->get_subscription_timeline($subscription_id);

// Get user subscriptions
$user_subscriptions = Factory::subscription()->get_by_user(123, 'active');

// Get failed payments for retry
$failed_payments = Factory::payment()->get_failed_for_retry();

*/