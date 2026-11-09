#!/bin/sh
# Builds public/downloads/automatepal-wordpress.zip from integrations/wordpress/automatepal (served at
# /downloads/automatepal-wordpress.zip and linked from Setup step 4). Deterministic: fixed file times, no
# extra attributes, sorted entries, so rebuilding unchanged sources gives the same bytes.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp -R integrations/wordpress/automatepal "$tmp/automatepal"
find "$tmp/automatepal" -exec touch -t 202611090000 {} +
mkdir -p public/downloads
rm -f public/downloads/automatepal-wordpress.zip
(cd "$tmp" && find automatepal -type f | LC_ALL=C sort | zip -X -q -@ "$OLDPWD/public/downloads/automatepal-wordpress.zip")
echo "Built public/downloads/automatepal-wordpress.zip ($(wc -c < public/downloads/automatepal-wordpress.zip | tr -d ' ') bytes)"
