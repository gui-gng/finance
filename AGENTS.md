# AGENTS.md

Compact, repo-specific facts. Read `README.md` for user-facing docs.

## Commands

- Start everything: `./start.sh` (infra → backend build → `npm start` in foreground; Ctrl+C stops only the frontend).
- Backend runs in Docker only; rebuild after Go changes with `docker compose up -d --build` from repo root.
- No tests, no linter, no CI exist in this repo. Verify the backend with `curl localhost:8080/api/health` (root `/` returns 404 — that is normal).
- Frontend has only `npm start` and `npm build`; no test/lint scripts.

## Gotchas

- Postgres host port is **5433** (another local project owns 5432). The backend talks to `postgres:5432` on the internal Docker network `finance-infra`, so only host-side psql/pgAdmin connections need 5433.
- pgAdmin (port 5050) rejects `.local` emails — login is `admin@finance.com` / `admin`. Never revert to `admin@finance.local`; the container crash-loops.
- Frontend hardcodes the API base as `http://localhost:8080/api` (api.service.ts). CORS on the backend allows only `http://localhost:4200`.
- No generated code, no migrations directory — the Go backend auto-migrates on startup via `db.Migrate()`.
- Invoice reference dates are parsed from filenames (e.g. `Fatura2024-01-10.csv` → 2024-01-10), not from CSV contents.
- Dedup: transaction UUIDs are deterministic (v5 from import + row data); re-importing the same file skips duplicates. If an import inserts 0 rows, the import row is deleted.

## Layout

- `backend/cmd/api/` — single Go package: `main.go` (routes), `handlers.go`, `db.go` (schema/migrate), `parser.go` (XP CSV), `categories.go`. Only XP invoices are supported (`source == "xp"` in the import handler).
- `frontend/src/app/` — standalone Angular components, one file per feature: dashboard, transactions, categories, import, filters. All API calls go through `api.service.ts`.
- `data/gui/xp/` — source CSV faturas tracked in git.
