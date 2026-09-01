# Android handover notes

## 2026-08-28 — RFID, plate scanning, and sales approval temporarily disabled

Three point-of-sale features are turned off server-side for now (code intact, not removed — will come back later). Each affected endpoint now returns `400 Bad Request` with `"This feature is currently disabled"` instead of doing anything:

- **`GET /mobile/customers/nfc/:tagId`** — customer NFC/card scan-to-select is off. Don't surface that entry point in the app until re-enabled; phone-number search and QR scan (`GET /mobile/customers/:id`) are unaffected.
- **`POST /auth/attendant/nfc-login`** — badge-tap attendant login is off. `POST /auth/attendant/login` (PIN) is unaffected and is the only working login path right now.
- **`POST /mobile/vehicle-plate-checks`** — plate-photo OCR is off. Skip that step entirely: don't call this endpoint, and don't send `plateCheckId` on `POST /mobile/sales`/`sync` — both still accept a sale with no plate check attached.

**`POST /mobile/sales` behavior change**: sales are now auto-approved and cashback is credited to the customer immediately on creation — there's no more pending-approval delay. If the app was polling or showing an "awaiting approval" state anywhere, that's no longer applicable; the response from `createSale` already reflects the final approved state.

These are code-level toggles (`apps/api/src/common/feature-flags.ts`), not endpoint removals — no contract changes when they're switched back on, and no advance notice should be needed for that.

## 2026-08-31 — Fuel prices are now per station (no Android code change needed)

`GET /mobile/bootstrap`'s `prices` field and `GET /mobile/prices/current` return the exact same shape as before (`{PMS: ProductPrice|null, AGO: ProductPrice|null}`) — no contract change. Behind the scenes, prices are now scoped per station rather than one global price for everyone: two attendants at different stations may now legitimately see different PMS/AGO prices in bootstrap. Nothing to change in the app — it already just displays whatever bootstrap/currentPrices returns for the logged-in attendant's own station — this note is only so it's not mistaken for a bug if two attendants compare numbers.

## 2026-09-01 — No API changes this session; three new feature asks, one needs a backend decision first

**Where to point Android at:**
- Backend/web monorepo, this machine: `/Users/verisence/Desktop/100/gcp/loyalty-points-app`. Mobile-relevant code: `apps/api/src/mobile/` (every `/mobile/*` endpoint), `apps/api/src/auth/` (attendant login), `apps/api/src/common/feature-flags.ts` (the toggles from the 2026-08-28 entry above — still all `false` as of today, nothing re-enabled yet).
- Full standalone API reference: `docs/ANDROID-HANDOVER.md` in the same repo (auth flow, every endpoint, request/response shapes, offline-sync design) — this file is the changelog, that one's the reference.
- Live API: `https://loyalty-api-1092254911440.us-central1.run.app/api/v1` (Cloud Run `loyalty-api`, project `customer-loyalty-3af1a`, `us-central1`; Swagger at `/api/docs` on that host). Local dev: `http://localhost:8080/api/v1` via `npm run dev:api`.

**Nothing in the mobile API contract changed this session.** The only backend/web change worth knowing about: the attendant role's *display name* was renamed twice this session, "Attendant" → "Service Assistant" → **"Sales Assistant"** (final). This is UI-copy only on the web admin side — the `Role` enum value, every `Permission` key, the `attendants` Firestore collection, and the `/auth/attendant/*` routes are all untouched. If the app shows this role name anywhere in its own copy, update it to match; there's no API field for it, it's a hardcoded string on both sides.

Three feature asks came in for the mobile app:

**1. Auto-logout after every sale + offline queue that syncs in the background even with nobody logged in.** Repeated login/logout cycles need no backend change — `POST /auth/attendant/login` is stateless (no server-side session), so log in, sell, discard the token, log in as someone else works today with zero conflicts. Same for offline queuing itself — that's what `POST /mobile/sync` and its idempotency keys already exist for (see docs §5, "Offline-first design summary"). Recommended approach, no backend change needed: don't discard an attendant's token the instant they're logged out of the UI — retain it per-session until that session's queued sales are confirmed synced, then discard it; sync each attendant's queue separately, don't try to merge multiple attendants' sales into one `/mobile/sync` call (the server attributes a whole batch to whichever token made the call, not to a per-item field — there's no way to submit one mixed-attendant batch correctly today).

**Needs a backend decision before this can be fully "unattended":** attendant JWTs last 12 hours with no refresh token (docs §3.1). If a queue is still unsynced past 12h, there's currently no way to authenticate the eventual sync call with nobody around to re-enter a PIN — no recovery path exists today. Options to raise with the backend owner before building either: (a) a longer-lived or refreshable sync-only credential for attendants (staff already get a refresh token, attendants deliberately don't), or (b) a device-level credential that can call `/mobile/sync` on behalf of whichever attendant is embedded per queued item — bigger change, new trust model for a client-supplied attendant id. Shippable today without either: implement auto-logout + per-session offline queue + background sync while the retained token is still valid, and surface "ask an attendant to log in, N sales are stuck" once a queued token is found expired, rather than silently failing forever.

**Reminder while building this:** badge/NFC login (`POST /auth/attendant/nfc-login`) is still disabled per the 2026-08-28 entry above — PIN login (`POST /auth/attendant/login`) is the only working login path right now, so the offline-login flow only needs to handle PIN for now.

**2. Fix responsiveness across phone sizes.** Pure Android layout work, no backend/API involvement, not investigated as part of this backend/web session.

**3. Change the employee ID placeholder on the login page to "099".** Pure UI copy change — `employeeId` is a free-text string server-side, any placeholder is safe to ship. Worth a quick check with whoever requested it: real employee IDs in this system look like `KIS1-001` (station-prefixed, not numeric — see `apps/api/src/seed/seed.ts`), so `099` may read as a misleading example rather than a deliberate choice. Fine to ship as asked either way.
