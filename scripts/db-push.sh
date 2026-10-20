#!/usr/bin/env bash
# Apply pending Prisma migrations to the linked Supabase project, one command:
#
#   pnpm db:push            # apply everything not yet applied
#   pnpm db:push --dry-run  # just list what would be applied
#
# Uses the Supabase CLI login (no DB password needed). Each migration runs in
# one transaction together with its _prisma_migrations row, so a failure leaves
# nothing half-applied and `prisma migrate status` stays accurate.
set -euo pipefail

cd "$(dirname "$0")/.."
DIR=packages/db/prisma/migrations
DRY=${1:-}

applied=$(supabase db query --linked -o json \
  "select migration_name from _prisma_migrations where finished_at is not null" 2>/dev/null \
  | grep -o '"migration_name": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')

pending=()
for path in "$DIR"/*/migration.sql; do
  name=$(basename "$(dirname "$path")")
  grep -qx "$name" <<<"$applied" || pending+=("$name")
done

if [ ${#pending[@]} -eq 0 ]; then echo "Up to date."; exit 0; fi
printf 'Pending:\n'; printf '  %s\n' "${pending[@]}"
[ "$DRY" = "--dry-run" ] && exit 0

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for name in "${pending[@]}"; do
  sql="$DIR/$name/migration.sql"
  sum=$(shasum -a 256 "$sql" | cut -d' ' -f1)
  {
    echo 'BEGIN;'
    cat "$sql"
    echo
    echo "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)"
    echo "VALUES (gen_random_uuid()::text, '$sum', now(), '$name', now(), 1);"
    echo 'COMMIT;'
  } >"$tmp"
  printf 'Applying %s ... ' "$name"
  if out=$(supabase db query --linked -f "$tmp" 2>&1) && ! grep -qiE '(^|[^_])error' <<<"$out"; then
    echo ok
  else
    echo FAILED; echo "$out" | grep -iE 'error' | head -5; exit 1
  fi
done
