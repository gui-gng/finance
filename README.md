# Finance

Personal finance tracker: parses credit card statements (XP CSV faturas), stores them in PostgreSQL, and visualizes spending in an Angular dashboard.

## Architecture

| Component | Technology | Port |
|-----------|-----------|------|
| [frontend](frontend) | Angular 18 + Chart.js (ng2-charts) | 4200 |
| [backend](backend) | Go API (Dockerized) | 8080 |
| [infra](infra) | PostgreSQL 16 + pgAdmin 4 | 5433 / 5050 |
| [data](data) | Source CSV statements (XP faturas) | — |

The backend connects to Postgres over the external Docker network `finance-infra` (created by `infra/docker-compose.yml`). Postgres is exposed on host port **5433** (instead of 5432) to avoid conflicts with other local Postgres instances.

## Quick start

Prerequisites: Docker and Node.js/npm.

```bash
./start.sh
```

That's it — the script starts the database, builds and launches the backend, and serves the frontend. Then open:

- **App**: http://localhost:4200
- **API**: http://localhost:8080
- **pgAdmin**: http://localhost:5050 (admin@finance.com / admin)

Press `Ctrl+C` to stop the frontend (backend and database keep running in Docker).

### Manual start

```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres + pgAdmin
docker compose up -d --build                       # Go backend
cd frontend && npm start                           # Angular dev server
```

### Stop everything

```bash
docker compose down                 # backend
docker compose -f infra/docker-compose.yml down   # Postgres + pgAdmin
```

## Project layout

```
.
├── backend/          Go API (cmd/api, Dockerfile)
├── frontend/         Angular app
├── infra/            docker-compose for Postgres + pgAdmin
├── data/gui/xp/      Credit card statement CSVs
├── docker-compose.yml  Backend service
└── start.sh          One-command startup
```

## License

[MIT](LICENSE)
