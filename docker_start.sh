#!/usr/bin/env bash
set -euo pipefail

if [ ! -f /config/bots.json ]; then
  echo '[{"user":"bot1","pass":"password","auth":"shared_secret"}]' > /config/bots.json
  echo "Created template /config/bots.json. Please edit this file with your bot credentials and restart the container."
  exit 1
fi

mkdir -p /config/steam_data

exec node index.js -s /config/steam_data
