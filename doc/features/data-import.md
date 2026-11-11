# Data & Import

Already implemented: XP CSV multi-file import, deterministic dedup, auto-categorize on import.

## Features

- [ ] **More bank parsers** — Nubank (PDF/CSV), Inter, Bradesco, C6 statement formats selectable at import time.
- [ ] **Import preview** — show parsed rows and matched categories before committing; let the user fix parsing edge cases.
- [ ] **Column mapping UI** — for unknown CSV layouts, let the user map columns (date/amount/establishment) manually.
- [ ] **Undo import** — delete an import (and cascade its transactions) from the invoices list with a confirmation.
- [ ] **Folder auto-import** — watch `data/gui/xp/` for new files and import them with one click from the UI.
- [ ] **Import history log** — who/when/how many rows, skipped counts, and errors per import.
- [ ] **Backup & restore** — export all data (transactions, categories, budgets, invoice status) to JSON; restore from a backup file.
- [ ] **Multi-currency support** — transaction currency + conversion rate, with reporting in BRL.
- [ ] **Time of day parsing** — capture hour/minute when the source provides it (unlocks heatmap insights).
- [ ] **Data validation report** — after import, flag suspicious rows (zero amounts, dates in the future, giant amounts).
