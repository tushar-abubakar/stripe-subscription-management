# Quick-Commerce Backend (Lean MVP)

NestJS + Prisma + Redis monolith implementing the **critical path** of the master
spec (spec §95 MVP list): OTP auth (customer/manager/delivery), password+OTP admin
auth, admin-creates-admin, account suspension/session revocation, multi-manager
stores + serviceability, catalog (category/brand/product/variant), store-specific
pricing, multi-batch inventory with FEFO/FIFO + immutable ledger, persistent
Redis-backed cart with login sync, checkout with server-side stock/price
revalidation, webhook-verified idempotent payments, refunds, manager
pick/pack, manual + auto (nearest-driver) delivery assignment, Redis live
tracking, delivery OTP, and an audit interceptor.

## Why not all 96 sections?
The full spec is ~100 DB models and 80+ modules — a multi-week build, not
something that fits (or should fit) in one response even written as tightly as
possible. This delivers a real, runnable skeleton for the MVP path with the
same domain boundaries (CATALOG / ASSORTMENT+PRICING / INVENTORY / COMMERCE /
AUDIT+FINANCE, spec §98) so every remaining module (promotions, coupons,
bundles, search, recommendations, reviews, wishlist, support, analytics,
reports, SDUI, feature flags) is a straightforward addition in the same
pattern — same PrismaService/RedisService, same JwtAuthGuard + @Roles guard,
same "mutation → also writes ledger/audit row" discipline.

## Run it
```bash
cp .env.example .env        # fill in real DB/Redis/JWT secrets
docker compose up -d db redis db-test redis-test
npm install
npx prisma migrate reset && npx prisma migrate dev --name init && npx prisma generate && npm run seed
npm run start:dev
```
Swagger UI: `http://localhost:3000/docs`

Note: `npx prisma generate/migrate` needs network access to
`binaries.prisma.sh` to fetch its engine binaries — this sandbox couldn't
reach that domain, so the schema/code were verified by TypeScript syntax
parsing rather than a live `prisma generate` + `tsc` build. Run the commands
above once outside this sandbox to generate the client and confirm.

## What's included now (round 2 additions)
- **search** — Postgres ILIKE search + autocomplete + Redis-backed "popular searches"
- **promotions** — coupon validate/redeem, hooked into `orders.checkout()` atomically (usage limits can't be oversold by concurrent checkouts)
- **recommendations** — "customers also bought" via order co-occurrence, category fallback, store-level trending
- **reviews** — verified-purchase-only (must have a `DELIVERED` order containing the product)
- **support** — tickets + threaded messages, customer/admin access control
- **analytics** — sales summary, orders-by-status, top products, low-stock, delivery performance (all via Prisma `aggregate`/`groupBy`, no separate pipeline)
- **i18n** — `x-lang` middleware + `en`/`hi` JSON dictionaries, `I18nService.t(key, locale)`
- **tests** — Jest unit tests for the trickiest logic (FEFO/FIFO allocation order, coupon discount math, OTP verification), 1 e2e smoke test, all passing (`npm test`)

## What's NOT included
Wishlist, bundles, full SDUI/feature-flags/app-config, fraud/risk scoring, WebSocket
push for live tracking (delivery location is currently pull-based via `GET
/delivery/orders/:orderId/track`), and full ICU pluralization for i18n (current i18n
is flat key→string, fine for status messages but not for count-dependent phrases).

## Applying this to an existing local copy (without re-downloading)
If you already patched the earlier zip locally (Prisma schema fix, `PrismaModule`,
`GlobalJwtModule`), add these on top:

1. **New folders** — copy `src/search`, `src/promotions`, `src/recommendations`,
   `src/reviews`, `src/support`, `src/analytics`, `src/i18n` in full.
2. **Schema** — append the new enums (`CouponType`, `TicketStatus`, `TicketCategory`)
   and models (`Coupon`, `CouponRedemption`, `Review`, `SupportTicket`,
   `SupportMessage`, `SearchLog`) from this `prisma/schema.prisma` to yours, then run
   `npx prisma migrate dev --name add_promotions_reviews_support_search`.
3. **`src/app.module.ts`** — import the 6 new modules + `I18nModule`/`I18nMiddleware`
   and add them to `imports`; add `I18nMiddleware` to the `consumer.apply(...)` call
   in `configure()`.
4. **`src/orders/orders.service.ts`, `orders.controller.ts`, `orders.module.ts`** —
   replace with the versions here: `checkout()` now takes an optional `couponCode`,
   validates+redeems it inside the same transaction as stock reservation, and
   `OrdersModule` now imports `PromotionsModule`.
5. **`nest-cli.json`** — add the `compilerOptions.assets` block so the i18n locale
   JSON files get copied into `dist/` on build (TS doesn't do this automatically).
6. **`package.json`** — add the `jest`/`ts-jest`/`supertest`/`@nestjs/testing` devDependencies
   and the `test`/`test:watch`/`test:e2e` scripts, then `npm install`.
7. **`jest.config.js`**, **`test/health.e2e-spec.ts`** — copy as-is.

Run `npm test` to confirm — 10 unit + 1 e2e test should pass without needing a live DB/Redis.
