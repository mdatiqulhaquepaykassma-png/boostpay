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

# Credential priority
#   1. anything already exported
#   2. the Global API Key pair (full access: DNS + SSL + Zone + Access)
#   3. a scoped API token (DNS only)
# Force one with CF_AUTH=key|token.
AUTH="${CF_AUTH:-}"
HAVE_KEY=0; HAVE_TOKEN=0
if [ -n "${CF_API_KEY:-}" ] && [ -n "${CF_API_EMAIL:-}" ]; then HAVE_KEY=1; export CF_TOKEN_SOURCE="env(global key)"; fi
if [ -n "${CF_API_TOKEN:-}" ]; then HAVE_TOKEN=1; export CF_TOKEN_SOURCE="${CF_TOKEN_SOURCE:-env(token)}"; fi
[ -f "$KEY_PATH" ] && [ -f "$EMAIL_PATH" ] && HAVE_KEYFILE=1 || HAVE_KEYFILE=0
[ -f "$TOKEN_PATH" ] && HAVE_TOKENFILE=1 || HAVE_TOKENFILE=0

use_key() {
  E=$(read_file "$EMAIL_PATH"); K=$(read_file "$KEY_PATH")
  CF_API_EMAIL="$E"; CF_API_KEY="$K"; export CF_API_EMAIL CF_API_KEY
  CF_API_TOKEN=""; export CF_API_TOKEN
  export CF_TOKEN_SOURCE="file:$VAULT/api_email+api_key"
}
use_token() {
  CF_API_TOKEN=$(read_file "$TOKEN_PATH"); export CF_API_TOKEN
  CF_API_EMAIL=""; CF_API_KEY=""; export CF_API_EMAIL CF_API_KEY
  export CF_TOKEN_SOURCE="file:$TOKEN_PATH"
}

if [ "$AUTH" = "token" ]; then
  [ "$HAVE_TOKENFILE" = "1" ] && use_token || echo "[cf] no stored token" >&2
elif [ "$AUTH" = "key" ]; then
  [ "$HAVE_KEYFILE" = "1" ] && use_key || echo "[cf] no stored key pair" >&2
elif [ "$HAVE_KEY" = "1" ] || [ "$HAVE_KEYFILE" = "1" ]; then
  # global key wins: full access is what the owner asked for
  [ "$HAVE_KEYFILE" = "1" ] && use_key
elif [ "$HAVE_TOKENFILE" = "1" ]; then
  use_token
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
