#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || exit 64
revision="${BASH_REMATCH[1]}"
root=/var/www/portlore
backup=/root/deploy-backups/portlore-github-previous
nginx_config=/etc/nginx/sites-available/portlore
exec 9>/run/lock/portlore-github-deploy.lock
flock -n 9 || { echo 'Another Portlore deployment is running.'; exit 75; }
stage=$(mktemp -d /var/tmp/portlore-deploy.XXXXXX)
[[ "$stage" == /var/tmp/portlore-deploy.* && -d "$stage" ]] || exit 70
trap 'rm -rf -- "$stage"' EXIT
head -c 104857601 > "$stage/source.tar.gz"
[[ $(stat -c %s "$stage/source.tar.gz") -le 104857600 ]] || exit 65
python3 - "$stage/source.tar.gz" "$stage" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for item in archive.getmembers():
        path = pathlib.PurePosixPath(item.name)
        allowed = item.name in ('client', 'client/src', 'client/public', 'server', 'server/src', 'server/package.json', 'server/package-lock.json', 'shared', 'deploy', 'deploy/nginx.conf') or item.name.startswith(('client/src/', 'client/public/', 'server/src/', 'shared/'))
        if not allowed or path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise SystemExit('Unexpected deployment archive entry')
    archive.extractall(sys.argv[2], filter='data')
PY
for directory in server/src shared client/src; do
  while IFS= read -r -d '' file; do node --check "$file"; done < <(find "$stage/$directory" -name '*.js' -print0)
done
(umask 022 && cd "$stage/server" && npm ci --omit=dev)

install -d -m 700 "$backup" "$stage/restore"
tar -czf "$backup/source.tar.gz.next" -C "$root" client/src client/public server/src server/package.json server/package-lock.json shared
mv "$backup/source.tar.gz.next" "$backup/source.tar.gz"
cp "$nginx_config" "$backup/nginx.conf"
tar -xzf "$backup/source.tar.gz" -C "$stage/restore"
changed=0
dependencies_moved=0
rollback() {
  status=$?
  trap - ERR
  set +e
  if [[ $changed == 1 ]]; then
    echo 'Deployment failed; restoring the previous code and nginx configuration.'
    for directory in client/src client/public server/src shared; do
      rsync -a --delete --chmod=D755,F644 "$stage/restore/$directory/" "$root/$directory/"
    done
    install -m 644 "$stage/restore/server/package.json" "$stage/restore/server/package-lock.json" "$root/server/"
    if [[ $dependencies_moved == 1 ]]; then
      rm -rf -- "$root/server/node_modules"
      mv "$stage/previous-node_modules" "$root/server/node_modules"
    fi
    cp "$backup/nginx.conf" "$nginx_config"
    nginx -t && systemctl reload nginx
    (cd "$root" && pm2 reload ecosystem.config.js --only portlore)
  fi
  exit "$status"
}
trap rollback ERR
changed=1
for directory in client/src client/public server/src shared; do
  rsync -a --delete --chmod=D755,F644 "$stage/$directory/" "$root/$directory/"
done
install -m 644 "$stage/server/package.json" "$stage/server/package-lock.json" "$root/server/"
mv "$root/server/node_modules" "$stage/previous-node_modules"
dependencies_moved=1
mv "$stage/server/node_modules" "$root/server/node_modules"
install -m 644 "$stage/deploy/nginx.conf" "$nginx_config"
nginx -t
(cd "$root" && pm2 reload ecosystem.config.js --only portlore)
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3002/api/health >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3002/api/health
curl --fail --silent http://127.0.0.1:3002/guides >/dev/null
systemctl reload nginx
routes_ready=0
status=unknown
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --resolve portlore.com:443:127.0.0.1 https://portlore.com/guides --output "$stage/guides.html" &&
    grep -Fq 'rel="canonical" href="https://portlore.com/guides"' "$stage/guides.html"; then
    status=$(curl --silent --show-error --connect-timeout 2 --max-time 5 --output /dev/null --write-out '%{http_code}' --resolve portlore.com:443:127.0.0.1 https://portlore.com/deploy-check-missing-page) || status=unavailable
    if [[ "$status" == 404 ]]; then routes_ready=1; break; fi
  fi
  sleep 1
done
if [[ "$routes_ready" != 1 ]]; then
  echo "Nginx routes did not become ready: expected guide directory and HTTP 404, last missing-page status $status." >&2
  false
fi
printf '%s\n' "$revision" > "$root/.release"
trap - ERR
echo "Portlore deployed: $revision"
