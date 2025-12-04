# 🎧 Stripe – Subscription Management Platform

It includes automated subscription lifecycle management, admin settings, plan management, and frontend display with WP-ML translation support.

---

## 🚀 Key Features

- **Subscription-Based Streaming**
  - Premium plan access with entitlement-based content
  - Free tier with upgrade prompts
- **Stripe Billing & Automation**
  - Trials, renewals, cancellations & dunning workflow
  - Real-time subscription sync using webhook events
- **Automation & WebOps**
  - Cron jobs for entitlement refresh
  - Automated sync of subscription state and plan changes
- **Admin Dashboard**
  - View users, subscription logs, and revenue analytics

---

## 📦 Installation & Setup

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/tushar-abubakar/stripe-subscription-management.git
cd stripe-subscription-management
````

### 2️⃣ Install PHP Dependencies (Composer Required)

```bash
composer install
```

> This installs external libraries such as Stripe SDK.
> Without this step, subscription, payment & authentication features will not work.

### 3️⃣ Deploy Plugin into WordPress

Move plugin root folder to:

```
/wp-content/plugins/
```

Then activate:
WordPress Admin → Plugins → **Activate**