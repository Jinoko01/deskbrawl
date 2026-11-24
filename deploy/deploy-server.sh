#!/usr/bin/env bash
set -euo pipefail
umask 077

root=${DESKBRAWL_ROOT:?Set DESKBRAWL_ROOT to the running Compose project directory}
image=${DESKBRAWL_IMAGE:-ghcr.io/jinoko01/deskbrawl-server}
health_url=${DESKBRAWL_HEALTH_URL:-https://api.deskbrawl.xyz/health}
state=${STATE_DIRECTORY:-/var/lib/deskbrawl-deploy}
compose=(docker compose --project-directory "$root" --env-file "$root/.env.prod" -f "$root/compose.prod.yaml")

mkdir -p "$state/rejected"
exec 9>"$state/deploy.lock"
flock -n 9 || exit 0

record() {
  printf '%s\n' "$2" > "$1.tmp"
  mv -f -- "$1.tmp" "$1"
}

healthy() {
  local response
  response=$(curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --retry-delay 2 --connect-timeout 3 --max-time 5 "$health_url") &&
    [[ "$response" == '{"ok":true}' ]]
}

apply_image() {
  DESKBRAWL_SERVER_IMAGE=$1 "${compose[@]}" up -d --no-deps --no-build --pull never \
    --wait --wait-timeout 120 server && healthy
}

rollback() {
  local failed=$1
  echo "Restoring $last_good after unsuccessful deployment of $failed" >&2
  if ! apply_image "$last_good"; then
    echo 'Rollback health check failed. The next run will retry recovery.' >&2
    return 1
  fi
  # Keep the failure across timer runs and registry tag changes.
  touch "$state/rejected/${failed##*:}"
  rm -f -- "$state/pending"
  echo "Restored $last_good" >&2
}

if [[ -f "$state/server.env" ]]; then
  IFS= read -r last_good < "$state/server.env"
  last_good=${last_good#DESKBRAWL_SERVER_IMAGE=}
else
  # The first rollback target can be the locally built server already in use.
  container=$("${compose[@]}" ps --quiet server)
  if [[ -z "$container" ]] || ! healthy; then
    echo 'A healthy running server is required to establish the first rollback target.' >&2
    exit 1
  fi
  previous_id=$(docker container inspect --format '{{.Image}}' "$container")
  last_good="deskbrawl-server:rollback-${previous_id#sha256:}"
  docker image tag "$previous_id" "$last_good"
  record "$state/server.env" "DESKBRAWL_SERVER_IMAGE=$last_good"
fi

if [[ -f "$state/pending" ]]; then
  IFS= read -r pending < "$state/pending"
  if [[ "$pending" == "$last_good" ]]; then
    rm -f -- "$state/pending"
  else
    rollback "$pending"
    exit 1
  fi
fi

pull_output=$(docker pull "$image:production")
digest=$(awk '/^Digest: / { print $2 }' <<< "$pull_output")
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'Could not identify the pulled production image digest.' >&2
  exit 1
fi
candidate="$image@$digest"
if [[ "$candidate" == "$last_good" || -f "$state/rejected/${digest#sha256:}" ]]; then
  exit 0
fi

record "$state/pending" "$candidate"
if ! apply_image "$candidate"; then
  rollback "$candidate"
  exit 1
fi
record "$state/server.env" "DESKBRAWL_SERVER_IMAGE=$candidate"
rm -f -- "$state/pending"
echo "Deployed $candidate"
