# Data & Import

Already implemented: XP CSV multi-file import, deterministic dedup, auto-categorize on import.

## Features

- [x] **More bank parsers** — Nubank CSV + a generic CSV parser with user-defined column mapping (covers Inter, Bradesco, C6, etc.).
- [x] **Import preview** — show parsed rows and matched categories before committing; let the user fix parsing edge cases.
- [x] **Column mapping UI** — for unknown CSV layouts, let the user map columns (date/amount/establishment) manually.
- [x] **Undo import** — delete an import (and cascade its transactions) from the invoices list with a confirmation.
- [x] **Folder import** — drop a whole folder of CSVs onto the import page to import them all at once.
- [x] **Import history log** — who/when/how many rows, skipped counts, and errors per import.
- [x] **Backup & restore** — export all data (transactions, categories, budgets, invoice status) to JSON; restore from a backup file.
- [x] **Multi-currency support** — transaction currency + conversion rate, with reporting in BRL.
- [x] **Time of day parsing** — capture hour/minute when the source provides it (unlocks heatmap insights).
- [x] **Data validation report** — after import, flag suspicious rows (zero amounts, dates in the future, giant amounts).
