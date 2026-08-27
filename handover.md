# Handover — vehicle-plate OCR fix

Date: 2026-08-26
Audience: Android pump-attendant app team

Two server-side fixes to `POST /mobile/vehicle-plate-checks` plate
detection, both already deployed. No client-side change needed for
either — endpoint request/response shape is unchanged.

1. **Regex didn't match any real plate.** The old matching rule required
   one unbroken 5-8 character alphanumeric run. No real Kenyan plate is
   printed that way — oblong plates have a space between the 3-letter and
   3-digit/letter groups, and square plates stack the two groups on
   separate lines entirely. Cloud Vision's OCR preserves both as
   whitespace, so `detectedPlateNumber` came back `null` on essentially
   every real plate regardless of image quality. Fixed by accepting
   whitespace/hyphens between the groups, covering both plate shapes.
2. **OCR mode.** Briefly tried Cloud Vision's `documentTextDetection`
   (structured/dense-text mode) instead of `textDetection` (general
   "find any text in a scene" mode), on the theory that a plate's
   two-line layout was closer to "document" than "signage." Wrong in
   practice — on a real plate, `documentTextDetection` ignored the huge
   embossed characters entirely and only picked up incidental fine print.
   Reverted to `textDetection`, which is what's live.

Since then, plate-shape support has grown a lot (county, dealer/temp,
diplomatic, pre-1989, and Uganda/Tanzania formats, plus a few correctness
fixes found via real test photos) — none of it changes this endpoint's
contract, so nothing further to flag here. Implementation:
`apps/api/src/vehicle-plate-checks/vision-ocr.service.ts`.

If you're still seeing consistent `null` results after this date, that's
a new issue, not the one already fixed — grab the failing check's
`imageUrl` (a `gs://...` pointer into the `vehicle-plate-checks` bucket)
and we can pull the exact file Vision saw.

---

# Handover — bulk customer list endpoint

Date: 2026-08-26

In response to the request to replace the phone-prefix-sweep sync hack:
`GET /mobile/customers?cursor=&limit=&updatedSince=` now exists,
attendant-scoped like the rest of `/mobile/*`, unscoped by station, same
`Customer` shape as `customers/search`. Default/max `limit` is 500/1000 —
one call covers the whole customer base at current volume. `updatedSince`
(ISO8601) supports incremental syncs after the first full pull. Full
details in `docs/ANDROID-HANDOVER.md` under
"`GET /mobile/customers?cursor=...`".

---

# Handover — ⚠️ breaking: license plate is now a list

Date: 2026-08-27

**Action required if your app reads `licensePlateNumber` anywhere** (e.g.
displaying it after a vehicle-plate-check, or comparing it client-side).
A customer can now have more than one vehicle on file, so every
`Customer`-returning endpoint (`customers/search`, `customers/:id`,
`customers/nfc/:tagId`, and the new bulk `GET /mobile/customers`) has:

- **Removed:** `licensePlateNumber: string | undefined`
- **Added:** `licensePlateNumbers: string[] | undefined` — absent or `[]`
  means none on file, same "absent means not set" convention as before.

Nothing else about the vehicle-plate-check flow changes — same
`POST /mobile/vehicle-plate-checks` request/response shape, same
`plateCheckId` handoff into `POST /mobile/sales`/`sync`, same
never-blocks-the-sale behavior. The backend now matches a detected plate
against *any* of the customer's plates, not just one.

---

# Handover — attendant login via RFID/NFC badge

Date: 2026-08-27

New second way to log an attendant in, alongside the existing employeeId
+ PIN flow — reuses the same tag-lookup pattern already built for
customer NFC selection.

```
POST /auth/attendant/nfc-login
Body: { "tagId": "<raw UID read off the tapped badge>" }
```

Same response shape, same session type/TTL, same rate limit as PIN
login — full details in `docs/ANDROID-HANDOVER.md` §3.1b. Confirmed with
you (Phil) before building: **this is tap-only, no PIN required** — the
badge UID alone is the credential. That's a deliberately weaker
guarantee than a PIN (a lost/stolen/cloned badge is a valid login until
an Admin unassigns it), accepted for speed at the pump. Both login
methods stay fully available side by side; PIN login is completely
unchanged.

Badges are assigned to attendants by an Admin in the web admin app
(Attendants → Edit → "RFID/NFC badge UID") — same uniqueness/normalization
rules as customer NFC tags, just a separate namespace (an attendant's
badge and a customer's loyalty-card tag are independent, so the same
physical UID could theoretically exist in both without conflict, though
that'd be an unusual coincidence in practice).

Every badge login is audit-logged as `auth.attendant_nfc_login`,
distinct from `auth.attendant_login` (PIN), so a lost-badge incident is
traceable after the fact.

Verified end-to-end against production data before shipping: unregistered
tag → `401`, registered tag → valid session that successfully
authenticates against a real protected route, audit trail correct,
`lastLoginAt` updates.

Implementation: `apps/api/src/attendants/attendants.service.ts`
(`verifyByNfcTag`), `apps/api/src/auth/auth.service.ts`
(`loginAttendantByNfcTag`).

---

# Handover — ⚠️ breaking: customer QR code payload changed

Date: 2026-08-27

**Action required if your app scans the customer QR code.** It used to
encode a bare customer id as plain text; it now encodes a full URL:

```
https://loyalty-points-413d5.web.app/qr/<customerId>
```

**Fix is one line:** take everything after the last `/` in the scanned
string — that's the customer id, same as before. Old-format QR codes (no
slashes) keep working unchanged with that exact same logic, so this
isn't a "detect the format" branch, just a strictly more general way to
extract the id that happens to also handle the new format.

**Why:** so a customer scanning their own QR with a random camera/QR app
(not ours) lands somewhere useful — Firebase Hosting now redirects any
`/qr/*` path to `https://greenwellsenergies.com/our-products-services/`
— instead of just seeing a bare id string with no context. Our app never
requests that URL itself; it reads the same camera text as always and
parses the id out locally.

Full details, including the exact one-line extraction and the (also
newly-documented) NFC lookup endpoint: `docs/ANDROID-HANDOVER.md`, "§
`GET /mobile/customers/:id` — QR code lookup".

---

# Handover — NFC tag matching now ignores separators

Date: 2026-08-27
Audience: Android pump-attendant app team

In response to your report that `POST /auth/attendant/nfc-login` and
`GET /mobile/customers/nfc/{tagId}` weren't matching two test tags even
though the phone read them fine: both routes exist, are deployed, and
were already documented (§3.1b and the NFC tap lookup section of
`docs/ANDROID-HANDOVER.md`) — if you were seeing otherwise, you were
likely reading a copy of the doc from before those sections landed.

The real bug: tag matching used to be trim + uppercase only, with no
separator handling. Our two test records had been registered through the
web admin's free-text UID field as `F9:45:EF:A2` and `89:65:32:99`
(colon-separated, as a human would type a UID), while `NfcTagReader.kt`
sends unseparated hex (`F945EFA2`, `89653299`) — two different strings to
an exact match, so both lookups failed even though the hardware read the
tags correctly.

Fixed properly rather than just patching the two records:
`normalizeNfcTagId()` (`apps/api/src/common/nfc/normalize-nfc-tag-id.ts`)
now strips every non-alphanumeric character before uppercasing, so
`"F9:45:EF:A2"`, `"F9-45-EF-A2"`, and `"F945EFA2"` all normalize to the
same value. Applied identically at registration time and lookup time, for
both attendant badges and customer tags, so this can't recur regardless
of how a UID gets typed into the web admin going forward. The two test
records have also been corrected directly (now stored unseparated) — no
client-side change needed, retest should work now. Docs updated to match
in `docs/ANDROID-HANDOVER.md`.