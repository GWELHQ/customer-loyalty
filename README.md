# Green Wells Loyalty Cashback

Centralized fuel loyalty cashback system for Green Wells Energies: an admin web app (React), a REST API (NestJS) that also serves the Android pump-attendant app, Cloud Firestore for data, and Cloud Storage for files.

Customers earn **KSh 2 per whole litre** (configurable per-customer via an approved special rate) at any of Kisumu 1, Kisumu 2, Ugunja, and Mbita — one centralized customer record, one monthly cashback ledger, one approval trail.

## Monorepo layout

```text
apps/
  web/                 React + TypeScript admin portal (Vite)
  api/                 NestJS API — serves both the admin web app and the Android app
packages/
  shared/              Domain types, enums, RBAC matrix, cashback calc, phone normalization, zod schemas
  api-client/          Typed HTTP client used by the web app (and as the Android API contract reference)
infra/
  google-cloud/        Deployment docs, firestore.indexes.json, firestore.rules, firebase.json
docs/
  DATA-MODEL.md         Firestore collection-by-collection reference
```

## Local setup

Requires Node 20+. This repo uses npm workspaces (`npm install` at the root installs everything).

```bash
npm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# fill in Microsoft Entra values (see below) and JWT secrets (openssl rand -hex 32)
```

**Firestore/Storage locally**: either point `GOOGLE_APPLICATION_CREDENTIALS` at a downloaded service-account key for a scratch dev GCP project, or run everything against the Firestore emulator:

```bash
firebase emulators:start --only firestore
export FIRESTORE_EMULATOR_HOST=localhost:8080   # in the shell running the API
```

Run everything:

```bash
npm run dev:api     # http://localhost:8080 — Swagger at /api/docs
npm run dev:web     # http://localhost:5173
npm run seed --workspace=@loyalty/api   # optional demo data: stations, one user per role, attendants, prices, customers
```

The web app can also run with **zero backend** for a UI-only demo: set `VITE_DATA_MODE=demo` in `apps/web/.env` — it serves seeded in-memory data through the exact same typed API client, and signs in automatically as a demo Admin.

## Microsoft Entra ID setup

Admin, Chairman, Finance, and RTSM sign in with Microsoft; Attendants never do (they use employeeId + PIN from the Android app — see below).

1. **Entra admin center → App registrations → New registration.**
   - Name: `Green Wells Loyalty (web)`.
   - Supported account types: single tenant (your organization only).
   - Platform: **Single-page application (SPA)**.
   - Redirect URI: `http://localhost:5173/auth/microsoft/callback` for local dev, plus your deployed web app's `https://<domain>/auth/microsoft/callback`.
2. **API permissions**: `openid`, `profile`, `email` (all delegated, Microsoft Graph — these are pre-consented defaults, no admin consent needed for basic sign-in).
3. Note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page.
4. There is **no client secret** anywhere in this flow — a SPA is a public client using PKCE, not a confidential client. If you generate one anyway on the "Certificates & secrets" tab (easy to do by habit), it's simply unused; nothing in this codebase reads it. (See `apps/api/src/auth/microsoft-oidc.service.ts` for the JWKS-based token verification that replaces the need for one.)

   **If sign-in fails with `AADSTS9002326: Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type`**: the redirect URI was registered under the **Web** platform instead of **Single-page application**. Fix it in Entra admin center → your app registration → Authentication → move the redirect URI from the "Web" section to the "Single-page application" section (or delete and re-add it under the correct platform).

Environment variables (same tenant/client ID on both sides):

```bash
# apps/web/.env
VITE_MS_ENTRA_TENANT_ID=<tenant-id>
VITE_MS_ENTRA_CLIENT_ID=<client-id>
VITE_MS_ENTRA_REDIRECT_URI=http://localhost:5173/auth/microsoft/callback

# apps/api/.env
MS_ENTRA_TENANT_ID=<tenant-id>
MS_ENTRA_CLIENT_ID=<client-id>
```

**How it works**: the React app starts the sign-in with `@azure/msal-browser` (`loginPopup`, PKCE, no secret exposed to the browser), gets back a Microsoft-issued `id_token`, and posts *only that token* to `POST /auth/microsoft/callback`. The API verifies the token's signature against Microsoft's published JWKS for your tenant (`MicrosoftOidcService`), then — critically — **does not trust the token for anything beyond identity**. It looks the verified email up in Firestore (`users` collection); a person who authenticates successfully with Microsoft but has no active Firestore user record (or is `inactive`) is rejected with 401. Role, active status, and station assignment always come from Firestore, set by an Admin via `/users`, never from Microsoft claims.

First-time sign-in auto-provisions an **inactive** placeholder user (so an Admin can see them appear and assign a role) — they still can't log in until an Admin activates the account.

Sessions are the app's own short-lived JWTs (`JWT_ACCESS_TTL`, default 15m) plus a longer refresh token (`JWT_REFRESH_TTL`, default 7d), issued by the API, stored in `localStorage` by the web app. `POST /auth/logout` and expiry are both handled independently of the Microsoft session — signing out of the app does not touch the person's Microsoft session at all.

## Roles

| Role | Signs in with | Can do |
| --- | --- | --- |
| Admin | Microsoft | Manage users, attendants, customers, stations, imports, prices, reports/operational data. Cannot approve special rates. |
| Chairman | Microsoft | View everything. The only role that can approve/reject special-rate requests. |
| Finance | Microsoft | Approve/confirm the finance stage: ledger approval, disbursement batches. |
| RTSM (Retail Sales Manager) | Microsoft | View operational data, manage customers, **request** (not approve) special rates. |
| Station Supervisor | Microsoft | Reports/reconciliation/sales for **exactly one** assigned station — enforced server-side, not just hidden in the UI. |
| Attendant | Employee ID + PIN (Android only) | Create/view own sales, cached prices/rates, own daily reconciliation. |

The full permission matrix is one file: `packages/shared/src/permissions.ts`. The API enforces it in guards (`PermissionsGuard`); the web app imports the *same* matrix only to decide what to show in navigation — a forbidden route redirects silently to the user's own landing page rather than showing a "no access" screen, but the API is what actually blocks the request either way.

## Attendant (Android) authentication

Each attendant account is created by an Admin (`POST /attendants`) with a full name, employee ID, assigned station, and initial PIN. The PIN is hashed with **Argon2id** — plaintext PINs are never stored or logged. Login is `POST /auth/attendant/login` with `{ employeeId, pin }` — a PIN alone is never sufficient. 5 failed attempts locks the account for 15 minutes (`PIN_MAX_FAILED_ATTEMPTS` / `PIN_LOCKOUT_MINUTES` in `packages/shared/src/constants.ts`); every attempt (success or failure) is an audit event.

## Offline sync (Android)

The API contract for the Android app lives under `/mobile/*` (see Swagger) and `packages/api-client`:

- `GET /mobile/bootstrap` — attendant identity, assigned station, current PMS/AGO prices, a `configVersion` to detect stale caches.
- `GET /mobile/customers/search?phone=` — normalized-phone customer lookup.
- `POST /mobile/sales` — single online sale, idempotency key required.
- `POST /mobile/sync` — bulk sync of queued offline sales. Every record needs a **client-generated `idempotencyKey` (UUID) and `clientLocalId`**.

Each `sales` Firestore document's ID *is* the `idempotencyKey` — retrying the same record, once or a hundred times, can never create a duplicate; it's a Firestore-level guarantee (`SalesService.createSale`), not just an application-level check. Every synced record gets back exactly one of:

| Result | Meaning |
| --- | --- |
| `accepted` | Created, calculated and recorded server-side. |
| `already_processed` | This `idempotencyKey` already exists — safe retry, no duplicate. |
| `rejected` | A real business-rule violation (missing customer, no active price, loyalty sales already over the day's ceiling for that station/product). |
| `needs_review` | Created using the server-authoritative price/rate, but the record is flagged because the client's cached price/rate disagreed with it — never silently discarded, always reviewable in the admin app. |
| `conflict` | Reserved for a retried `clientLocalId` whose payload doesn't match the original — the `syncOperations` collection preserves full attempt history for this kind of investigation. |

Server-side calculation and authorization are always authoritative — a client-submitted cashback figure is only ever used to *detect* a stale cache (`needs_review`), never trusted for the actual amount.

## Financial calculation rules

```text
litres      = amountPaid / pricePerLitre
wholeLitres = floor(litres)
cashback    = wholeLitres * cashbackRatePerLitre   // default KSh 2, or an approved special rate
```

Implemented once, in `packages/shared/src/cashback.ts`, used by the API (authoritative) and importable by any client for preview math. Decimal litres are **truncated, never rounded** — 10.34 L earns KSh 20, not more. See `packages/shared/src/cashback.test.ts` for the boundary cases (including binary floating-point noise near a whole-litre line).

A special rate only takes effect after **Chairman approval** (`special-rate-requests` workflow); an attendant can never override a rate. Every sale stores an **immutable snapshot** (`sales.snapshot`) of the litres, whole litres, price-per-litre, cashback rate, and cashback earned actually used — later price or rate changes never retroactively change a past sale.

## API

Swagger/OpenAPI: `http://localhost:8080/api/docs` once the API is running. Versioned under `/api/v1`. See `docs/DATA-MODEL.md` for the Firestore shape behind every endpoint.

## Tests

```bash
npm run test --workspace=@loyalty/shared      # cashback calc, phone normalization, RBAC matrix — no external services

npm run test --workspace=@loyalty/api         # unit tests, no external services
firebase emulators:start --only firestore     # in a separate shell, for the e2e suite below
npm run test:e2e --workspace=@loyalty/api     # idempotent sale creation, offline sync, RBAC over HTTP,
                                               # Microsoft-login mock flow, customer import, special-rate
                                               # approval → ledger → disbursement, reconciliation blocking

npm run test:e2e --workspace=@loyalty/web     # Playwright, run against VITE_DATA_MODE=demo — no backend needed
```

## Deployment

See `infra/google-cloud/DEPLOYMENT.md` for GCP services, service accounts/IAM, secrets, and the exact `gcloud`/`firebase` commands for each piece (Cloud Run for the API, Firebase Hosting/Cloud Storage+CDN/Cloud Run for the web app, Cloud Scheduler for price reminders).

## Deliberate scope notes

- The Android app's **UI** is out of scope for this deliverable by design — only its API contract, auth, and offline-sync behavior are implemented here.
- `PATCH /users/:id/reset-pin` from the original endpoint sketch is implemented as `POST /attendants/:id/reset-pin` instead — attendants are a separate Firestore collection/entity from Microsoft-authenticated `users` (different auth mechanism entirely), so PIN reset lives with the rest of attendant lifecycle management.
- Firestore security rules (`infra/google-cloud/firestore.rules`) default-deny every collection: all reads and writes go through the API using the Firebase Admin SDK (which bypasses rules), since RBAC/station-scoping/financial-write authorization all live in the API layer, not in client-side Firestore rules.
