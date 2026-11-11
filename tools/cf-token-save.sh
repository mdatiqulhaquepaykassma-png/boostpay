#!/bin/sh
# tools/cf-token-save.sh — store the Cloudflare credential ONCE, permanently.
#
#   sh tools/cf-token-save.sh              # scoped API token (recommended)
#   sh tools/cf-token-save.sh --global     # Global API Key (e-mail + key, full access)
#   sh tools/cf-token-save.sh --show       # which credential is active (never prints it)
#   sh tools/cf-token-save.sh --wipe       # remove every stored credential
#
# Files live outside the git checkout, mode 600, directory 700:
#   /home/user/.cloudflare/api_token
#   /home/user/.cloudflare/api_email + api_key
# Input is hidden, nothing is echoed, nothing reaches the shell history, and an
# existing credential is removed first so a half-written file can never linger.
set -e
DIR="${CF_VAULT_DIR:-/home/user/.cloudflare}"
[ -f /home/user/.cloudflare/api_token ] && :
mkdir -p "$DIR"; chmod 700 "$DIR"

hide() { stty -echo 2>/dev/null || true; }
show() { stty echo 2>/dev/null || true; }

case "${1:-}" in
  --show)
    [ -s "$DIR/api_token" ] && echo "scoped API token: present ($DIR/api_token)" || true
    if [ -s "$DIR/api_email" ] && [ -s "$DIR/api_key" ]; then
      echo "Global API Key:  present ($DIR/api_email + $DIR/api_key, account $(cut -d@ -f2 "$DIR/api_email"))"
    fi
    [ -s "$DIR/api_token" ] || [ -s "$DIR/api_key" ] || echo "nothing stored"
    exit 0 ;;
  --wipe)
    rm -f "$DIR/api_token" "$DIR/api_email" "$DIR/api_key"
    echo "removed every stored Cloudflare credential in $DIR"; exit 0 ;;
  --global)
    printf 'Cloudflare account e-mail: '; IFS= read -r EMAIL; printf '\n'
    printf 'Global API Key (hidden): '; hide; IFS= read -r KEY; show; printf '\n'
    [ -n "$EMAIL" ] && [ -n "$KEY" ] || { echo 'both values are required' >&2; exit 1; }
    rm -f "$DIR/api_token"
    printf '%s' "$EMAIL" > "$DIR/api_email"; chmod 600 "$DIR/api_email"
    printf '%s' "$KEY"   > "$DIR/api_key";   chmod 600 "$DIR/api_key"
    unset KEY
    echo "saved Global API Key for account domain: $(echo "$EMAIL" | cut -d@ -f2)"
    echo "check with:  sh $(dirname "$0")/cf.sh --verify" ;;
  *)
    printf 'Cloudflare API token (hidden): '; hide; IFS= read -r TOK; show; printf '\n'
    [ -n "$TOK" ] || { echo 'nothing entered' >&2; exit 1; }
    rm -f "$DIR/api_email" "$DIR/api_key"
    printf '%s' "$TOK" > "$DIR/api_token"; chmod 600 "$DIR/api_token"
    unset TOK
    echo "saved to $DIR/api_token (mode 600)"
    echo "check with:  sh $(dirname "$0")/cf.sh --verify" ;;
esac
