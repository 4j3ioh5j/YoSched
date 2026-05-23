#!/usr/bin/env bash
set -euo pipefail

STAGING_HOST="david@dph-devbox-yosched-staging"
DEPLOY_DIR="yosched"
SERVICE_NAME="yosched-app"

echo "==> Building..."
pnpm build

echo "==> Backing up staging .env..."
ssh "$STAGING_HOST" "cp ~/$DEPLOY_DIR/.env /tmp/yosched-env-backup 2>/dev/null || true"

echo "==> Syncing standalone output..."
rsync -az --delete .next/standalone/ "$STAGING_HOST:~/$DEPLOY_DIR/"

echo "==> Syncing static assets..."
rsync -az .next/static/ "$STAGING_HOST:~/$DEPLOY_DIR/.next/static/"

echo "==> Syncing public assets..."
rsync -az public/ "$STAGING_HOST:~/$DEPLOY_DIR/public/"

echo "==> Restoring staging .env..."
ssh "$STAGING_HOST" "cp /tmp/yosched-env-backup ~/$DEPLOY_DIR/.env"

echo "==> Restarting service..."
ssh "$STAGING_HOST" "systemctl --user restart $SERVICE_NAME"
sleep 3

echo "==> Verifying..."
STATUS=$(ssh "$STAGING_HOST" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login")
if [ "$STATUS" = "200" ]; then
  echo "==> Deploy successful (login page returns 200)"
else
  echo "==> WARNING: login page returned $STATUS"
  ssh "$STAGING_HOST" "systemctl --user status $SERVICE_NAME | head -10; echo '---'; tail -10 /tmp/yosched.log 2>/dev/null"
  exit 1
fi
