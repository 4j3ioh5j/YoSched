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
