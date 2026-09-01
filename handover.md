# Android handover notes

## 2026-09-01 — Attendant refresh tokens added (for offline-sync); two other feature asks are pure Android work

**Where to point Android at:**
- Backend/web monorepo, this machine: `/Users/verisence/Desktop/100/gcp/loyalty-points-app`. Mobile-relevant code: `apps/api/src/mobile/` (every `/mobile/*` endpoint), `apps/api/src/auth/` (attendant login), `apps/api/src/common/feature-flags.ts` (see below).
- Full standalone API reference: `docs/ANDROID-HANDOVER.md` in the same repo (auth flow, every endpoint, request/response shapes, offline-sync design) — this file is the changelog, that one's the reference.
- Live API: `https://loyalty-api-1092254911440.us-central1.run.app/api/v1` (Cloud Run `loyalty-api`, project `customer-loyalty-3af1a`, `us-central1`; Swagger at `/api/docs` on that host). Local dev: `http://localhost:8080/api/v1` via `npm run dev:api`.

**Still true as of today** (from `apps/api/src/common/feature-flags.ts` — code-level toggles, not endpoint removals, no contract change when flipped back on): customer NFC/card scan-to-select (`GET /mobile/customers/nfc/:tagId`), badge-tap attendant login (`POST /auth/attendant/nfc-login`), and plate-photo OCR (`POST /mobile/vehicle-plate-checks`) are all disabled. PIN login (`POST /auth/attendant/login`) is the only working login path. Sales are auto-approved on creation — no pending-approval delay, nothing to poll for.

**One mobile API change this session** (see below — attendant refresh tokens). Everything else: the attendant role's *display name* was renamed twice this session, "Attendant" → "Service Assistant" → **"Sales Assistant"** (final). This is UI-copy only on the web admin side — the `Role` enum value, every `Permission` key, the `attendants` Firestore collection, and the `/auth/attendant/*` routes are all untouched. If the app shows this role name anywhere in its own copy, update it to match; there's no API field for it, it's a hardcoded string on both sides.

Three feature asks came in for the mobile app:

**1. Auto-logout after every sale + offline queue that syncs in the background even with nobody logged in.** Repeated login/logout cycles need no backend change — `POST /auth/attendant/login` is stateless (no server-side session), so log in, sell, discard the access token, log in as someone else works today with zero conflicts. Offline queuing itself is what `POST /mobile/sync` and its idempotency keys already exist for (docs §5, "Offline-first design summary").

**Backend change made this session, to close the "sync with nobody logged in" gap:** attendant login (`POST /auth/attendant/login` and, once re-enabled, `/nfc-login`) now also returns a `refreshToken` (30-day lifetime, `ATTENDANT_REFRESH_JWT_TTL`), and there's a new `POST /auth/attendant/refresh` endpoint that silently exchanges a still-valid `refreshToken` for a fresh `accessToken` + rotated `refreshToken` — no PIN. Full detail in `docs/ANDROID-HANDOVER.md` §3.1/§3.1c and §5 point 6. **Implementation on the Android side:** retain each attendant's `refreshToken` on-device per session even after they're logged out of the UI; when connectivity returns and an access token has expired, call the refresh endpoint silently, then flush that attendant's queue via `/mobile/sync`. Do this **once per attendant, sequentially** — a single `/mobile/sync` call still attributes its whole batch to whichever token made the call (no per-item attendant field), so don't merge multiple attendants' queued sales into one call. Discard a session's `refreshToken` once its queue is fully synced. Past 30 days offline, the refresh token itself expires and a PIN re-entry is the only recovery — a much wider margin than the access token's 12h alone, and covers any realistic outage.

**Reminder while building this:** badge/NFC login is still disabled (see above) — PIN login is the only working login path right now, so the offline-login flow only needs to handle PIN for now.

**2. Fix responsiveness across phone sizes.** Pure Android layout work, no backend/API involvement, not investigated as part of this backend/web session.

**3. Change the employee ID placeholder on the login page to "099".** Pure UI copy change — `employeeId` is a free-text string server-side, any placeholder is safe to ship. Worth a quick check with whoever requested it: real employee IDs in this system look like `KIS1-001` (station-prefixed, not numeric — see `apps/api/src/seed/seed.ts`), so `099` may read as a misleading example rather than a deliberate choice. Fine to ship as asked either way.
