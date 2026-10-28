# API endpoint changes: audience restructure

All paths below are relative to the API prefix (`API_PREFIX`, default `/api/v1`).
Example: `/app/cart` is served at `/api/v1/app/cart`.

## Summary

| | Count |
| --- | --- |
| Routes before | 347 |
| Routes after | 394 |
| Unchanged URL (every `/admin/*`, every `/auth/*`, `/store/*` except `/store/resolve`) | 262 |
| Moved to a new URL | 85 (92 rows below: the 7 media-library routes now exist for both admin and store) |
| New | 40 (32 SDUI designer routes, 7 customer screen routes, `/public/health`) |
| Removed | 0 |

Every URL now starts with its audience, set once by `RouterModule` in `app.module.ts`:

| Prefix | Who calls it | Auth |
| --- | --- | --- |
| `/admin` | Admin panel | `ADMIN`, `SUPER_ADMIN` + permission per endpoint |
| `/store` | Store manager / staff app | `STORE_MANAGER` (+ `STORE_STAFF` where allowed), always their own store |
| `/partner` | Delivery partner app | `DELIVERY_PARTNER` |
| `/app` | Customer app | Guests allowed (cart, screens, store lookup); `CUSTOMER` for orders, addresses, wishlist, returns |
| `/account` | Any signed-in user | Bearer token; a few endpoints narrow the roles (KYC, work history) |
| `/auth` | Login, OTP, refresh, logout | Unchanged URLs |
| `/public` | Health, payment webhooks, app config, open catalogue | No token |

## What did not change

These were checked for every moved route, comparing the old build with the new one:

- HTTP method, path parameters, query / body DTO classes and their validation, pipes (`ParseBigIntPipe`, …) and status codes (`@HttpCode`).
- Roles, permissions, `@Public`, account-hold capabilities (`@Capability`), throttling, interceptors (file uploads).
- The Swagger operation (summary, description, parameters, request body, responses). Only the tags changed (`Admin · Brands`, `Store · Inventory`, …), and every protected controller now documents 401 / 403.
- Live HTTP behaviour without a token and with an invalid token: every route returned the same status and error `code` at its old and new URL (708 requests).
- Route precedence: no `:id` route shadows a literal route.

## Things client apps must do

1. **Customer app:** switch `/customer/*`, `/catalog/*`, `/config`, `/store/resolve`, `/me/wishlist*` and `/support/tickets*` to the new paths below.
2. **All apps:** `/me/*` → `/account/*`, `/notifications*` → `/account/notifications*`, uploads `/media*` → `/account/media*`.
3. **Delivery partner app:** `/delivery/*` → `/partner/*`. The job list is now `/partner/deliveries` (it was `/delivery/orders`); availability is `PATCH /partner/availability`.
4. **Admin panel / store app:** app config moved to `/admin/config` and `/store/config`. The media library moved to `/admin/media` (admins) and `/store/media` (store managers).
5. **Payment gateway dashboards:** update the webhook URL to `/public/webhooks/payments/:gateway`. Until you do, payments will not be confirmed.
6. **Response links:** server-built media links (`accessUrl`, `file`, `frontFile`, upload `url`, `completeUrl`, `statusUrl`, `?variant=` URLs) now point to `/account/media/...`. Apps that follow these links need no change. Apps that build the old path themselves must update it.

## Behaviour changes (intentional)

- **Media library split by audience.** `GET/PATCH/DELETE /media…` used to accept `ADMIN`, `SUPER_ADMIN` and `STORE_MANAGER` on one URL. It is now two URLs on the same service with the same permissions (`media.read`, `media.upload`): `/admin/media…` accepts `ADMIN` and `SUPER_ADMIN`; `/store/media…` accepts `STORE_MANAGER`.
- **SDUI is live.** The admin designer (`/admin/sdui/*`) and the customer screens (`/app/shell`, `/app/screens/:key`, `/app/landing/...`, `/app/preview/...`) were in the codebase but not wired into `AppModule`. They are wired now.
- **`GET /public/health`** is a new liveness probe that returns `{ status, time }` and touches neither the database nor Redis.

## Old → new paths

### Customer app: `/app` and `/public`

| Method | Old path | New path | Who (roles · permission) at the new URL |
| --- | --- | --- | --- |
| POST | `/customer/cart/guest-token` | `/app/cart/guest-token` | guest |
| GET | `/customer/cart` | `/app/cart` | guest |
| POST | `/customer/cart/items` | `/app/cart/items` | guest |
| PATCH | `/customer/cart/items/:id` | `/app/cart/items/:id` | guest |
| DELETE | `/customer/cart/items/:id` | `/app/cart/items/:id` | guest |
| DELETE | `/customer/cart` | `/app/cart` | guest |
| POST | `/customer/cart/coupon` | `/app/cart/coupon` | guest |
| DELETE | `/customer/cart/coupon` | `/app/cart/coupon` | guest |
| POST | `/customer/orders` | `/app/orders` | CUSTOMER |
| GET | `/customer/orders` | `/app/orders` | CUSTOMER |
| GET | `/customer/orders/:id` | `/app/orders/:id` | CUSTOMER |
| GET | `/customer/orders/:id/track` | `/app/orders/:id/track` | CUSTOMER |
| POST | `/customer/orders/:id/cancel` | `/app/orders/:id/cancel` | CUSTOMER |
| POST | `/customer/orders/:id/rate` | `/app/orders/:id/rate` | CUSTOMER |
| GET | `/store/resolve` | `/app/stores/resolve` | guest |
| GET | `/config` | `/public/config` | guest |
| GET | `/me/wishlist` | `/app/wishlist` | CUSTOMER |
| GET | `/me/wishlist/check` | `/app/wishlist/check` | CUSTOMER |
| PUT | `/me/wishlist/:productId` | `/app/wishlist/:productId` | CUSTOMER |
| DELETE | `/me/wishlist/:productId` | `/app/wishlist/:productId` | CUSTOMER |
| GET | `/customer/addresses/format` | `/app/addresses/format` | CUSTOMER |
| GET | `/customer/addresses` | `/app/addresses` | CUSTOMER |
| POST | `/customer/addresses` | `/app/addresses` | CUSTOMER |
| PUT | `/customer/addresses/:id` | `/app/addresses/:id` | CUSTOMER |
| DELETE | `/customer/addresses/:id` | `/app/addresses/:id` | CUSTOMER |
| POST | `/customer/orders/:id/returns` | `/app/orders/:id/returns` | CUSTOMER |
| GET | `/customer/returns` | `/app/returns` | CUSTOMER |
| GET | `/catalog/categories` | `/public/catalog/categories` | guest |
| GET | `/catalog/brands` | `/public/catalog/brands` | guest |
| GET | `/catalog/products` | `/public/catalog/products` | guest |
| GET | `/catalog/products/:slug` | `/public/catalog/products/:slug` | guest |
| GET | `/catalog/bundles` | `/public/catalog/bundles` | guest |
| POST | `/support/tickets` | `/app/support/tickets` | any signed-in |
| GET | `/support/tickets` | `/app/support/tickets` | any signed-in |
| GET | `/support/tickets/:id` | `/app/support/tickets/:id` | any signed-in |
| POST | `/support/tickets/:id/messages` | `/app/support/tickets/:id/messages` | any signed-in |

### Every app: the signed-in user's own account (`/account`)

| Method | Old path | New path | Who (roles · permission) at the new URL |
| --- | --- | --- | --- |
| GET | `/notifications` | `/account/notifications` | any signed-in |
| GET | `/notifications/unread-count` | `/account/notifications/unread-count` | any signed-in |
| POST | `/notifications/read-all` | `/account/notifications/read-all` | any signed-in |
| POST | `/notifications/:id/read` | `/account/notifications/:id/read` | any signed-in |
| GET | `/me/kyc` | `/account/kyc` | STORE_STAFF, DELIVERY_PARTNER |
| POST | `/me/kyc` | `/account/kyc` | STORE_STAFF, DELIVERY_PARTNER |
| POST | `/me/kyc/submit` | `/account/kyc/submit` | STORE_STAFF, DELIVERY_PARTNER |
| DELETE | `/me/kyc/:id` | `/account/kyc/:id` | STORE_STAFF, DELIVERY_PARTNER |
| POST | `/me/kyc/:id/removal-request` | `/account/kyc/:id/removal-request` | STORE_STAFF, DELIVERY_PARTNER |
| GET | `/me/profile` | `/account/profile` | any signed-in |
| PATCH | `/me/profile` | `/account/profile` | any signed-in |
| PUT | `/me/avatar` | `/account/avatar` | any signed-in |
| DELETE | `/me/avatar` | `/account/avatar` | any signed-in |
| GET | `/me/work-history` | `/account/work-history` | STORE_STAFF, STORE_MANAGER, DELIVERY_PARTNER |
| GET | `/me/wallet` | `/account/wallet` | any signed-in |
| POST | `/me/phone/request-otp` | `/account/phone/request-otp` | any signed-in |
| POST | `/me/phone/verify` | `/account/phone/verify` | any signed-in |
| GET | `/me/approvals` | `/account/approvals` | any signed-in |
| GET | `/me/approvals/:id` | `/account/approvals/:id` | any signed-in |
| POST | `/me/approvals/:id/cancel` | `/account/approvals/:id/cancel` | any signed-in |
| POST | `/media/uploads` | `/account/media/uploads` | any signed-in |
| PUT | `/media/uploads/:id/content` | `/account/media/uploads/:id/content` | any signed-in |
| POST | `/media/uploads/:id/complete` | `/account/media/uploads/:id/complete` | any signed-in |
| POST | `/media` | `/account/media` | any signed-in |
| GET | `/media/purposes` | `/account/media/purposes` | CUSTOMER, ADMIN, SUPER_ADMIN, STORE_MANAGER, STORE_STAFF, DELIVERY_PARTNER |
| GET | `/media/:id/status` | `/account/media/:id/status` | any signed-in |
| POST | `/media/:id/retry` | `/account/media/:id/retry` | any signed-in |
| GET | `/media/:id/file` | `/account/media/:id/file` | any signed-in |

### Delivery partner app: `/partner`

| Method | Old path | New path | Who (roles · permission) at the new URL |
| --- | --- | --- | --- |
| GET | `/delivery/kyc` | `/partner/kyc` | DELIVERY_PARTNER |
| POST | `/delivery/kyc` | `/partner/kyc` | DELIVERY_PARTNER |
| PATCH | `/delivery/me/availability` | `/partner/availability` | DELIVERY_PARTNER |
| POST | `/delivery/location` | `/partner/location` | DELIVERY_PARTNER |
| GET | `/delivery/orders` | `/partner/deliveries` | DELIVERY_PARTNER |
| GET | `/delivery/orders/history` | `/partner/deliveries/history` | DELIVERY_PARTNER |
| POST | `/delivery/orders/:id/accept` | `/partner/deliveries/:id/accept` | DELIVERY_PARTNER |
| POST | `/delivery/orders/:id/reject` | `/partner/deliveries/:id/reject` | DELIVERY_PARTNER |
| PATCH | `/delivery/orders/:id/status` | `/partner/deliveries/:id/status` | DELIVERY_PARTNER |
| POST | `/delivery/orders/:id/complete` | `/partner/deliveries/:id/complete` | DELIVERY_PARTNER |
| GET | `/config/delivery` | `/partner/config` | DELIVERY_PARTNER |

### Admin panel and store app

| Method | Old path | New path | Who (roles · permission) at the new URL |
| --- | --- | --- | --- |
| GET | `/config/admin` | `/admin/config` | ADMIN, SUPER_ADMIN |
| GET | `/config/store` | `/store/config` | STORE_MANAGER, STORE_STAFF |
| GET | `/media/summary` | `/admin/media/summary` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.read` |
| GET | `/media/summary` | `/store/media/summary` | STORE_MANAGER (was + admins) · `media.read` |
| GET | `/media` | `/admin/media` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.read` |
| GET | `/media` | `/store/media` | STORE_MANAGER (was + admins) · `media.read` |
| GET | `/media/:id/usage` | `/admin/media/:id/usage` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.read` |
| GET | `/media/:id/usage` | `/store/media/:id/usage` | STORE_MANAGER (was + admins) · `media.read` |
| GET | `/media/:id` | `/admin/media/:id` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.read` |
| GET | `/media/:id` | `/store/media/:id` | STORE_MANAGER (was + admins) · `media.read` |
| PATCH | `/media/:id` | `/admin/media/:id` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.upload` |
| PATCH | `/media/:id` | `/store/media/:id` | STORE_MANAGER (was + admins) · `media.upload` |
| PUT | `/media/:id/file` | `/admin/media/:id/file` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.upload` |
| PUT | `/media/:id/file` | `/store/media/:id/file` | STORE_MANAGER (was + admins) · `media.upload` |
| DELETE | `/media/:id` | `/admin/media/:id` | ADMIN, SUPER_ADMIN (was + STORE_MANAGER) · `media.upload` |
| DELETE | `/media/:id` | `/store/media/:id` | STORE_MANAGER (was + admins) · `media.upload` |

### Payment gateways

| Method | Old path | New path | Who (roles · permission) at the new URL |
| --- | --- | --- | --- |
| POST | `/payments/webhook/:gateway` | `/public/webhooks/payments/:gateway` | guest |

## New endpoints

| Method | Path | Who |
| --- | --- | --- |
| GET | `/public/health` | guest |
| GET | `/app/shell`, `/app/screens/:key`, `/app/screens/:key/sections/:sectionId` | guest |
| GET | `/app/landing/:type/:ref`, `/app/landing/:type/:ref/items` | guest |
| GET | `/app/preview/:token`, `/app/preview/:token/sections/:sectionId` | guest (preview token) |
| * | `/admin/sdui/screens…`, `/admin/sdui/sections…`, `/admin/sdui/groups…`, `/admin/sdui/components`, `/admin/sdui/data-preview` (32 routes) | ADMIN, SUPER_ADMIN · `sdui.read` / `sdui.manage` / `sdui.publish` |
