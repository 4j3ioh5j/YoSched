#!/usr/bin/env bash
set -euo pipefail

STAGING_HOST="david@dph-devbox-yosched-staging"
DEPLOY_DIR="YoSched"
SERVICE_NAME="yosched-app"

echo "==> Running test gate..."
pnpm test:fast || { echo "ABORT: test:fast failed — fix before deploying"; exit 1; }

echo "==> Pushing to GitHub..."
git push

echo "==> Deploying on staging..."
ssh "$STAGING_HOST" "bash -s" << 'REMOTE'
set -euo pipefail
cd ~/YoSched

echo "--- git pull"
git pull --ff-only

echo "--- pnpm install"
pnpm install --frozen-lockfile

echo "--- prisma generate"
npx prisma generate

echo "--- build"
pnpm build

echo "--- link static assets into standalone"
ln -sf ../../static .next/standalone/.next/static
ln -sf ../../public .next/standalone/public

# Run migrations LAST, immediately before restart. For a destructive
# (column-drop) migration the still-running old process queries the old schema;
# applying the drop only after the (slow) build — right before the (fast)
# restart — shrinks the window where the live process sees a migrated schema
# from the whole build down to a couple of seconds. The new client/build ignore
# the soon-to-be-dropped columns, so building against the pre-migration DB is safe.
echo "--- prisma migrate"
npx prisma migrate deploy

# Idempotent permission backfills — keep stored group permission arrays in sync with
# the catalog (a new permission isn't granted to existing/locked groups otherwise).
# Each skips groups that already have the permission, so this is safe every deploy.
echo "--- backfill group permissions"
pnpm backfill:manual-permission

echo "--- restart service"
systemctl --user restart yosched-app
sleep 3

echo "--- verify"
# App is served under the /yosched basePath now, so the origin login page lives at
# /yosched/login (bare /login 404s). First confirm the bare root 404s — that proves
# basePath actually took effect rather than silently serving at root.
ROOT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)
if [ "$ROOT_STATUS" != "404" ]; then
  echo "==> WARNING: bare /login returned $ROOT_STATUS (expected 404) — basePath may not have taken effect"
  systemctl --user status yosched-app | head -10
  exit 1
fi
STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/yosched/login)
if [ "$STATUS" = "200" ]; then
  echo "==> Deploy successful (bare /login 404s, /yosched/login returns 200)"
else
  echo "==> WARNING: /yosched/login returned $STATUS"
  systemctl --user status yosched-app | head -10
  exit 1
fi
REMOTE
