#!/bin/sh
# tools/cf.sh — Cloudflare helper for BoostPay hosts.
#
# Credentials live OUTSIDE the repository so they can never be committed:
#   /home/user/.cloudflare/api_token          (scoped API token, mode 600)
#   /home/user/.cloudflare/api_email + api_key (Global API Key pair, mode 600)
# A shell export still wins, and the Dokploy server is a second vault:
#   /root/.cloudflare/api_token | api_email + api_key
# One-off runs are possible too:
#   CF_API_EMAIL=... CF_API_KEY=... sh tools/cf.sh --verify
#
# Examples
#   sh tools/cf.sh                                  # show which host/zone/token-source is active
#   CF_HOST=walletagent.boostpay.online sh tools/cf.sh --full --target 72.60.42.18 --emails me@x.com
#   CF_HOST=walletagent.boostpay.online sh tools/cf.sh --proxied
#
# Never prints the token itself.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
VAULT="${CF_VAULT_DIR:-/home/user/.cloudflare}"
TOKEN_PATH="${CF_TOKEN_FILE:-$VAULT/api_token}"
EMAIL_PATH="$VAULT/api_email"
KEY_PATH="$VAULT/api_key"

read_file() { [ -f "$1" ] && tr -d '\r\n' < "$1" || true; }

# 1) a scoped API token (past, present or future) ----------------------------
if [ -z "${CF_API_TOKEN:-}" ] && { [ -n "${CF_API_KEY:-}" ] && [ -n "${CF_API_EMAIL:-}" ]; }; then
  export CF_TOKEN_SOURCE="env(global key)"
elif [ -z "${CF_API_TOKEN:-}" ] && [ -f "$TOKEN_PATH" ]; then
  CF_API_TOKEN=$(read_file "$TOKEN_PATH")
  export CF_API_TOKEN
  export CF_TOKEN_SOURCE="file:$TOKEN_PATH"
fi

# 2) the Global API Key pair (email + key) -----------------------------------
if [ -z "${CF_API_TOKEN:-}" ] && { [ -z "${CF_API_KEY:-}" ] || [ -z "${CF_API_EMAIL:-}" ]; }; then
  E=$(read_file "$EMAIL_PATH"); K=$(read_file "$KEY_PATH")
  if [ -n "$E" ] && [ -n "$K" ]; then
    CF_API_EMAIL="$E"; CF_API_KEY="$K"
    export CF_API_EMAIL CF_API_KEY
    export CF_TOKEN_SOURCE="file:$VAULT/api_email+api_key"
  fi
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
    else
      REMAIL=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new "$HOST" \
        'cat /root/.cloudflare/api_email 2>/dev/null' 2>/dev/null | tr -d '\r\n' || true)
      RKEY=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new "$HOST" \
        'cat /root/.cloudflare/api_key 2>/dev/null' 2>/dev/null | tr -d '\r\n' || true)
      if [ -n "$REMAIL" ] && [ -n "$RKEY" ]; then
        CF_API_EMAIL="$REMAIL"; CF_API_KEY="$RKEY"
        export CF_API_EMAIL CF_API_KEY
        CF_TOKEN_SOURCE="server:$HOST:/root/.cloudflare/api_email+api_key"
        export CF_TOKEN_SOURCE
      fi
    fi
  fi
fi

if [ -z "${CF_API_TOKEN:-}" ] && [ -z "${CF_API_KEY:-}" ]; then
  echo "no Cloudflare credential found." >&2
  echo "  save one once:  sh $HERE/cf-token-save.sh     (scoped API token, mode 600, outside git)" >&2
  echo "             or:  sh $HERE/cf-token-save.sh --global   (Global API Key: e-mail + key)" >&2
  exit 2
fi

export CF_HOST="${CF_HOST:-walletagent.boostpay.online}"
echo "[cf] host=$CF_HOST zone=${CF_ZONE:-boostpay.online} credential=$CF_TOKEN_SOURCE" >&2
exec python3 "$HERE/cf-access-promotion.py" "$@"
