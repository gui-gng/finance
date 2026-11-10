# Credit Card Invoice Control

Goal: turn the raw list of imported faturas into an actionable invoice workflow — what is open, what is overdue, what changed month over month, and what installments are still running.

Inspired by multi-card dashboard best practices (consolidated invoice view, due-date urgency indicators, paid status, utilization-style KPIs).

## Features

- [ ] **Paid/unpaid status per invoice** — `imports` table gains `paid`/`paid_at` columns (auto-migrated); `PATCH /api/invoices/{id}/paid` toggles it; status exposed in `/api/invoices` and `/api/dashboard/invoices`.
- [ ] **Invoices page** — new `/invoices` route listing every invoice: reference month, total, payment status toggle, due-date urgency badge (overdue / due this month / paid), and month-over-month variation vs the previous invoice.
- [ ] **Invoice detail view** — clicking an invoice expands it: full transaction list, spending by category, and installment progress for that statement.
- [ ] **Installments overview** — section listing active installments (where `installment_number < installment_total`) grouped by establishment: monthly amount, installment progress (x/y), category, and holder.
- [ ] **Dashboard invoice-status summary** — strip on the dashboard with total open (unpaid) invoice amount, overdue invoice count, and the next due date.
