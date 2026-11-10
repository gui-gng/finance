#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Starting infrastructure (Postgres + pgAdmin)..."
docker compose -f infra/docker-compose.yml up -d

echo "==> Starting backend..."
docker compose up -d --build

echo "==> Starting frontend..."
echo "    (Press Ctrl+C to stop the frontend; backend and infra keep running)"
cd frontend
exec npm start
