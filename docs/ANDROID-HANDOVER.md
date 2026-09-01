# Android Handover — Green Wells Loyalty Cashback API

This is the API surface the Android pump-attendant app talks to. It is the
**only** part of the system Android needs — attendants never see the admin
web app, and this API is the sole integration point. Everything below was
pulled directly from the live NestJS source so it stays accurate; if
anything here conflicts with what the server actually returns, trust the
server (and flag the mismatch back to the backend owner).

The backend, admin web app, and this doc live in one monorepo
(`loyalty-points-app`) that the Android project does **not** need access to.
This file is meant to be fully self-contained.

## 1. Who uses this API

Two completely separate identities exist in this system:

- **Staff** (Admin, Chairman, Finance, RTSM, Station Supervisor, Exec
  Viewer) — sign in via Microsoft Entra ID, use the web admin app. Not
  relevant to Android.
- **Attendants** — sign in with `employeeId` + a 4–6 digit PIN, use
  **only** the mobile API described here. Attendants have zero access to
  any web page.

Every mobile endpoint requires an attendant bearer token and is
automatically scoped server-side to that attendant's own identity and
assigned station — the app should never need to (and cannot) pass a
station ID or attendant ID to override that scoping.

## 2. Base URL and conventions

- All routes are prefixed with `/api/v1`. Example: `POST /api/v1/auth/attendant/login`.
- Dev server listens on `:8080` by default (`PORT` env var). Swagger/OpenAPI
  docs are live at `/api/docs` on a running instance — use that for a
  browsable, always-current reference alongside this doc.
- All request/response bodies are JSON.
- All dates are ISO-8601 strings (UTC), e.g. `2026-08-20T09:15:00.000Z`.
- Money and litres are plain numbers (KES, not cents; litres as decimals).
- Auth: `Authorization: Bearer <accessToken>` header on every route except
  `POST /auth/attendant/login`.

### Error shape (every non-2xx response)

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Invalid employee ID or PIN",
  "path": "/api/v1/auth/attendant/login",
  "timestamp": "2026-08-20T09:15:00.000Z"
}
```

`message` is a string for a single error, or a string array for
validation errors (one entry per invalid field — `class-validator`
messages, e.g. `"amountPaid must be a positive number"`).

## 3. Auth flow

### 3.1 Login

```
POST /auth/attendant/login
Body: { "employeeId": "KIS1-042", "pin": "4821" }
```

Response:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "attendant": {
    "kind": "attendant",
    "attendantId": "...",
    "employeeId": "KIS1-042",
    "fullName": "Jane Otieno",
    "role": "attendant",
    "assignedStationId": "..."
  }
}
```

- Rate-limited: **10 attempts per 60 seconds** per client (`429` past that).
- PIN lockout: **5** consecutive wrong PINs locks the account for **15
  minutes** (`401` with a message naming the unlock time). A correct PIN
  resets the counter.
- Inactive attendants (deactivated by a Station Supervisor/Admin) get a
  `401` — treat this as "contact your supervisor", not a retryable error.
- **`accessToken`**: lifetime is `ATTENDANT_JWT_TTL`, currently **12
  hours**. Every `/mobile/*` call and `POST /mobile/sync` uses this.
- **`refreshToken`** (added 2026-09-01): lifetime is
  `ATTENDANT_REFRESH_JWT_TTL`, currently **30 days**. Store it alongside
  the access token, per logged-in attendant. Exists specifically for
  background sync: once `accessToken` expires, call §3.1c below with the
  stored `refreshToken` to silently mint a fresh `accessToken` (and a
  rotated `refreshToken` — store the new one, discard the old) with **no
  PIN prompt**, then flush that attendant's queued sales via
  `POST /mobile/sync`. This is what makes "sync an offline queue once the
  device is back online, even with nobody logged in at that moment"
  possible — see §5 for the full recommended flow.
- If the UI needs a fresh PIN-login prompt at all (e.g. `refreshToken`
  itself has expired, or an attendant's local queue is fully flushed and
  they're just starting a new shift), show the PIN screen — same as
  before, this hasn't changed.
- There's no `/auth/logout` call needed beyond discarding the tokens
  locally — sessions are stateless JWTs, nothing to invalidate server-side.
  Discarding `refreshToken` on logout is a **product decision, not a
  requirement**: keeping it around (per the offline-sync flow above) is
  exactly what lets that attendant's queued-but-unsynced sales flush later
  without them being present.

### 3.1b Badge login (RFID/NFC tap, no PIN)

```
POST /auth/attendant/nfc-login
Body: { "tagId": "<raw UID read off the tapped badge>" }
```

Same response shape as PIN login (`accessToken` + `attendant`), same
`ATTENDANT_JWT_TTL` session, same "no refresh token" behavior — this is
just a second way to obtain the same kind of session, not a different
token type. `tagId` is normalized server-side — uppercased, and every
character that isn't a letter or digit (colons, dashes, spaces) is
stripped — so `"F9:45:EF:A2"`, `"F9-45-EF-A2"`, and `"F945EFA2"` all
normalize to the same value and match each other. Applied identically at
registration time (web admin) and lookup time, so send whatever raw
string your NFC read returns, punctuated or not.

- Rate-limited the same as PIN login (10/60s per client).
- `401` if the tag isn't assigned to any attendant, or the attendant is
  inactive — same "contact your supervisor" handling as PIN login's `401`.
- **This is a deliberately weaker credential than a PIN**, by design: the
  badge UID alone is sufficient to log in, no second factor. A lost or
  stolen badge is a valid login until an Admin unassigns it from the
  attendant's profile in the web admin app. If your UX lets a device
  remember "last logged-in attendant" or similar, don't let badge login
  bypass anything PIN login wouldn't also bypass — treat it as exactly
  equivalent to typing the PIN, not as a lesser check.
- Badges are assigned to attendants by an Admin in the web admin app
  (Attendants → Edit → "RFID/NFC badge UID") — there's no in-app flow for
  Android to register a badge itself, same pattern as customer NFC tags.
- A tag can only ever be assigned to one attendant at a time (same
  uniqueness rule as customer NFC tags).

**UX suggestion, not a requirement:** show both a "Tap badge" and a
"Enter ID + PIN" option on the same login screen, so a lost/dead badge
never blocks an attendant from working a shift.

### 3.1c Silent refresh (added 2026-09-01)

```
POST /auth/attendant/refresh
Body: { "refreshToken": "<the refreshToken from login>" }
```

Same response shape as PIN login (`accessToken` + `refreshToken` +
`attendant`) — call this instead of showing a login screen whenever you
have a still-valid `refreshToken` for an attendant but their `accessToken`
has expired. No PIN involved; this is meant to run invisibly, typically
right before a background sync of that attendant's queued offline sales.

- Rate-limited the same as PIN login (10/60s per client).
- `401` ("Session no longer valid") if the `refreshToken` itself has
  expired (30 days), is malformed, or the attendant has been deactivated
  since it was issued — fall back to the PIN login screen in that case.
- The response's `refreshToken` is a **new, rotated** token — always store
  it in place of the one you just used; the old one is not reusable after
  a successful refresh (same rotation behavior as the staff refresh flow).
- This does **not** create an audit-log entry the way a real login does —
  it's a credential renewal, not a new "an attendant started using the
  app" event.

Attach `Authorization: Bearer <accessToken>`. A `401` on any call means the
token is invalid/expired or the attendant was deactivated — send the user
back to the PIN login screen. There is no token refresh; re-login is the
only recovery.

## 4. Endpoints (`/mobile/*`, all attendant-authenticated)

### `GET /mobile/bootstrap`

Call once after login (and optionally on app resume) to get everything
needed to run offline for a shift.

```json
{
  "attendant": { "kind": "attendant", "attendantId": "...", "employeeId": "...", "fullName": "...", "role": "attendant", "assignedStationId": "..." },
  "station": { "id": "...", "name": "Kisumu 1", "code": "KSM1", "location": "...", "active": true, "createdAt": "...", "updatedAt": "..." },
  "prices": [
    { "id": "...", "product": "PMS", "pricePerLitre": 194.5, "effectiveFrom": "...", "effectiveTo": null, "createdByUserId": "...", "createdByName": "...", "createdAt": "...", "updatedAt": "..." },
    { "id": "...", "product": "AGO", "pricePerLitre": 180.2, "effectiveFrom": "...", "effectiveTo": null, "createdByUserId": "...", "createdByName": "...", "createdAt": "...", "updatedAt": "..." }
  ],
  "configVersion": 1,
  "serverTime": "2026-08-20T09:15:00.000Z"
}
```

`configVersion` is bumped by the backend whenever bootstrap-relevant
reference data changes shape (not on every price change — just on schema
changes). Cache it; if a future bootstrap response has a higher number,
treat cached reference data as stale and re-sync. `prices` is the currently
active price per product (`Product` = `"PMS" | "AGO"`) — this is what the
app should use to preview cashback for a sale **before** submitting, but
the server always recalculates authoritatively at submit/sync time (see §5).

### `GET /mobile/customers/search?phone=<value>`

Look up a customer by phone before recording a sale.

- Pass a full number for an exact match — returns an array with 0 or 1
  items.
- Pass a partial digit string (4+ digits) for a prefix search (useful for
  incremental-search-as-you-type UI) — returns an array of matches.
- Accepts local (`07...`) or `+254...` formats; normalized server-side.
- `phone` is required — omitting it is a `404`, not an empty array.

Returns `Customer[]`:

```json
[
  {
    "id": "...",
    "fullName": "John Kamau",
    "phoneNumber": "+254712345678",
    "homeStationId": "...",
    "specialRateId": null,
    "specialRateKesPerLitre": null,
    "specialRateEffectiveFrom": null,
    "specialRateEffectiveTo": null,
    "totalCashbackEarned": 1240.5,
    "source": "manual",
    "licensePlateNumbers": ["KAA123B", "KBW878S"],
    "nfcTagId": "04A2B3C4D5E680",
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

`licensePlateNumbers` is an array — a customer can have more than one
vehicle on file (family car + motorcycle, etc.); absent or `[]` means
none set. `nfcTagId` is likewise absent, not an error, when no tag is
assigned. Both appear on every `Customer`-returning endpoint (this one,
`GET /mobile/customers`, `GET /mobile/customers/:id`,
`GET /mobile/customers/nfc/:tagId`).

**If the phone number isn't found**, this customer doesn't exist yet — do
not call `POST /mobile/sales` for them (it will `404`). Instead route the
attendant to the "register new customer" flow, §4.4 below.

### `GET /mobile/customers/:id` — QR code lookup

The QR code shown on a customer's profile in the web admin app is a full
URL, not a bare id — as of 2026-08-27 (see below for what changed and
why). Scan it, extract the customer id from it, and call this endpoint
with that id to get back the same `Customer` shape as every other
customer-returning endpoint. `404` if the id doesn't exist.

**⚠️ Action required — the QR payload format changed.** It used to be
just the bare customer id as plain text; it's now a URL shaped like:

```
https://loyalty-points-413d5.web.app/qr/<customerId>
```

**Take the id as everything after the last `/`.** That's it — no need to
parse the URL as a URL, validate the host, or handle query
strings/fragments (there aren't any). Concretely: split the scanned
string on `/` and take the last segment. This also means old-format QR
codes (a bare id, no slashes at all) keep working unchanged with the
exact same one-line logic, so there's no "detect which format" branching
needed.

**Why the payload changed:** so that scanning a customer's QR code with
some *other* app (a generic camera/QR reader, not ours) does something
sensible instead of just displaying a meaningless id string — Firebase
Hosting redirects any `/qr/*` path straight to
`https://greenwellsenergies.com/our-products-services/`. Our own app
never actually requests that URL — it just reads the same text off the
camera and parses the id out of it locally, same as always.

### `GET /mobile/customers/nfc/:tagId` — NFC tap lookup

Resolves a tapped NFC tag's UID to a customer. Staff assign a tag to a
customer once, from the web admin (Customer profile → "NFC tag ID"
field) — there's no in-app flow for Android to register a tag itself.
`404` if no customer has that tag assigned. Tag IDs are matched the same
way as badge login above: uppercased with all non-alphanumeric characters
(colons, dashes, spaces) stripped before comparing, so it doesn't matter
whether the UID was typed into the web admin with separators or not — send
the raw tag content as-is, this one hasn't changed and isn't a URL.

Neither of these two endpoints is station-scoped — same as phone search,
a customer can be selected at any station.

### `GET /mobile/customers?cursor=<value>&limit=<value>&updatedSince=<ISO8601>`

Full or incremental customer sync — use this to cache the whole customer
master list on login (and periodically thereafter) instead of sweeping
`customers/search` across every phone prefix. Not station-scoped: loyalty
customers aren't tied to a single station, same as `customers/search`.

```json
{
  "items": [ /* Customer[], same shape as customers/search */ ],
  "nextCursor": "someCustomerDocId"
}
```

- `limit` — optional, default 500, max 1000. At under 1,000 total loyalty
  customers, a single call with the default limit is enough for a full
  sync; `nextCursor` is `null` once you've reached the end.
- `cursor` — optional, pass back the previous response's `nextCursor` to
  get the next page. Omit for the first page.
- `updatedSince` — optional ISO8601 timestamp. After an initial full pull,
  pass the time of that pull (or the latest `updatedAt` you've cached) to
  get only customers changed since then — cheaper than a full re-pull for
  periodic refreshes.
- Results are ordered by `updatedAt` (not name) — this is what makes
  `updatedSince` filtering possible without a second index, and doesn't
  matter for a cache-the-whole-list use case.

### `GET /mobile/prices/current`

Same `prices` array as in bootstrap, standalone — use to refresh prices
mid-shift without re-pulling the whole bootstrap payload.

### `POST /mobile/sales` — record a sale (online path)

For an **existing** customer only.

```json
{
  "customerPhone": "0712345678",
  "product": "PMS",
  "amountPaid": 2068,
  "stationId": "<attendant's own assignedStationId>",
  "saleDate": "2026-08-20T09:15:00.000Z",
  "idempotencyKey": "<client-generated UUID>",
  "clientLocalId": "<optional local DB row id>",
  "claimedPricePerLitre": 194.5,
  "claimedCashbackEarned": 21.0
}
```

Field notes:
- `stationId` **must** equal the attendant's own `assignedStationId`
  (from bootstrap) — sending anything else is a `400`. There's no benefit
  to hardcoding this; always read it from the stored attendant principal.
- `idempotencyKey`: **client-generated UUID, required.** This is also used
  as the Firestore document ID for the sale, so retry-safety is built in —
  submitting the same key twice returns the original sale rather than
  creating a duplicate. Generate one UUID per sale attempt and reuse it on
  retry; never generate a new one for a retry of the same logical sale.
- `saleDate`: optional, defaults to server "now" if omitted. **Always send
  the actual time the sale happened** (especially for offline-queued
  sales synced later) — pricing and cashback are calculated using
  whatever price was active at `saleDate`, not at submit time, so backdated
  syncs stay historically accurate.
- `claimedPricePerLitre` / `claimedCashbackEarned`: optional, **only
  meaningful for the sync path** (§5) — the values the app calculated
  locally for its own on-device preview. Not required for the plain online
  `POST /mobile/sales` call, but harmless to always send if the app already
  computes them.
- `amountPaid` must be a positive number (KES paid, not litres).

Returns a `Sale`:

```json
{
  "id": "...",
  "customerId": "...",
  "customerPhoneAtSale": "+254712345678",
  "product": "PMS",
  "amountPaid": 2068,
  "stationId": "...",
  "stationNameAtSale": "Kisumu 1",
  "attendantId": "...",
  "attendantNameAtSale": "Jane Otieno",
  "saleDate": "2026-08-20T09:15:00.000Z",
  "snapshot": {
    "litres": 10.633,
    "wholeLitres": 10,
    "pricePerLitre": 194.5,
    "cashbackRatePerLitre": 2,
    "cashbackEarned": 20
  },
  "specialRateIdAtSale": null,
  "idempotencyKey": "...",
  "clientLocalId": "...",
  "source": "android",
  "smsStatus": "pending",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Cashback is earned per **whole litre** (`wholeLitres`, floor of `litres`)
at `cashbackRatePerLitre` — normally KES 2/litre, or a customer's active
special rate if one applies at `saleDate`. The customer gets an SMS
confirmation automatically (server-side, fire-and-forget) — nothing for
Android to do there.

Errors to handle specifically:
- `404` — customer not found for that phone → send to the registration
  flow (§4.4) instead.
- `400` "No active price is set for ..." → block the sale, tell the
  attendant to contact their supervisor (means the org hasn't set a price
  for that product).
- `400` "Attendants may only record sales at their assigned station" →
  should never happen if `stationId` is always read from the stored
  principal; treat as a client bug if seen.

### `POST /mobile/sync` — bulk offline sync

Once connectivity returns, flush a queue of sales that were recorded
offline. **This never fails the whole batch for one bad record** — every
item gets its own definite result.

```json
{
  "sales": [
    { "customerPhone": "...", "product": "PMS", "amountPaid": 2068, "stationId": "...", "saleDate": "...", "idempotencyKey": "...", "clientLocalId": "local-row-17", "claimedPricePerLitre": 194.5, "claimedCashbackEarned": 20 }
  ]
}
```

Max **500** sales per sync call — batch larger local queues into multiple
calls. Same field rules as `POST /mobile/sales`, but here
`claimedPricePerLitre`/`claimedCashbackEarned` matter: they're compared
against what the server actually calculated, and if they disagree by more
than 0.005, the result is flagged `needs_review` (still recorded — never
silently dropped) instead of `accepted`. This is how a stale on-device
price cache (e.g. prices changed while the attendant was offline) gets
surfaced without blocking the sale.

Response:

```json
{
  "results": [
    {
      "clientLocalId": "local-row-17",
      "idempotencyKey": "...",
      "result": "accepted",
      "saleId": "..."
    }
  ]
}
```

`result` is one of:
- `accepted` — recorded cleanly.
- `needs_review` — recorded, but the client's cached price/cashback preview
  disagreed with the server's authoritative calculation. Show the
  attendant/supervisor something changed; don't treat as a failure.
- `already_processed` — this `idempotencyKey` was already synced before
  (safe to mark the local row as synced and move on — this is the expected
  outcome of retrying a sync call that partially succeeded).
- `rejected` — a real failure (`errorReason` explains why — e.g. "No
  customer found for ...", bad price state). Surface `errorReason` to the
  attendant; **do not auto-retry a rejected row** as-is, since retrying an
  unchanged payload will reject again — the underlying issue (e.g. missing
  customer) needs fixing first.

Match `clientLocalId` back to the local queue row to update its sync
status — it's exactly what was sent (falls back to `idempotencyKey` if
you don't send one).

### `GET /mobile/sync-status`

Returns the most recent 50 sync attempts for the logged-in attendant
(server-persisted audit trail — `SyncOperation[]`, same `result`/
`errorReason` shape as above). Useful for an in-app "sync history" screen
or for reconciling local state against the server's record of what it
actually processed, independent of whatever the local DB thinks happened.

### `POST /mobile/customer-registrations` — new customer + their first sale

Use this **instead of** `POST /mobile/sales` when `customers/search`
returned nothing for the phone number. It does **not** create the
customer or sale immediately — it creates a pending request that a
Station Supervisor (for that station), RTSM, or Admin must approve from
the web app before anything lands in the real `customers`/`sales`
collections.

```json
{
  "customerFullName": "John Kamau",
  "customerPhoneNumber": "0712345678",
  "product": "PMS",
  "amountPaid": 2068,
  "saleDate": "2026-08-20T09:15:00.000Z",
  "idempotencyKey": "<client-generated UUID>"
}
```

- `stationId` is **not** a field here — the request is automatically
  stamped with the attendant's own `assignedStationId`.
  server-side.
- `saleDate` optional, same "always send the real time" guidance as §4.3.
- Response is the created `CustomerRegistrationRequest` (`status: "pending"`
  initially). The `snapshot` on it is a **preview only** — the
  authoritative cashback snapshot is recalculated at approval time using
  the same `saleDate`, so approval can be delayed without losing pricing
  accuracy.
- There's no cashback earned yet from Android's point of view until
  approved — don't show it as confirmed in the UI, show it as "pending
  approval."
- If the attendant is offline when this would be called, queue it locally
  like a sale and retry when connectivity returns — there is currently
  **no bulk-sync endpoint for registrations** (only `/mobile/sync` for
  sales), so retry this one individually.

### `GET /mobile/daily-summary?date=YYYY-MM-DD`

Optional `date` (defaults to today, server's UTC "today" if omitted).
Returns that attendant's station's reconciliation rows for the day —
useful for an end-of-shift summary screen.

### `GET /mobile/sales/mine?date=YYYY-MM-DD`

Same `date` default. Returns up to 200 of the attendant's own sales for
that day, standard paginated shape (`{ items, page, pageSize, total,
nextCursor }`) — use for a "my sales today" list/receipt-lookup screen.

## 5. Offline-first design summary

The API is built assuming Android queues sales locally and syncs in
batches — the whole shape of `/mobile/sync` (per-item results, idempotency
keys, stale-cache detection) exists for this. Recommended flow:

1. On login, call `/mobile/bootstrap`, cache `station` + `prices` locally.
2. Record sales locally with a generated UUID `idempotencyKey` and, if
   online, submit immediately via `POST /mobile/sales`; if offline, queue.
3. When connectivity returns, flush the queue via `POST /mobile/sync` in
   batches of ≤500, using each row's original `idempotencyKey` — never
   regenerate it on retry.
4. Update each local row from the per-item `result` in the response, not
   just from "the HTTP call succeeded" — a 200 response can still contain
   individually rejected rows.
5. Re-pull `/mobile/bootstrap` periodically (e.g. on app resume, or every
   few hours) to catch price changes — the `claimedPricePerLitre`/
   `claimedCashbackEarned` fields are what let the server tell you when a
   cached price went stale mid-queue.
6. **For syncing with nobody logged in** (added 2026-09-01): retain each
   attendant's `refreshToken` on-device, per session, even after they're
   logged out of the UI. When connectivity returns and an access token has
   expired, silently call §3.1c to mint a fresh one for that attendant,
   then flush their queue as in step 3. Do this **once per attendant** —
   don't try to merge multiple attendants' queued sales into a single
   `/mobile/sync` call; the whole batch in one call is always attributed
   to whichever token made that call, there's no per-item attendant field.
   Discard a session's retained `refreshToken` once its queue is fully
   synced (`accepted`/`already_processed`/`rejected` for every row).

## 6. What Android does **not** need to worry about

- Staff-style manual token management beyond what §3.1c above already
  covers — refreshing is one call, no separate concept to build.
- No station/attendant selection UI — both are fixed to the logged-in
  attendant and returned by bootstrap/login.
- No direct Firestore access — everything goes through this REST API.
- No customer creation UI outside the registration-request flow — a plain
  "create customer" endpoint exists on the admin side but is not part of
  the mobile surface, by design (all new customers from the field go
  through supervisor approval).
