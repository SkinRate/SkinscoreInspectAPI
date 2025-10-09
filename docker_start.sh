#!/usr/bin/env bash
set -euo pipefail

if [ ! -f /config/config.js ]; then
  cp /usr/src/csgofloat/config.js /config/config.js
  echo "Copied config to /config/config.js. Please edit this file and restart the container."
  exit 1
fi

mkdir -p /config/steam_data

exec node index.js -c /config/config.js -s /config/steam_data
