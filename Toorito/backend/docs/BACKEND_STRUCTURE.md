# Backend File Structure Guide

Oct 24, 2026 · @Tushar

Business logic lives in `src/modules`, HTTP lives in `src/api/<audience>`, and shared plumbing lives in `core`, `common` and `integrations`. Imports only point one way: api → modules → core / common / integrations.

## The layers

A request enters a controller in `api/`, which calls one service in `modules/`; the service uses `core/`, `common/` and `integrations/` and returns plain data back up.

## Folder tree

One folder per job. A feature appears once in `modules/` and once per audience that calls it in `api/`.

```
src/
├── main.ts                     # bootstrap: pipes, filters, Swagger, BigInt JSON
├── app.module.ts               # wires everything + RouterModule prefixes
├── config/                     # configuration.ts, config.type.ts (env → typed config)
├── i18n/<lang>/<feature>.json  # translated messages and labels
├── generated/prisma/           # Prisma client (generated, git-ignored)
│
├── core/                       # app-wide infrastructure, one instance each
│   ├── database/  redis/  locale/  currency/  audit/  auth/  http/  address/
│
├── common/                     # small shared building blocks, no state
│   ├── authorization/  decorators/  dto/  swagger/  types/  utils/  validators/  events/
│
├── integrations/               # adapters to outside services
│   ├── storage/  sms/  payments/  maps/
│
├── modules/                    # business logic (domains). No controllers.
│   ├── auth/  users/  stores/  catalog/  inventory/  orders/  cart/  payments/
│   ├── delivery/  kyc/  approvals/  media/  notifications/  support/  sdui/ …
│
└── api/                        # HTTP only, grouped by who calls it
    ├── http-cache.util.ts      # shared HTTP helpers (ETag, Cache-Control)
    ├── admin/                  # /admin/*   admin panel (ADMIN, SUPER_ADMIN)
    ├── store/                  # /store/*   store manager / staff app
    ├── partner/                # /partner/* delivery partner app
    ├── app/                    # /app/*     customer app (guests allowed)
    ├── account/                # /account/* signed-in user, any role (profile, sessions)
    ├── auth/                   # /auth/*    login, OTP, refresh
    └── public/                 # /public/*  health, webhooks, app config, open catalogue
```

## What goes where

If you're unsure, ask: "would a CLI or a cron job need this too?" Yes → `modules/`. Only an HTTP request needs it → `api/`.

| Folder | Holds | Never holds |
| --- | --- | --- |
| `api/<audience>/` | Controllers, request DTOs (class-validator), Swagger docs, per-audience guards / decorators, mapping a request into a service call | Prisma queries, business rules, Redis, other services' internals |
| `modules/<feature>/` | Services (rules, transactions, queries), service input types, crons, event listeners, the feature's Nest module | Controllers, `@Body` / `@Query` DTOs, HTTP status logic, Swagger decorators |
| `core/` | One-per-app infrastructure: `PrismaService`, `RedisService`, `LocaleService`, `CurrencyService`, `AuditService`, the auth guard | Feature logic (orders, stock, SDUI) |
| `common/` | Stateless helpers: permissions, decorators, base DTOs (`PageQueryDto`), validators, Swagger helpers, utils | Anything injectable that holds state or talks to the DB |
| `integrations/` | Adapters to outside services (storage, SMS, payment gateways, maps) behind an interface | Business decisions (when to refund, whom to text) |
| `config/` | Env parsing and the typed config shape | Defaults scattered elsewhere |
| `i18n/<lang>/` | One JSON per feature (`sdui.json`, `auth.json`) | Hard-coded user-facing English in code |
| `generated/` | Prisma output only | Hand edits (they're overwritten by `prisma generate`) |

## A domain module

A module owns one business area and its tables. Split a service when it passes about 600 lines or does two jobs; name the parts after the job, not "helper".

```
modules/inventory/
├── inventory.module.ts        # providers + exports (only what other modules / api use)
├── inventory.types.ts         # plain input / output types of the services (no decorators)
├── listing.service.ts         # one job per service
├── stock.service.ts
├── receipt.service.ts
├── flash-sale.service.ts
├── catalog-browse.service.ts
├── inventory-report.service.ts
├── inventory.approvals.ts     # handlers this module registers with approvals
├── inventory.cron.ts          # @Cron jobs (thin: call a service method)
└── inventory.util.ts          # pure functions shared by the services (optional)
```

Rules:

- Services take plain inputs (`bigint` ids, `Date`, typed objects from `*.types.ts`) and the acting user (`AuthUser`), never `Request` or DTO classes.
- Services throw Nest exceptions with a stable `code` and an i18n `message` (`{ message, code }`); the API layer never rewrites them.
- Export only what's used outside. Other modules import the **module** and inject its exported service; they never query another module's tables.
- A sub-area big enough for its own folder gets one: `modules/sdui/schema/`, `modules/sdui/render/`, `modules/catalog/product/`.
- Cron jobs and event listeners live in the module that owns the data, guarded by a Redis lock when several instances run.

## An API feature folder

Each audience folder has one Nest module and one decorator that sets roles, the Swagger tag and auth for every controller in it. A feature folder inside it holds only HTTP.

```
api/admin/
├── admin-api.module.ts            # imports the domain modules, lists the controllers
├── admin-controller.decorator.ts  # @AdminController(path, tag): roles + Swagger tag + 401/403
└── sdui/
    ├── screens.controller.ts      # one controller per resource
    ├── sections.controller.ts
    ├── groups.controller.ts
    ├── registry.controller.ts
    ├── sdui.dto.ts                # request DTOs: class-validator + @ApiProperty
    ├── sdui.swagger.ts            # ApiXxx() decorators with sample requests / responses
    └── preview-context.ts         # small request → service-input mapper (optional)
```

Rules:

- A controller method is 1–5 lines: read params, map the DTO to the service input, call one service method, return its result.
- Permissions sit on the method (`@Permissions(P.SDUI_PUBLISH)`), with the read permission on the class; method-level overrides class-level.
- Swagger lives in `<feature>.swagger.ts` as named decorators (`ApiScreenList()`), so controllers stay readable.
- The same feature for two audiences = two folders (`api/admin/orders/`, `api/app/orders/`) calling the same service with different DTOs and checks. Never one controller serving two audiences.
- Response caching headers (ETag, Cache-Control) are set here, with `api/http-cache.util.ts`; the service only returns the data, ETag and TTL.

## Naming and import rules

Files are kebab-case with a role suffix; the class name repeats the role.

| File | Class / export | Example |
| --- | --- | --- |
| `<name>.service.ts` | `XxxService` | `stock.service.ts` → `StockService` |
| `<name>.controller.ts` | `<Audience><Feature>Controller` | `AdminSduiScreensController`, `AppScreensController` |
| `<feature>.module.ts` | `XxxModule` | `InventoryModule`; audience: `AdminApiModule` |
| `<feature>.dto.ts` | `XxxDto`, `XxxQuery` | `CreateGroupDto`, `ScreenListQuery` |
| `<feature>.swagger.ts` | `ApiXxx()` | `ApiPublish()` |
| `<feature>.types.ts` | `XxxInput` | `CreateScreenInput` |
| `<name>.util.ts` | functions | `time-window.ts` may drop the suffix when the name is clear |
| `<feature>.cron.ts` | `XxxCron` | `InventoryCron` |

Path aliases (`tsconfig.json` → `compilerOptions.paths`):

| Alias | Points to | Who may import it |
| --- | --- | --- |
| `@api/*` | `src/api/*` | `app.module.ts` only |
| `@modules/*` | `src/modules/*` | `api/`, other modules (via their module's exports) |
| `@core/*` | `src/core/*` | everyone |
| `@common/*` | `src/common/*` | everyone |
| `@prisma-client/*` | `src/generated/prisma/*` | `modules/`, `core/`; `api/` only for enums in DTOs |

Import direction: `api → modules → core / common / integrations`. Never `modules → api`, never `core → modules`. Inside a feature use relative imports (`./render/config.service`); across features use the alias.

Routes: the audience prefix comes from `RouterModule` in `app.module.ts` (`{ path: "admin", module: AdminApiModule }`), so controller paths are relative: `@AdminController("sdui/screens", …)` → `/api/v1/admin/sdui/screens`. Paths are kebab-case nouns; actions on a resource are `POST :id/<verb>` (`/publish`, `/make-live`).

## Adding a feature

Example: customer coupons (admin creates them, the app applies them).

1. **Schema.** Add the models / enums to `prisma/schema.prisma`, then `npx prisma migrate dev --name coupons` (this also regenerates `src/generated/prisma`).
2. **Permissions.** Add codes to `common/authorization/permissions.ts` (`COUPON_READ`, `COUPON_WRITE`) and to the right role presets.
3. **Domain module.** Create `modules/coupons/` with `coupons.module.ts`, `coupons.types.ts` and the services (`coupons.service.ts`, `coupon-apply.service.ts`). Export the services the API needs.
4. **Messages.** Add `i18n/en/coupons.json` (and the other languages) for every error and label.
5. **API per audience.** `api/admin/coupons/` (CRUD: controller + `coupons.dto.ts` + `coupons.swagger.ts`) and `api/app/coupons/` (apply / list for the customer). Add each controller to its audience module (`AdminApiModule`, `AppApiModule`) and import `CouponsModule` there.
6. **Wire once.** A new audience only: import its `XxxApiModule` in `app.module.ts` and add it to `RouterModule.register([...])`.
7. **Check.** `npx tsc --noEmit`, start the app, open `/docs` and try every endpoint from Swagger with its sample body.

## Worked example: SDUI

SDUI is one domain module and two audiences: the admin designer and the customer app call the same services.

```
modules/sdui/
├── sdui.module.ts
├── sdui.types.ts
├── sdui.util.ts                 # SduiCache (memory + Redis), SduiErrors, checksum
├── layout-validator.service.ts
├── screens.service.ts           # drafts, publish, versions, rules
├── library.service.ts           # saved sections, custom groups
├── schema/                      # contract, definitions, component.registry, starters
└── render/                      # what the app gets
    ├── render.service.ts
    ├── data-sources.service.ts
    ├── config.service.ts
    ├── time-window.ts
    └── render.types.ts

api/admin/sdui/                  # /admin/sdui/*  designer
├── screens.controller.ts  sections.controller.ts  groups.controller.ts  registry.controller.ts
└── sdui.dto.ts  sdui.swagger.ts  preview-context.ts

api/app/screens/                 # /app/*  customer app
└── screens.controller.ts  screens.dto.ts  screens.swagger.ts
```

| Concern | Lives in | Why there |
| --- | --- | --- |
| "Can this layout be published?" | `modules/sdui/layout-validator.service.ts` | A rule; preview and publish both use it |
| Which version a user sees, A/B buckets | `modules/sdui/render/render.service.ts` | Business logic, same for every caller |
| Redis keys, cache bumps | `modules/sdui/sdui.util.ts` | Tied to the data, not to HTTP |
| ETag, 304, Cache-Control | `api/http-cache.util.ts`, called by controllers | Pure HTTP |
| `?storeId=&platform=` parsing | `api/app/screens/screens.dto.ts` | Request shape |
| `sdui.publish` permission | `api/admin/sdui/screens.controller.ts` | Who may call it is an audience decision |

## Moving the existing code (done)

Every controller now lives in `src/api/<audience>/`; `src/modules` and `src/core` hold no controllers. `docs/API_CHANGES.md` lists every URL that moved.

- [x] `modules/analytics/analytics.controller.ts` → `api/admin/analytics/` + `api/store/analytics/`
- [x] `core/audit/audit.controller.ts` → `api/admin/audit/` (the log queries moved into `AuditService`)
- [x] `modules/approvals/approvals.controller.ts` → `api/admin/approvals/` + `api/store/approvals/` + `api/account/approvals/` + `api/app/returns/`
- [x] `modules/catalog/{brand,category,option,product,bundles}/*.controller.ts` → `api/admin/catalog/` (writes), `api/store/catalog/` (store products, bundles), `api/public/catalog/` (open reads)
- [x] `modules/inventory/inventory.controller.ts` → `api/store/inventory/` + `api/admin/inventory/`, one controller per job (listings, catalog, stock, receipts, flash-sales, reports)
- [x] `modules/kyc/kyc.controller.ts` → `api/admin/kyc/` + `api/store/kyc/` + `api/account/kyc/` (the partner's own KYC was already at `/delivery/kyc` → `api/partner/kyc/`)
- [x] `modules/media/media.controller.ts` → `api/admin/media/` + `api/store/media/` (library) + `api/account/media/` (uploads)
- [x] `modules/stores/stores.controller.ts` → `api/admin/stores/` + `api/store/profile/` + `api/app/stores/`
- [x] `modules/users/users.controller.ts`, `modules/admin/admin.controller.ts` → `api/admin/users/`, `api/admin/access-roles/`, `api/admin/dashboard/`, `api/admin/customers/`, `api/admin/delivery/`, `api/store/team/`, `api/account/profile/`, `api/app/wishlist/`, `api/app/addresses/`
- [x] `modules/orders/orders.controller.ts` (+ coupons) → `api/app/orders/`, `api/store/orders/`, `api/admin/orders/`, `api/admin/coupons/`
- [x] `modules/cart/cart.controller.ts` → `api/app/cart/`
- [x] `modules/payments/payments.controller.ts` → `api/public/webhooks.ts`
- [x] `modules/delivery/delivery.controller.ts` → `api/partner/{deliveries,availability,tracking,kyc}/` + `api/store/deliveries/` + `api/admin/delivery/`
- [x] `modules/support/support.controller.ts`, `support-manage.controller.ts` → `api/app/support/`, `api/store/support/`, `api/admin/support/`
- [x] `modules/auth/auth.controller.ts` → `api/auth/`
- [x] `modules/app-config/app-config.controller.ts` → `api/public/app-config.ts` + `/admin/config`, `/store/config`, `/partner/config` (logic in `AppConfigService`)
- [x] `modules/notifications` controller → `api/account/notifications/`
- [x] SDUI → `api/admin/sdui/` + `api/app/screens/` (wired into `AppModule`)

Decisions made along the way:

- `src/domain/` was merged into `src/modules/` (SDUI) and the `@domain/*` alias was removed.
- `InventoryService` (3,600 lines) was split by job: `listing`, `listing-rules`, `stock`, `receipt`, `flash-sale`, `inventory-report`, `inventory-cache`, `inventory.approvals`, `inventory.cron`.
- Services take `XxxInput` types from `modules/<feature>/<feature>.types.ts`. The DTOs in `api/` `implements` them, so a DTO that drifts from its service input fails `tsc`.
- A DTO / Swagger file shared by two audiences lives with the audience that owns most of its endpoints. The other audience imports it with a relative path (for example `api/admin/inventory/*` → `../../store/inventory/inventory.dto`).
- `TokenService` moved to `core/auth/`. The JWT guard needs it, and `core → modules` imports are not allowed.
- Server-built media links go through `modules/media/media.routes.ts`, so they follow `/account/media`.
- `modules/delivery/tracking.gateway.ts` (WebSocket `/tracking`) stays in its module. It is not HTTP, and `RouterModule` does not apply to it.

Still open (left as they were):

- These controllers keep inline `@ApiOperation` / `@ApiOkResponse` decorators instead of named `ApiXxx()` decorators in `<feature>.swagger.ts`: auth, catalog products and bundles (admin, store, public), options, orders, cart, audit, dashboard, customers, delivery partners.
- `AppStoresController.present()` keeps its response mapping in the controller.
- `common/authorization/store-scope.service.ts` is an injectable in `common/`.
