# AGENTS.md

Compact, repo-specific facts. Read `README.md` for user-facing docs.

## Commands

- Start everything: `./start.sh` (infra → backend build → `npm start` in foreground; Ctrl+C stops only the frontend).
- Backend runs in Docker only; rebuild after Go changes with `docker compose up -d --build` from repo root. **Check the build output — a failed build leaves the old container running and `up -d` won't error.**
- No tests, no linter, no CI exist in this repo. Verify the backend with `curl localhost:8080/api/health` (root `/` returns 404 — that is normal).
- Frontend has only `npm start` and `npm build`; no test/lint scripts.

## Gotchas

- **Auth is required**: all `/api/*` routes except `/api/health` and `/api/auth/login` need `Authorization: Bearer <token>`. Login: POST `/api/auth/login` `{"password": "..."}` (password from `FINANCE_PASSWORD` env, default `finance`; token = SHA-256 of `finance-token::<password>`). The frontend stores it in localStorage as `finance-token`; 401 responses redirect to `/login`.
- Postgres host port is **5433** (another local project owns 5432). The backend talks to `postgres:5432` on the internal Docker network `finance-infra`, so only host-side psql/pgAdmin connections need 5433.
- pgAdmin (port 5050) rejects `.local` emails — login is `admin@finance.com` / `admin`. Never revert to `admin@finance.local`; the container crash-loops.
- CORS allows only `http://localhost:4200`; the API base is `window.__API_BASE__` fallback `http://localhost:8080/api` (api.service.ts).
- No generated code, no migrations directory — the Go backend auto-migrates on startup via `db.Migrate()` (schema constant in db.go, additive-only `ALTER TABLE ... IF NOT EXISTS`).
- Invoice reference dates are parsed from filenames (e.g. `Fatura2024-01-10.csv` → 2024-01-10), not from CSV contents.
- Dedup: transaction UUIDs are deterministic (v5 from import + row data); re-importing the same file skips duplicates. If an import inserts 0 rows, the import row is deleted.
- Manual transactions live in a synthetic `imports` row (`filename = 'manual'`) to satisfy the FK.
- Dashboard layout/widgets/pins persist in localStorage key `dashboard-layout`; app settings in `finance-settings`; login token in `finance-token`.
- Receipts are stored in the container's temp dir — lost on container recreation (feature is best-effort).
- `excluded` transactions (refund pairs, transfers) are hidden from all dashboard/report queries by default; pass `include_excluded=1` to see them.

## Layout

- `backend/cmd/api/` — single Go package: `main.go` (routes + auth middleware), `handlers.go` (core handlers), `features.go` (transactions CRUD, budgets, insights, invoices extras, backup/restore, auth), `db.go` (schema/migrate), `parser.go` (XP/Nubank/mapped CSV), `categories.go`. Parsers: `xp`, `nubank`, `mapped` (column_map JSON form field).
- `frontend/src/app/` — standalone Angular components, one file per feature: dashboard, transactions, invoices, insights, budgets, categories, import, filters, settings, login. Shared: `services/` (settings, toast, i18n, auth), `money.pipe.ts`. All API calls go through `api.service.ts`.
- `doc/features/` — feature specs, all implemented (marked `[x]`).
- `data/gui/xp/` — source CSV faturas tracked in git.
