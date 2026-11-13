#!/usr/bin/env sh
# Re-deploy the APK portal on the VPS so a git reset can never break the downloads.
#
#   sh apk-portal/deploy-vps.sh          (run on the server, inside the repo checkout)
#
# Why this exists: the portal used to run as a Dokploy "nixpacks" application. The built
# image did not always carry the APK files, so the page loaded while every download
# answered 404 "Not ready". The portal now runs as a plain container whose APK directory
# is a bind mount OUTSIDE the git checkout, so a deploy can never empty it again.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/apk-portal/apks"
DEST=/opt/boostpay-apks
NAME=boostpay-apk-portal

mkdir -p "$DEST"
cp -f "$SRC"/*.apk "$DEST"/
echo "APKs in $DEST:"
ls -lh "$DEST" | tail -n +2

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  --network dokploy-network --restart unless-stopped \
  -e PORT=3000 -e NODE_ENV=production -e APK_DIR=/apks \
  -w /app \
  -v "$ROOT/apk-portal":/app:ro \
  -v "$DEST":/apks:ro \
  node:20-alpine node server.mjs >/dev/null
sleep 3
docker logs --tail 12 "$NAME"
echo
echo "health:"; docker exec "$NAME" wget -qO- http://127.0.0.1:3000/api/health || true
echo
echo "done — check https://app.boostpay.online/api/health"
