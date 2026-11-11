# Invoice & Card Control

## Implemented

- [x] **Paid/unpaid status per invoice** — `imports` has `paid`/`paid_at`; `PATCH /api/invoices/{id}/paid` toggles it; status exposed in `/api/invoices` and `/api/dashboard/invoices`.
- [x] **Invoices page** — `/invoices` route listing every invoice: reference month, total, status toggle, due-date urgency badge (overdue / due / open / paid), MoM variation.
- [x] **Invoice detail view** — clicking an invoice expands: full transaction list, spending by category, installment info per transaction.
- [x] **Installments overview** — active installments grouped by establishment with monthly amount, progress (x/y), and remaining value.
- [x] **Dashboard invoice-status summary** — strip with open total, overdue count/amount, next due date.

## More features

- [ ] **Due-date calendar** — calendar view of all invoice due dates and recurring charges, with paid/open coloring.
- [ ] **Payment reminders** — configurable in-app reminders N days before an invoice due date (and when overdue).
- [ ] **Invoice notes** — free-text note per invoice (e.g., how it was paid, disputed charges).
- [ ] **Credit limit & utilization** — store limit per card/holder; show utilization % per invoice and combined, with a 30% threshold warning.
- [ ] **Minimum payment tracking** — record the bank's minimum due vs actual payment; show what was paid each month.
- [ ] **Partial payments** — track multiple payments against one invoice instead of a single paid flag.
- [ ] **Invoice timeline** — per-card timeline of statement totals with paid markers and due-date markers.
- [ ] **Card comparison** — when multiple cards exist, side-by-side totals/utilization/paid status.
- [ ] **Forecast invoice close** — project the current open month's invoice from spending to date.
- [ ] **Payment sequencing hint** — order unpaid invoices by urgency (overdue → due soon → largest).
