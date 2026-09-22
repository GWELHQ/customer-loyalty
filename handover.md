# Android change needed: sale-confirmation SMS template updated

## What changed
The sale-confirmation SMS text now includes the amount paid for *this*
sale (not a cumulative figure). Android composes and sends this SMS
itself directly via Africa's Talking (the backend never sends SMS for an
attendant-sourced sale, `source: "android"`) — see
`docs/ANDROID-HANDOVER.md`, the section right after the `POST
/mobile/sales` response shape, which now documents this in full. That
section was previously wrong — it said "nothing for Android to do there"
for SMS, which is not true; that's fixed now too.

**Old template:**
```
Green Wells: You earned KES {cashbackEarned} cashback. Your total this month is KES {monthToDateCashback}.
```

**New template — update the Android app to send this instead:**
```
Green Wells: You paid KES {amountPaid} and earned KES {cashbackEarned} cashback. Your total cashback this month is KES {monthToDateCashback}.
```

## Details
- All three amounts rounded to the nearest whole KES.
- `amountPaid` is this sale's own amount (already present on the `POST
  /mobile/sales` response body — same field used to record the sale).
- `monthToDateCashback` is the only cumulative figure in the message —
  already present on the response too (added specifically so the app
  doesn't need a separate call to compute it).
- Unchanged: skip sending entirely when `cashbackEarned` is `0` — nothing
  worth texting the customer about.
- Unchanged: after sending, report the outcome via `POST
  /mobile/sales/:id/sms-status` (`{ success, providerResponse?,
  errorReason? }`) so `sale.smsStatus` and the audit trail stay accurate.

## Backend changes already made (for reference, no action needed here)
- `apps/api/src/sms/sms.service.ts` — `buildSaleConfirmationMessage` now
  takes `amountPaid` and builds the new template. Used for sales created
  manually through the web portal (the only case the backend itself sends
  SMS for).
- `apps/api/src/sales/sales.service.ts` and
  `apps/api/src/mobile/mobile.controller.ts` — updated to pass
  `amountPaid` through to the above.
