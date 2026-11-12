#!/usr/bin/env sh
# Copy one freshly built APK from mobile/android into apk-portal/apks under its
# public name. Usage: sh apk-portal/publish.sh user [release]
set -e
APP="${1:?usage: publish.sh <user|agent|management|admin> [release]}"
MODE="${2:-debug}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/mobile/android/app/build/outputs/apk/$MODE/app-$MODE.apk"
[ -f "$SRC" ] || { echo "missing $SRC — build it first"; exit 1; }
cp "$SRC" "$ROOT/apk-portal/apks/boostpay-$APP.apk"
ls -lh "$ROOT/apk-portal/apks/boostpay-$APP.apk"
echo "now: git add apk-portal/apks && git commit && git push"
