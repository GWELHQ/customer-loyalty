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
2. **Switched OCR mode.** Detection was calling Cloud Vision's
   `textDetection` (general "find any text in a scene" mode). Switched to
   `documentTextDetection` (structured/dense-text mode) — plates are
   small, high-contrast, structured text blocks, and this mode's layout
   analysis is noticeably better at correctly grouping the stacked
   two-line square-plate style than the general mode was.

Implementation: `apps/api/src/vehicle-plate-checks/vision-ocr.service.ts`.

If you're still seeing consistent `null` results after this date, that's
a new issue, not the one already fixed — grab the failing check's
`imageUrl` (a `gs://...` pointer into the `vehicle-plate-checks` bucket)
and we can pull the exact file Vision saw.
