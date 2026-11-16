# Transactions

Already implemented: paginated list, filters (person/source/invoice/category/holder/type/search/date range), presets.

## Features

- [x] **Manual transaction entry** — add a one-off expense or payment by hand (date, establishment, amount, holder, category).
- [x] **Inline edit** — click a transaction's category/establishment/amount to fix it without leaving the list.
- [x] **Bulk recategorize** — select many rows and assign a category at once.
- [x] **Split transaction** — split one charge across multiple categories (e.g., a market purchase part food, part home).
- [x] **Notes & tags** — free-text note and colored tags per transaction; filter by tag.
- [x] **Merchant merge/rename** — normalize establishment names ("IFOOD*123" → "iFood") and remember the mapping.
- [x] **Duplicate review** — screen showing near-duplicate transactions (same merchant/amount/date ±1 day) for merging.
- [x] **CSV export** — download the current filtered view as CSV.
- [x] **Receipt attachment** — upload a receipt image/PDF linked to a transaction.
- [x] **Installment timeline view** — for a selected installment purchase, show all past/future parcels across invoices.
- [x] **Refund pairing** — match a negative entry to its original expense so reports net correctly.
- [x] **Hide internal transfers** — collapse the "Pagamento fatura" vs payment pairs so they don't distort expense charts.
- [x] **Saved filter views** — name and persist common filter combinations (e.g., "Wife's card, last quarter").
- [x] **Larger page sizes / virtual scroll** — handle thousands of rows smoothly with configurable page size.
