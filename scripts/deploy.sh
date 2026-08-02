#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ENV="$ROOT_DIR/.env.deploy"

if [[ -f "$DEPLOY_ENV" ]]; then
  set -a
  source "$DEPLOY_ENV"
  set +a
fi

SERVER="${PORTLORE_SERVER:?Set PORTLORE_SERVER in .env.deploy}"
REMOTE="${PORTLORE_REMOTE:-/var/www/portlore}"
NGINX_CONFIG="$ROOT_DIR/deploy/nginx.conf"
RELEASE="$REMOTE/.release-$(date +%s)"

cd "$ROOT_DIR"

for required in client server shared cities/ports.json cities/poi ecosystem.config.js "$NGINX_CONFIG"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing required project item: $required" >&2
    exit 1
  fi
done

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR" >&2
  exit 1
fi

node scripts/validate-data.js

echo "Preparing Portlore release for $SERVER:$REMOTE..."

ssh "$SERVER" "rm -rf '$RELEASE' && mkdir -p '$RELEASE/scripts' '$REMOTE/cities'"

tar \
  --exclude='node_modules' \
  -czf - \
  client \
  server \
  shared \
  ecosystem.config.js \
  scripts/merge-ports.js \
  scripts/sync-generated-state.js \
| ssh "$SERVER" "tar -xzf - -C '$RELEASE'"

scp .env "$SERVER:$RELEASE/.env"
ssh "$SERVER" "cd '$RELEASE/server' && if [[ -f package-lock.json ]]; then npm ci --omit=dev; else npm install --omit=dev; fi"

ssh "$SERVER" "
  rm -rf '$REMOTE/client' '$REMOTE/server' '$REMOTE/shared' '$REMOTE/scripts'
  mv '$RELEASE/client' '$REMOTE/client'
  mv '$RELEASE/server' '$REMOTE/server'
  mv '$RELEASE/shared' '$REMOTE/shared'
  mv '$RELEASE/scripts' '$REMOTE/scripts'
  mv '$RELEASE/ecosystem.config.js' '$REMOTE/ecosystem.config.js'
  mv '$RELEASE/.env' '$REMOTE/.env'
  rmdir '$RELEASE'
"

scp cities/ports.json "$SERVER:$REMOTE/cities/ports.release.json"
ssh "$SERVER" "node '$REMOTE/scripts/merge-ports.js' '$REMOTE/cities/ports.release.json' '$REMOTE/cities/ports.json' && rm -f '$REMOTE/cities/ports.release.json'"

ssh "$SERVER" "rm -rf '$REMOTE/cities/poi' && mkdir -p '$REMOTE/cities/poi'"
tar -czf - -C cities poi | ssh "$SERVER" "tar -xzf - -C '$REMOTE/cities'"

local_city_count=0
while IFS= read -r -d '' city_file; do
  city_name="$(basename "$city_file")"
  scp "$city_file" "$SERVER:$REMOTE/cities/$city_name"
  local_city_count=$((local_city_count + 1))
done < <(find cities -maxdepth 1 -type f -name '*.json' \
  ! -name 'ports.json' \
  ! -name 'osm-extracts.json' \
  -print0)
echo "Uploaded $local_city_count local guide files."

ssh "$SERVER" "node '$REMOTE/scripts/sync-generated-state.js' '$REMOTE/cities'"

scp "$NGINX_CONFIG" "$SERVER:/etc/nginx/sites-available/portlore"
ssh "$SERVER" "ln -sf /etc/nginx/sites-available/portlore /etc/nginx/sites-enabled/portlore"

ssh "$SERVER" "cd '$REMOTE' && pm2 startOrRestart ecosystem.config.js --update-env && pm2 save"
ssh "$SERVER" "for i in {1..15}; do curl -fsS http://127.0.0.1:3002/api/health >/dev/null && exit 0; sleep 1; done; echo 'Portlore health check failed on port 3002' >&2; exit 1"
ssh "$SERVER" "nginx -t && systemctl reload nginx"

echo "Portlore deployed successfully."
