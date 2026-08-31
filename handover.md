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
