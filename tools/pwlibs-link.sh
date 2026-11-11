#!/bin/sh
# The sandbox snapshot drops symlinks, so the chromium dependency shims have to
# be rebuilt before any headless-browser test. Safe to run repeatedly.
DIR=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu
[ -d "$DIR" ] || { echo "no $DIR"; exit 1; }
cd "$DIR" || exit 1
for f in lib*.so.*.*; do
  [ -f "$f" ] || continue
  base=$(echo "$f" | sed -E 's/^(lib.*\.so)(\.[0-9]+)(\.[0-9.]+)?$/\1/')
  [ "$base" = "$f" ] && continue
  major=$(echo "$f" | sed -E 's/^(lib.*\.so)(\.[0-9]+)(\.[0-9.]+)?$/\2/')
  [ -e "$base$major" ] || ln -s "$f" "$base$major"
  [ -e "$base" ] || ln -s "$f" "$base"
done
echo "links ready: $(ls -1 | grep -c '^l')"
