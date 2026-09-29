#!/usr/bin/env bash
# Restores an encrypted backup from R2 into the database at $PGURL, then checks
# every table's row count against the manifest written at backup time.
#
#   PGURL            target database (eddy-preview for the drill)
#   OBJECT           key under eddy-backups, e.g. daily/eddy-production/2026-10-05.dump.age,
#                    or "latest:<label>" for the newest daily backup of that label
#   AGE_IDENTITY     the age secret key (AGE-SECRET-KEY-1...)
#   R2_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#
# REPLACES the public and archive schema objects in the backup (pg_restore
# --clean). Tables that exist in the target but not in the backup are left
# alone. Prints table names and counts only, never data.
set -euo pipefail

: "${PGURL:?}" "${OBJECT:?}" "${AGE_IDENTITY:?}" "${R2_ACCOUNT_ID:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=auto
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
bucket="eddy-backups"
s3() { aws --endpoint-url "$endpoint" "$@"; }

here="$(cd "$(dirname "$0")" && pwd)"
bin="$("$here/pg-client.sh")"
sudo apt-get -qq install -y age >/dev/null

if [[ "$OBJECT" == latest:* ]]; then
  label="${OBJECT#latest:}"
  OBJECT=$(s3 s3api list-objects-v2 --bucket "$bucket" --prefix "daily/${label}/" \
    --query "reverse(sort_by(Contents[?ends_with(Key, '.dump.age')], &Key))[0].Key" --output text)
  [ "$OBJECT" != "None" ] || { echo "::error::No backups under daily/${label}/"; exit 1; }
fi
echo "Restoring ${OBJECT}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
printf '%s\n' "$AGE_IDENTITY" > "$work/identity.txt"

s3 s3 cp --only-show-errors "s3://${bucket}/${OBJECT}" "$work/backup.age"
s3 s3 cp --only-show-errors "s3://${bucket}/${OBJECT%.dump.age}.manifest.json" "$work/manifest.json"

sha=$(sha256sum "$work/backup.age" | cut -d' ' -f1)
if [ "$sha" != "$(jq -r .sha256 "$work/manifest.json")" ]; then
  echo "::error::Checksum mismatch: the backup file is not the one the manifest describes."
  exit 1
fi

age --decrypt --identity "$work/identity.txt" --output "$work/backup.dump" "$work/backup.age"
rm -f "$work/identity.txt"

# Restore our objects only. The public schema itself - its existence, its
# grants to Supabase's roles and the default privileges Supabase sets on it -
# belongs to Supabase: with --clean, restoring that entry would drop and
# recreate the schema and lose them. So those entries are filtered out of the
# restore list. Tables, views, functions, RLS policies and table grants are
# restored as written; --no-owner makes the restoring role their owner.
"$bin/pg_restore" --list "$work/backup.dump" \
  | grep -v -E ' (SCHEMA - public|ACL - SCHEMA public|COMMENT - SCHEMA public) |DEFAULT ACL ' > "$work/restore.list"
"$bin/pg_restore" --dbname="$PGURL" --use-list="$work/restore.list" \
  --clean --if-exists --no-owner --exit-on-error "$work/backup.dump"
rm -f "$work/backup.dump"

# Compare row counts, table by table.
expected=$(jq -c '.row_counts' "$work/manifest.json")
failed=0
while IFS=$'\t' read -r table want; do
  got=$("$bin/psql" "$PGURL" -Atqc "select count(*) from ${table}" 2>/dev/null || echo "missing")
  if [ "$got" = "$want" ]; then
    printf '  ok    %-50s %s\n' "$table" "$got"
  else
    printf '  DIFF  %-50s expected %s, restored %s\n' "$table" "$want" "$got"
    failed=1
  fi
done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' <<<"$expected")

tables=$(jq 'length' <<<"$expected")
if [ "$failed" = 1 ]; then
  echo "::error::Restore finished but some row counts differ (see above)."
  exit 1
fi
echo "Restore verified: ${tables} tables, every row count matches the manifest."
