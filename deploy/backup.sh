#!/usr/bin/env bash
# 하루 한 번 PostgreSQL을 덤프하고 7일치만 보관한다.
# cron 예: 0 4 * * * /home/ubuntu/deskbrawl/deploy/backup.sh >> /var/log/deskbrawl-backup.log 2>&1
# 같은 인스턴스 디스크에만 남으므로 인스턴스 스냅샷과 함께 쓰고, 복구를 한 번 직접 검증한다.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="${BACKUP_DIR:-$HOME/deskbrawl-backups}"
mkdir -p "$dir"

file="$dir/deskbrawl-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose --env-file "$root/.env.prod" -f "$root/compose.prod.yaml" \
  exec -T postgres pg_dump -U deskbrawl deskbrawl | gzip > "$file"

find "$dir" -name 'deskbrawl-*.sql.gz' -mtime +7 -delete
echo "backup ok: $file"
# 복구: gunzip -c <파일> | docker compose --env-file .env.prod -f compose.prod.yaml exec -T postgres psql -U deskbrawl deskbrawl
