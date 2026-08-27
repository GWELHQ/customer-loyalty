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