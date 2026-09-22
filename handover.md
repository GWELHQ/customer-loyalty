# Bug: attendant app can't find a customer that the backend confirms exists

## Symptom
Customer "Michael" (phone `0711816766` / normalized `+254711816766`, current id
`v13Z4yPiAezh1t12ivVn`) is not found in the Android app — neither by typing the
phone number into search nor by scanning their QR code. This is reproducible
after a full app resync (logged out and back in to force a fresh
`GET /mobile/customers` pull) and still fails.

## What's already confirmed NOT the cause (checked server-side, do not re-investigate these)
- The Firestore doc exists, is not soft-deleted, and has a correctly normalized
  `phoneNumber` field (`+254711816766`).
- `GET /mobile/customers/search?phone=711816766` and
  `GET /mobile/customers/v13Z4yPiAezh1t12ivVn` both return **HTTP 200** on the
  live Cloud Run service on every attempt (checked via Cloud Run request logs,
  repeated calls from 10:56 through 12:40 on 2026-09-18, both before and after
  the attendant's resync/re-login).
- No tenant/station scoping excludes this customer — neither endpoint filters
  by station (see `docs/ANDROID-HANDOVER.md`, "Neither of these two endpoints
  is station-scoped").
- QR scanning works fine for other, older customers on this same device, so
  it isn't a QR-format-parsing regression (the 2026-08-27 URL-wrapped QR
  format, documented in `docs/ANDROID-HANDOVER.md` under "QR code lookup", is
  already handled correctly).

**Conclusion: the backend is returning a successful response with the
customer's data every time. The bug is entirely on the Android side** — the
app is either not correctly parsing/applying that response, or something in
its local cache/state is shadowing or overriding it.

## Relevant history (may matter for the local cache angle)
This customer record was deleted and recreated once during troubleshooting
today. There are now two Firestore docs with the same phone number
(`+254711816766`): an older one from 2026-09-10 that is soft-deleted
(`deletedAt` set), and the current active one (`v13Z4yPiAezh1t12ivVn`,
created 2026-09-18) with `deletedAt` absent. The backend's own query logic
correctly filters to the active doc — verified directly against Firestore —
but if the Android app's local store also picked up the old (now-deleted)
record from an earlier sync and keys/dedupes customers by phone number rather
than by id, that stale local record could be shadowing the new one even
after a resync.

## What to check on the Android side
1. Logcat around a repro attempt: confirm the app actually calls
   `customers/search?phone=711816766` or `customers/<id>`, and log the raw
   response body it receives — is the customer object actually present, and
   is the app failing to parse/store/display it?
2. Local DB (Room/SQLite/whatever local cache backs the customer list):
   query for phone `+254711816766` — is there a stale row from before the
   delete/recreate (possibly under the old doc id), and does the sync/upsert
   logic key on phone number in a way that could ignore or conflict with the
   new doc id?
3. Does the full resync (`GET /mobile/customers`) actually clear/replace the
   local table, or does it only upsert by id — which would leave an orphaned
   old row (different id, same phone) that the search/QR UI matches against
   instead of (or in addition to) the new one?
4. Does the search UI query the local cache at all instead of always hitting
   the live `customers/search` endpoint? If so, that's the most likely
   culprit given the server-side evidence above.

## Reference
`docs/ANDROID-HANDOVER.md` — general API contract for `/mobile/customers*`
endpoints (search, QR/id lookup, NFC lookup, full/incremental sync).
