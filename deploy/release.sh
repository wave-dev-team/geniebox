#!/usr/bin/env bash
set -euo pipefail
umask 077

release_sha=$1
registry_user=$2
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$registry_user" =~ ^[A-Za-z0-9_-]+(\[bot\])?$ ]]

root=/opt/wave
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
shared="$root/shared"
mkdir -p -- "$shared"
exec 9>"$root/.deploy.lock"
flock -w 120 9

previous=''
if [[ -L "$root/current" ]]; then
  previous=$(readlink -f -- "$root/current")
fi

scratch=$(mktemp -d "$shared/.deploy.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
export DOCKER_CONFIG="$scratch/docker"
mkdir -m 0700 -- "$DOCKER_CONFIG"
docker login ghcr.io --username "$registry_user" --password-stdin

if [[ ! -s "$shared/.env" ]]; then
  owner_password=$(openssl rand -hex 32)
  app_password=$(openssl rand -hex 32)
  jwt_secret=$(openssl rand -hex 32)
  cat > "$scratch/database.env" <<ENV
POSTGRES_PASSWORD=$owner_password
DB_APP_PASSWORD=$app_password
DB_MIGRATION_URL=postgresql://geniebox_owner:$owner_password@db:5432/geniebox
DATABASE_URL=postgresql://geniebox_app:$app_password@db:5432/geniebox
JWT_SECRET=$jwt_secret
ENV
  mv -- "$scratch/database.env" "$shared/.env"
fi

printf 'RELEASE_SHA=%s\n' "$release_sha" > "$release/release.env"

compose() {
  local path=$1
  shift
  docker compose --project-name geniebox --env-file "$shared/.env" --env-file "$path/release.env" \
    --file "$path/compose.yml" "$@"
}

probe() {
  curl --fail --silent --show-error --max-time 10 --retry 5 --retry-delay 2 --retry-all-errors "$1"
}

api_ok() {
  probe "$1" | python3 -c 'import json, sys; sys.exit(json.load(sys.stdin).get("status") != "ok")'
}

verify_release() {
  api_ok http://127.0.0.1:8000/api/health &&
    probe http://127.0.0.1:3000/ >/dev/null &&
    bash "$release/configure-proxy.sh" "$release/Caddyfile" "$scratch/proxy.previous" &&
    api_ok https://app.geniebox.ru/api/health &&
    probe https://app.geniebox.ru/ >/dev/null &&
    api_ok https://api.geniebox.ru/api/health
}

compose "$release" config --quiet
compose "$release" pull

if compose "$release" up --detach --wait --wait-timeout 180 && verify_release; then
  ln -s -- "$release" "$scratch/current"
  mv -Tf -- "$scratch/current" "$root/current"
  printf 'Deployed %s\n' "$release_sha"
else
  printf 'Deployment failed for %s\n' "$release_sha" >&2
  compose "$release" ps --all >&2 || true
  if [[ -f "$scratch/proxy.previous" ]]; then
    sudo install -m 0644 -- "$scratch/proxy.previous" /etc/caddy/Caddyfile
    sudo systemctl reload caddy
  fi
  if [[ -n "$previous" ]]; then
    compose "$previous" up --detach --wait --wait-timeout 180
    printf 'Restored previous application images\n' >&2
  else
    compose "$release" stop api web
  fi
  exit 1
fi
