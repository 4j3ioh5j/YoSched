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

echo "--- restart service"
systemctl --user restart yosched-app
sleep 3

echo "--- verify"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)
if [ "$STATUS" = "200" ]; then
  echo "==> Deploy successful (login page returns 200)"
else
  echo "==> WARNING: login page returned $STATUS"
  systemctl --user status yosched-app | head -10
  exit 1
fi
REMOTE
