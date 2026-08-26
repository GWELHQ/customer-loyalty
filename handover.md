# Handover — Android-relevant backend changes

Date: 2026-08-26
Audience: Android pump-attendant app team

This file is a running log of backend changes that affect (or are worth
knowing about for) the Android app. It does **not** replace
[docs/ANDROID-HANDOVER.md](docs/ANDROID-HANDOVER.md), which is the full,
current mobile API reference — this file only calls out what's new/changed
and how it plugs into that existing contract.

## TL;DR

0. **⚠️ Action required — cashback is no longer credited at sale time.**
   See §0 below. This is the one item that actually needs an Android-side
   code change; everything else in this file is either transparent or
   purely additive.
1. **Fraud & Governance** — sales are now checked automatically for
   irregular patterns (volume spikes, multi-location fueling, attendant
   collusion, etc.), reviewed by RTSM/Admin/Chairman/Finance/Exec Viewer in
   the web admin app. **Zero API contract change** for Android — every
   check runs invisibly after a sale is recorded.
2. **QR code and NFC as alternate ways to select a customer** — in
   addition to phone-number search, the app can now resolve a scanned QR
   code or a tapped NFC tag straight to a customer.
3. **Vehicle-plate photo verification** — a new step between "customer
   chosen" and "amount entered": the app photographs the vehicle's plate,
   the backend OCRs and compares it to the plate on file, and the result
   is carried into the sale for audit. **This never blocks the sale** —
   a mismatch only raises a Fraud & Governance flag for staff review.

None of this changes auth, token handling, `idempotencyKey`/retry
semantics, or the shape of any endpoint Android already calls, beyond the
additive fields and new endpoints detailed below.

---

## 0. ⚠️ Action required — cashback approval gate + SMS wording

**What changed server-side:** a sale's cashback is no longer credited to
the customer the instant it's recorded. It now waits for a station
supervisor (or their delegate, or RTSM/Admin) to approve it in the web
admin app — could be seconds later, could be hours. `POST /mobile/sales`
and `POST /mobile/sync` still return `cashbackEarned`/`monthToDateCashback`
in the response **unchanged in shape**, but those numbers now describe
what the sale *will* credit once approved, not what's already been added
to the customer's balance.

**Why this matters for Android specifically:** the app still composes and
sends its own "You earned KES X cashback" SMS immediately at sale time
(direct Africa's Talking call, `buildSaleConfirmationMessage`'s text —
unaffected by this API change since that send happens entirely
client-side). That SMS now goes out **before** the cashback it describes
is actually credited — it was already a promise, but now there's a real
window (this could be minutes, could be end-of-shift) where the amount is
provisional and a supervisor could still reject the sale.

**What to do:** reword the SMS text so it doesn't read as an
already-finalized amount — something like "cashback pending approval" or
similar, at your discretion. This repo isn't changing the API contract to
accommodate it, so this is entirely an Android-side wording/UX decision.

**Also note:** `monthToDateCashback` in every response is now
approved-sales-only (a customer's own still-pending sale from minutes ago
won't be reflected in it yet) — worth knowing if the app displays that
figure anywhere and a customer asks why a very recent sale isn't counted.

**Two smaller, already-implemented SMS changes worth mirroring in your own
composed text**, since `buildSaleConfirmationMessage` is the canonical
version and Android keeps its own copy in sync manually:
- Currency label changed from "KSh" to **"KES"**.
- Amounts are now shown **rounded to whole KES, no decimals** (cashback
  never carries cents-worth of precision worth displaying).
- **No SMS is sent at all when a sale earns zero cashback** — nothing
  worth texting the customer about. Apply the same skip client-side if
  your own send logic doesn't already avoid this case.

---

## 1. Fraud & Governance (background, no action needed)

Immediately after a sale is written — from both `POST /mobile/sales` and
each item inside `POST /mobile/sync` — the backend runs fraud checks
against that sale (currently: repeated identical litres for the same
customer, and a license-plate mismatch — see §3). These checks:

- **Never fail or block the sale.** A detection error can't affect the
  sale write — `createSale` still returns the same `Sale` object either
  way.
- **Never appear in the API response.** No new fields on `Sale` or
  `SyncedSaleOutcome` are added by this — flags live in a separate
  `fraudFlags` collection that only the web admin app reads.

**QA note:** if your test scripts repeatedly submit the same
`wholeLitres` amount for one test customer, you may see a "Repeated exact
litres" flag show up in the web admin once you hit 4+ occurrences in 90
days — expected and harmless, RTSM/Admin can dismiss it, but varying test
amounts avoids the noise.

**Attendants have zero visibility into fraud alerts — guaranteed, not
just by convention.** This is enforced server-side at three independent
layers, so there's no payload to accidentally surface even in a future
app version:

1. The fraud-flags API (`/fraud-flags/*`) is `@StaffOnly()` — an attendant
   bearer token gets a `401` before permissions are even checked.
2. Even for a staff session, `Permission.FRAUD_VIEW`/`FRAUD_MANAGE` are
   granted only to Admin, Chairman, Finance Approver, RTSM, and Exec
   Viewer — never Station Supervisor, never Attendant.
3. None of the `/mobile/*` endpoints Android calls read from or return
   anything from the `fraudFlags` collection.

Backend implementation: `apps/api/src/fraud/` (`fraud-detection.service.ts`
has the real-time checks; `fraud-flags.*` are web-admin-only).

---

## 2. QR code / NFC customer selection

Two new attendant-authenticated endpoints, alongside the existing
`GET /mobile/customers/search?phone=`:

### `GET /mobile/customers/:id`

The QR code shown on a customer's profile in the web admin app simply
encodes that customer's own `id` as plain text (not a URL). Scan it,
call this endpoint with the scanned value, get back the same `Customer`
shape as every other customer-returning endpoint. `404` if the id doesn't
exist.

### `GET /mobile/customers/nfc/:tagId`

Resolves a tapped NFC tag's UID to a customer. Staff assign a tag to a
customer once, from the web admin (Customer profile → "NFC tag ID" field)
— there's no in-app flow for Android to register a tag itself. `404` if no
customer has that tag assigned. Tag IDs are matched case-insensitively
(normalized uppercase server-side, so send whatever raw string your NFC
read returns).

Neither endpoint is station-scoped — same as phone search, a customer can
be selected at any station.

### New `Customer` fields (present on every customer-returning response)

```json
{
  ...,
  "licensePlateNumber": "KAA123B",  // or absent if none on file
  "nfcTagId": "04A2B3C4D5E680"      // or absent if none assigned
}
```
Both are optional/nullable — treat their absence as "not set," not an
error.

---

## 3. Vehicle-plate photo verification

**Where this fits in the sale flow:** after the customer is chosen (by
phone, QR, or NFC) and **before** the amount-entry screen, capture a
photo of the vehicle's plate and call:

### `POST /mobile/vehicle-plate-checks`

`multipart/form-data`, attendant-authenticated:
- `image` — the photo file.
- `customerId` — the customer just selected.

Response (a `VehiclePlateCheck`):
```json
{
  "id": "chk_abc123",
  "customerId": "...",
  "customerNameAtCheck": "John Kamau",
  "attendantId": "...",
  "stationId": "...",
  "imageUrl": "gs://...",
  "detectedPlateNumber": "KAA123B",   // or null if OCR found nothing plausible
  "matched": true,                     // false if no match, OCR failed, or customer has no plate on file
  "createdAt": "...",
  "updatedAt": "..."
}
```
Show `detectedPlateNumber` + a matched/mismatched indicator to the
attendant if you want (optional UX — see below), then continue to
amount entry regardless of the result. **Never block or require a retry
on a mismatch or a failed detection** — this is an audit/fraud signal,
not a gate.

### Carrying the result into the sale

Pass the returned `id` as `plateCheckId` on the eventual
`POST /mobile/sales` (or the corresponding item in `POST /mobile/sync`):

```json
{
  "customerPhone": "...",
  "product": "PMS",
  "amountPaid": 2068,
  "stationId": "...",
  "idempotencyKey": "...",
  "plateCheckId": "chk_abc123"
}
```
- **Optional.** Omit it if no photo was taken (e.g. camera unavailable,
  attendant skipped it) — the sale is recorded exactly as before.
- The backend re-validates it server-side (must belong to the same
  customer, must be less than 60 minutes old) — a stale, wrong-customer,
  or garbage `plateCheckId` is silently ignored, never an error.
- If included and valid, the returned `Sale` now carries:
  ```json
  "licensePlateCheck": { "plateCheckId": "chk_abc123", "detectedPlateNumber": "KAA123B", "matched": true }
  ```
  (absent if no valid check was carried through — same "absent means
  not set" rule as above).
- A `matched: false` result raises a `LICENSE_PLATE_MISMATCH` fraud flag
  for staff review — never a client-visible error, and covered by the
  same zero-attendant-visibility guarantee as every other fraud flag
  (§1).

### OCR limitations (so support conversations make sense)

Detection uses Google Cloud Vision's general-purpose text OCR, not a
purpose-built plate-recognition model — expect occasional missed reads on
blurry/angled/dirty plates (`detectedPlateNumber: null`) or a `matched:
false` on a customer who genuinely has no `licensePlateNumber` on file
yet. None of this is a bug to chase; it's why the check never blocks
anything.

---

## What did **not** change

- Request/response **shapes** for every previously-existing `/mobile/*`
  endpoint — the `plateCheckId` request field and `licensePlateCheck`
  response field are additive, and `cashbackEarned`/`monthToDateCashback`
  are still the same fields with the same types, just now describing a
  pending-until-approved amount (see §0).
- Auth flow, token lifetime, error shape.
- `idempotencyKey` / retry semantics.
- The `500`-sale cap per `POST /mobile/sync` call.
- Anything about customer registration requests.
- The sale-recording flow itself — no new required step, no new blocking
  validation, no change to when/how a sale is written. Approval is a
  purely server-side, after-the-fact concept.

## Where to look if you want the details

- Full mobile API reference: [docs/ANDROID-HANDOVER.md](docs/ANDROID-HANDOVER.md) — still the source of truth for every endpoint not mentioned here.
- Cashback approval gate: `apps/api/src/sales/sales.service.ts` (`createSale()` no longer credits cashback; `approveBatch()`/`reject()` do), `buildSaleConfirmationMessage` in `apps/api/src/sms/sms.service.ts` for the canonical SMS text to mirror.
- Fraud & Governance: `apps/api/src/fraud/`.
- QR/NFC lookups: `apps/api/src/mobile/mobile.controller.ts` (`getCustomer`, `getCustomerByNfc`).
- Vehicle-plate checks: `apps/api/src/vehicle-plate-checks/` (`vehicle-plate-checks.controller.ts` for the endpoint, `vision-ocr.service.ts` for the OCR heuristic).
- Sale-time plate check resolution: `apps/api/src/sales/sales.service.ts`, `createSale()` — search for `resolvePlateCheck`.
- Customer field normalization: `apps/api/src/customers/customers.service.ts` (`normalizeLicensePlate`, `normalizeNfcTagId`).
