#!/bin/sh
# tools/cf.sh — Cloudflare helper for BoostPay hosts.
#
# The API token lives OUTSIDE the repository so it can never be committed:
#   /home/user/.cloudflare/api_token     (mode 600, dir 700)
# A shell export still wins, so one-off runs are possible:
#   CF_API_TOKEN=... sh tools/cf.sh --dns --target 72.60.42.18 --no-proxied
#
# Examples
#   sh tools/cf.sh                                  # show which host/zone/token-source is active
#   CF_HOST=walletagent.boostpay.online sh tools/cf.sh --full --target 72.60.42.18 --emails me@x.com
#   CF_HOST=walletagent.boostpay.online sh tools/cf.sh --proxied
#
# Never prints the token itself.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
TOKEN_PATH="${CF_TOKEN_FILE:-/home/user/.cloudflare/api_token}"

if [ -z "${CF_API_TOKEN:-}" ] && [ -f "$TOKEN_PATH" ]; then
  CF_API_TOKEN=$(tr -d '\r\n' < "$TOKEN_PATH")
  export CF_API_TOKEN
  export CF_TOKEN_SOURCE="file:$TOKEN_PATH"
else
  export CF_TOKEN_SOURCE="${CF_API_TOKEN:+env}"
fi

# Fallback 2: the token can also live on the Dokploy server (survives a sandbox
# reset). Read over the existing deploy key; nothing is echoed.
if [ -z "${CF_API_TOKEN:-}" ] && [ -z "${CF_API_KEY:-}" ] && [ "${CF_TOKEN_SSH:-1}" = "1" ]; then
  KEY="${CF_SSH_KEY:-/home/user/.ssh/boostpay_vps}"
  HOST="${CF_SSH_HOST:-root@72.60.42.18}"
  if [ -f "$KEY" ]; then
    chmod 600 "$KEY" 2>/dev/null || true
    REMOTE=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new "$HOST" \
      'cat /root/.cloudflare/api_token 2>/dev/null' 2>/dev/null | tr -d '\r\n' || true)
    if [ -n "$REMOTE" ]; then
      CF_API_TOKEN="$REMOTE"
      export CF_API_TOKEN
      export CF_TOKEN_SOURCE="server:$HOST:/root/.cloudflare/api_token"
    fi
  fi
fi

if [ -z "${CF_API_TOKEN:-}" ] && [ -z "${CF_API_KEY:-}" ]; then
  echo "no Cloudflare credential found." >&2
  echo "  save one once:  sh $HERE/cf-token-save.sh   (reads it from stdin, mode 600, outside git)" >&2
  exit 2
fi

export CF_HOST="${CF_HOST:-walletagent.boostpay.online}"
echo "[cf] host=$CF_HOST zone=${CF_ZONE:-boostpay.online} credential=$CF_TOKEN_SOURCE" >&2
exec python3 "$HERE/cf-access-promotion.py" "$@"
