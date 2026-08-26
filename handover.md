# Handover — Fraud & Governance (Android-relevant changes)

Date: 2026-08-26
Audience: Android pump-attendant app team

## TL;DR

A new **Fraud & Governance** feature was added to flag irregular fueling
activity (volume spikes, multi-location same-day fueling, attendant/customer
collusion patterns, off-hours sales, etc.), reviewed by RTSM/Admin/
Chairman/Finance/Exec Viewer in the web admin app.

**No Android API contract changed.** `POST /mobile/sales` and
`POST /mobile/sync` accept the same request body and return the same
response shape as before. There is nothing new to parse, no new fields to
send, and no new client-visible error codes. The full mobile API reference
remains [docs/ANDROID-HANDOVER.md](docs/ANDROID-HANDOVER.md) — this file
only calls out what's different as a result of this change.

## What actually changed, from Android's point of view

### 1. Every sale now triggers a server-side fraud check (invisible to the app)

Immediately after a sale is written — from both the single-sale path
(`POST /mobile/sales`) and each item processed inside a sync batch
(`POST /mobile/sync`) — the backend now runs two lightweight checks against
that sale:

- **Repeated exact litres**: has this customer bought this exact
  `wholeLitres` amount 4+ times in the last 90 days?
- **Off-hours sale**: does `saleDate` fall outside 05:00–23:00 Nairobi time?

These checks:
- **Never fail or block the sale.** They're wrapped server-side so a
  detection error can't affect the sale write — `createSale` still returns
  the same `Sale` object either way.
- **Never appear in the API response.** No new fields on the `Sale` object,
  no new field on `SyncedSaleOutcome`/sync results. Flags are written to a
  separate collection (`fraudFlags`) that only the web admin app reads.
- Are why **`saleDate` accuracy now matters slightly more than before.**
  This doc already told you to always send the real time a sale happened
  (§4.3 of the full handover) for pricing accuracy — that same field now
  also drives the off-hours check, so an inaccurate `saleDate` (e.g.
  defaulting to "now" for an offline sale synced hours later) can produce a
  misleading off-hours flag for staff to review. No code change needed on
  Android's side — just a reminder that the existing guidance matters more.

### 2. A note for QA / test data

If your test fixtures or QA scripts repeatedly submit sales for the same
test customer with the same `amountPaid` (and therefore the same
`wholeLitres`), you may see those test sales show up as **"Repeated exact
litres"** flags in the web admin's Fraud & Governance page once you hit 4+
occurrences in 90 days. This is expected and harmless — RTSM/Admin can
dismiss those flags — but varying test amounts avoids the noise if it's a
concern for your QA dashboards being watched by ops.

### 3. Bulk sync latency (worth knowing, not necessarily an issue)

`POST /mobile/sync` processes each queued sale sequentially
(`for (const sale of dto.sales) await this.sales.syncOne(...)`), and each
`createSale` call now does one extra Firestore read (the repeated-litres
check) before returning. For a large batch (the endpoint's existing cap is
**500 sales per call**), this adds a small amount of latency per item on
top of what was already there. We haven't seen this be a practical problem
in testing, but if you notice sync calls taking longer than before after
this deploys, this is why — let the backend team know if it becomes
noticeable and we can look at batching/parallelizing the check.

## Attendants have zero visibility into fraud alerts — guaranteed, not just by convention

This isn't a "the app just doesn't show it" thing — it's enforced server-side
at three independent layers, so there's no payload to accidentally surface
even if a future app version tried:

1. The fraud-flags API (`/fraud-flags/*` — list, detail, resolve, dismiss)
   is `@StaffOnly()`. An attendant bearer token gets a `401` before
   permissions are even checked, because `JwtAuthGuard` rejects any
   attendant-kind session on a staff-only route outright.
2. Even for a staff session, `Permission.FRAUD_VIEW`/`FRAUD_MANAGE` are
   granted only to Admin, Chairman, Finance Approver, RTSM, and Exec
   Viewer — never Station Supervisor, never Attendant.
3. None of the `/mobile/*` endpoints Android actually calls (`bootstrap`,
   `sales`, `sync`, `sync-status`, `daily-summary`, `sales/mine`,
   `customer-registrations`) read from or return anything from the
   `fraudFlags` collection. There is no field, flag, or score hiding in any
   mobile response for the app to accidentally expose in a UI.

Net effect: an attendant has no way — via their own login, a leaked token,
or a client bug — to see that a sale (their own or anyone else's) was
flagged. Only the five staff roles above, in the web admin app, ever see a
fraud flag.

## What did **not** change

- Request/response shapes for every `/mobile/*` endpoint.
- Auth flow, token lifetime, error shape.
- `idempotencyKey` / retry semantics.
- The `500`-sale cap per sync call.
- Anything about customer registration requests.

## Where to look if you want the details

- Full mobile API reference: [docs/ANDROID-HANDOVER.md](docs/ANDROID-HANDOVER.md) (unchanged by this feature, still current).
- Backend implementation: `apps/api/src/fraud/` (`fraud-detection.service.ts` has the real-time checks referenced above; `fraud-flags.service.ts` and `fraud-flags.controller.ts` are web-admin-only, not reachable from `/mobile/*`).
- The real-time hook itself: `apps/api/src/sales/sales.service.ts`, `createSale()` — search for `fraudDetection.runRealtimeChecks`.
