#!/usr/bin/env bash
# Runs the browser e2e flows + responsive layout checks against two local servers.
# Needs: local Postgres (PGURL), a built app (npm run build) and Playwright + Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@127.0.0.1:5433}"
export APP_SECRET="${APP_SECRET:-e2e-secret-e2e-secret-e2e-secret-00}"
for db in ui_demo ui_setup; do
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null
done
rm -rf e2e/out && mkdir -p e2e/out
DATABASE_URL="$PGURL/ui_demo" npx tsx src/scripts/demo-history.ts 30 >/dev/null
DATABASE_URL="$PGURL/ui_demo" npx tsx src/scripts/create-user.ts owner@example.com 'correct-horse-battery' >/dev/null
DATABASE_URL="$PGURL/ui_demo" npx tsx src/scripts/create-user.ts viewer@example.com 'correct-horse-battery' viewer >/dev/null
DATABASE_URL="$PGURL/ui_demo" PORT=3300 node dist/server/main.js > e2e/out/server-demo.log 2>&1 & P1=$!
DATABASE_URL="$PGURL/ui_setup" PORT=3301 SETUP_TOKEN=setup-ui node dist/server/main.js > e2e/out/server-setup.log 2>&1 & P2=$!
trap 'kill $P1 $P2 2>/dev/null || true' EXIT
for port in 3300 3301; do
  for _ in $(seq 1 40); do curl -sf "http://localhost:$port/api/health" >/dev/null && break; sleep 0.5; done
done
node e2e/flows.mjs | tee e2e/out/flows.txt
# flows change the owner password; restore it for the layout pass
DATABASE_URL="$PGURL/ui_demo" npx tsx src/scripts/create-user.ts owner@example.com 'correct-horse-battery' >/dev/null
psql "$PGURL/ui_demo" -qc "DELETE FROM login_attempts" >/dev/null
node e2e/layout.mjs > e2e/out/layout.txt; tail -1 e2e/out/layout.txt
node e2e/a11y.mjs
