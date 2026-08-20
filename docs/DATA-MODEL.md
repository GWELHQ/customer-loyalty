# Firestore data model

Database: Cloud Firestore, **Native mode**, single database (`(default)`). All collections are top-level. Every document has `id` (the Firestore doc ID), `createdAt`, `updatedAt` (ISO-8601 strings — Firestore `Timestamp`s are converted at the API boundary, see `apps/api/src/common/firestore/helpers.ts`).

Full TypeScript shapes live in `packages/shared/src/types.ts` — this document is the map, not the source of truth.

## Collections

### `users`
One doc per Microsoft-authenticated staff member (Admin, Chairman, Finance, RTSM, Station Supervisor).
- Unique on `email` (queried, not enforced by a Firestore constraint — enforced in `UsersService.create`).
- `assignedStationId` is set **if and only if** `role === station_supervisor` (enforced in `UsersService`, not just the DTO).
- `status` gates login: Microsoft can authenticate a person Firestore doesn't recognize as active — the API rejects them anyway (see `AuthService.loginWithMicrosoft`).

### `attendants`
One doc per Android pump attendant. Separate from `users` because attendants authenticate with employeeId + PIN, not Microsoft.
- `pinHash` — Argon2id hash, never plaintext.
- `failedPinAttempts`, `lockedUntil` — lockout state.
- `assignedStationId` — required, exactly one station.
- Index: `assignedStationId ASC, fullName ASC`.

### `stations`
Kisumu 1, Kisumu 2, Ugunja, Mbita, etc. Small, no special indexing needed.

### `customers`
Centralized across every station — not partitioned by station.
- `phoneNumber` — normalized E.164 (`+254...`), unique (enforced in `CustomersService.create`). Indexed for exact-match search and prefix range queries (`>=`/`<=` with the `` sentinel).
- `homeStationId` — informational only; a customer can transact at any station regardless.
- `specialRateKesPerLitre` / `specialRateEffectiveFrom` / `specialRateEffectiveTo` — the *currently active* special rate, denormalized onto the customer for fast lookup at sale time. The authoritative history lives in `specialRateRequests`.
- `totalCashbackEarned` — running total, updated atomically (`FieldValue.increment`) inside the sale-creation transaction.

### `productPrices`
Append-only history. A new price is a new document; the previous current price for that product gets `effectiveTo` set to the new price's `effectiveFrom` (still never deleted or mutated in place otherwise).
- "Current price" query: `where product == X, where effectiveFrom <= now, orderBy effectiveFrom desc, limit 1`.
- Sales never read this collection after the fact — they store their own `snapshot.pricePerLitre`.

### `priceReminderSettings`
Singleton document (`id: "default"`). Cloud Scheduler hits `POST /jobs/price-reminders`, which reads this doc, and only sends/updates `nextReminderAt`/`lastSentAt` if due.

### `sales`
The core transactional record. **Document ID = the client-generated `idempotencyKey` (a UUID)** — this is what makes retrying a sale creation, from either the admin UI or an offline Android sync batch, safe: a second write with the same ID is a no-op read, never a duplicate.
- Every calculated/derived value is captured in an immutable `snapshot` object (`litres`, `wholeLitres`, `pricePerLitre`, `cashbackRatePerLitre`, `cashbackEarned`) plus `stationNameAtSale`, `attendantNameAtSale`, `customerPhoneAtSale`, `specialRateIdAtSale` — a sale never changes meaning even if the customer's rate, the station's name, or the product price changes later.
- Indexes: `stationId+saleDate desc`, `attendantId+saleDate desc`, `customerId+saleDate desc`, `product+saleDate desc`.

### `smsDeliveries`
One doc per sale-confirmation SMS attempt. Decoupled from `sales.smsStatus` (denormalized copy on the sale for fast list rendering) — this collection holds the full attempt history (`retryCount`, `providerResponse`, `errorReason`).

### `specialRateRequests`
Full lifecycle + audit trail for a special customer rate: `pending → approved | rejected`, immutable once decided (a new request must be filed to change a customer's rate again). Approval writes through to `customers.specialRate*` fields but never touches historical `sales.snapshot`.
- Index: `status+createdAt desc`.

### `customerRegistrationRequests`
An attendant registering a brand-new customer during a sale (phone not yet a `customers` doc) creates one of these instead of writing directly to `customers`/`sales`. **Document ID = the client-generated `idempotencyKey`**, same offline-safe-retry guarantee as `sales`. Lifecycle: `pending → approved | rejected`, decided by a Station Supervisor (own station only), RTSM, or Admin.
- `snapshot` on the request is preview-only. Approving calls `SalesService.createSale` with the request's original `saleDate`, so pricing/cashback are computed exactly as they would have been at the time of the actual sale — not recalculated against whatever's current when someone gets around to approving it. Rejecting creates nothing.
- Indexes: `status+createdAt desc`, `stationId+createdAt desc`, `stationId+status+createdAt desc`.

### `reconciliationDaily`
One doc per `(stationId, product, date)` — deterministic document ID (`{stationId}__{product}__{date}`) so ingesting the same day's totals twice updates in place rather than duplicating. `loyaltySales` is accumulated via a Firestore transaction as each sale is created (see `ReconciliationService.reserveLoyaltySaleAmount`), never recomputed by scanning `sales` client-side.
- Index: `stationId+date desc`.

### `monthlyCashbackLedgers`
One doc per month, **document ID = `YYYY-MM`**. While `open_accruing`, `entries` is recomputed on read from `sales` (grouped by customer). Once `submitted_for_approval`, entries are frozen — the ledger reflects exactly what was reviewed and approved, independent of any `sales` written afterward.

### `disbursementBatches`
Created only from an `approved` ledger (`DisbursementBatchesService.create` enforces this). `entries` are seeded from the ledger's entries at batch-creation time. Status only reaches `completed` once every entry has a real per-customer `paid`/`failed` result recorded via `POST /disbursement-batches/:id/complete` — never inferred.
- Index: `month+createdAt desc`.

### `imports` (+ `imports/{id}/rows` subcollection)
Import job metadata lives on the parent doc (`fileName`, `gcsFilePath`, counts, `columnMapping`). Each source row is its own document in the `rows` subcollection (avoids the 1 MiB Firestore document-size limit for the up-to-5,000-row files this domain allows) with its classification (`created` / `duplicate_skipped` / `rejected`) and `problem` text. The original `.xlsx`/`.csv` and any generated error-report CSV live in **Cloud Storage**, not Firestore — only the `gs://` path is stored here.

### `notifications`
One doc per (user, event). Simple `userId+createdAt desc` index for the bell dropdown.

### `auditEvents`
Append-only. Every state-changing action across the whole domain writes one of these (see `AuditService.record`, called from nearly every controller). `entityType+createdAt desc` index for "audit trail for this record" views (e.g. the sale detail drawer).

### `syncOperations`
One doc per offline-sale-sync attempt (not per sale — a retried record produces a second `syncOperations` doc even though it doesn't produce a second `sales` doc), so Android sync history and staff-side sync auditing are fully reconstructable. `attendantId+createdAt desc` index.

## Cross-cutting rules encoded in the model, not just the API

- **Idempotency**: `sales` document ID = `idempotencyKey`. This is a Firestore-level guarantee, not just an application check — a `tx.get()` + `tx.set()` on the same ID within one transaction is race-safe.
- **Atomic financial aggregates**: `customers.totalCashbackEarned` uses `FieldValue.increment`; `reconciliationDaily.loyaltySales` is updated only inside the same transaction that creates the sale. Neither is ever computed by summing client-side.
- **Immutable snapshots**: `sales.snapshot`, `sales.stationNameAtSale`, `sales.attendantNameAtSale`, `sales.customerPhoneAtSale`, `sales.specialRateIdAtSale` — a sale is a fact about what happened, not a live join.
- **Single-station enforcement**: `users.assignedStationId` and `attendants.assignedStationId` are the only two places a station scope is stored; every guarded query filters by it server-side (`common/access/station-scope.ts`), never by trusting a client-supplied `stationId`.
