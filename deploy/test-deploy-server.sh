#!/usr/bin/env bash
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/deploy-server.sh
temp_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
work=$(mktemp -d "$temp_root/deskbrawl-deploy.XXXXXX")
[[ "$work" == "$temp_root"/deskbrawl-deploy.* ]]
trap 'rm -rf -- "$work"' EXIT
export DESKBRAWL_ROOT="$work" STATE_DIRECTORY="$work/state"
export healthy_digest
export failed_digest
printf -v healthy_digest '%064x' 1
printf -v failed_digest '%064x' 2
mkdir "$work/bin"
export PATH="$work/bin:$PATH"

cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  'compose '*" ps --quiet server") echo existing-container ;;
  'container inspect '*) printf 'sha256:%064x\n' 0 ;;
  'image tag '*) ;;
  'pull '*) printf 'Digest: sha256:%s\n' "$(cat "$DESKBRAWL_ROOT/production")" ;;
  'compose '*" up "*" --wait --wait-timeout 120 server")
    printf '%s\n' "$DESKBRAWL_SERVER_IMAGE" >> "$DESKBRAWL_ROOT/replacements"
    printf '%s\n' "$DESKBRAWL_SERVER_IMAGE" > "$DESKBRAWL_ROOT/running"
    ;;
  *) echo "Unexpected Docker command: $*" >&2; exit 1 ;;
esac
EOF

cat > "$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ -f "$DESKBRAWL_ROOT/running" && $(cat "$DESKBRAWL_ROOT/running") == *"$failed_digest" ]]; then
  exit 22
fi
echo '{"ok":true}'
EOF

# Git Bash on Windows does not include Linux flock.
if ! command -v flock >/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/flock"
  chmod +x "$work/bin/flock"
fi
chmod +x "$work/bin/docker" "$work/bin/curl"

printf '%s\n' "$healthy_digest" > "$work/production"
bash "$script"
[[ $(cat "$work/running") == *"$healthy_digest" ]]

printf '%s\n' "$failed_digest" > "$work/production"
if bash "$script"; then
  echo 'An unhealthy deployment must report a failure.' >&2
  exit 1
fi
[[ $(cat "$work/running") == *"$healthy_digest" ]]
[[ $(cat "$STATE_DIRECTORY/server.env") == *"$healthy_digest" ]]
[[ ! -e "$STATE_DIRECTORY/pending" ]]

bash "$script"
[[ $(wc -l < "$work/replacements") -eq 3 ]]

printf '%s\n' "$failed_digest" > "$work/production"
printf 'ghcr.io/jinoko01/deskbrawl-server@sha256:%s\n' "$failed_digest" > "$STATE_DIRECTORY/pending"
if bash "$script"; then
  echo 'Recovering an interrupted deployment must report a failure.' >&2
  exit 1
fi
[[ ! -e "$STATE_DIRECTORY/pending" ]]
[[ $(cat "$work/running") == *"$healthy_digest" ]]
echo 'Deployment, rollback, rejection and interrupted-run recovery passed.'
