#!/bin/sh
# tools/cf-token-save.sh — store the Cloudflare API token once, permanently.
#
#   sh tools/cf-token-save.sh
#   (it asks twice, input is hidden, nothing is echoed and nothing is written to
#    the shell history; the file is /home/user/.cloudflare/api_token mode 600 and
#    lives outside the git checkout)
#
# Required token permissions (Custom token, no expiry):
#   Zone     → DNS            → Edit      (zone: boostpay.online)
#   Zone     → Zone           → Read      (zone: boostpay.online)
#   Account  → Access: Apps and Policies → Edit
set -e
DIR="${CF_TOKEN_DIR:-/home/user/.cloudflare}"
FILE="$DIR/api_token"
mkdir -p "$DIR"; chmod 700 "$DIR"

printf 'Cloudflare API token (input hidden): '
stty -echo 2>/dev/null || true
IFS= read -r TOK
stty echo 2>/dev/null || true
printf '\n'
[ -n "$TOK" ] || { echo 'nothing entered' >&2; exit 1; }

printf '%s' "$TOK" > "$FILE"
chmod 600 "$FILE"
# never let the value reach the terminal or a log
unset TOK
echo "saved to $FILE (mode 600)"
echo "verify with:  sh $(dirname "$0")/cf.sh"
