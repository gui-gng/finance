# Transactions

Already implemented: paginated list, filters (person/source/invoice/category/holder/type/search/date range), presets.

## Features

- [ ] **Manual transaction entry** — add a one-off expense or payment by hand (date, establishment, amount, holder, category).
- [ ] **Inline edit** — click a transaction's category/establishment/amount to fix it without leaving the list.
- [ ] **Bulk recategorize** — select many rows and assign a category at once.
- [ ] **Split transaction** — split one charge across multiple categories (e.g., a market purchase part food, part home).
- [ ] **Notes & tags** — free-text note and colored tags per transaction; filter by tag.
- [ ] **Merchant merge/rename** — normalize establishment names ("IFOOD*123" → "iFood") and remember the mapping.
- [ ] **Duplicate review** — screen showing near-duplicate transactions (same merchant/amount/date ±1 day) for merging.
- [ ] **CSV export** — download the current filtered view as CSV.
- [ ] **Receipt attachment** — upload a receipt image/PDF linked to a transaction.
- [ ] **Installment timeline view** — for a selected installment purchase, show all past/future parcels across invoices.
- [ ] **Refund pairing** — match a negative entry to its original expense so reports net correctly.
- [ ] **Hide internal transfers** — collapse the "Pagamento fatura" vs payment pairs so they don't distort expense charts.
- [ ] **Saved filter views** — name and persist common filter combinations (e.g., "Wife's card, last quarter").
- [ ] **Larger page sizes / virtual scroll** — handle thousands of rows smoothly with configurable page size.
