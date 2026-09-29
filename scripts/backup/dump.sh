#!/usr/bin/env bash
# Dumps one Supabase database, encrypts it with age and uploads it to R2.
#
#   PGURL            session-pooler connection string (a secret)
#   LABEL            eddy-production | eddy-preview (the folder under daily/)
#   AGE_RECIPIENT    age public key; only its secret half can read the backup
#   R2_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   R2 credentials
#   ALSO_MONTHLY     "auto" (default): also copy to monthly/ on the 1st of
#                    the month, Hong Kong time. "yes" or "no" to force.
#
# Writes to eddy-backups:
#   daily/<label>/<date>.dump.age            pg_dump custom format, encrypted
#   daily/<label>/<date>.manifest.json       row counts, checksum, versions
# The bucket's lifecycle rules delete daily/ after 35 days and monthly/
# after 400, so nothing here deletes anything.
#
# The dump never touches the runner's disk unencrypted: pg_dump streams
# straight into age. The manifest holds table names and counts only.
set -euo pipefail

: "${PGURL:?}" "${LABEL:?}" "${AGE_RECIPIENT:?}" "${R2_ACCOUNT_ID:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=auto
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
bucket="eddy-backups"

here="$(cd "$(dirname "$0")" && pwd)"
bin="$("$here/pg-client.sh")"
sudo apt-get -qq install -y age >/dev/null

# Club data lives in public; the raw Airtable copy in archive. Supabase's own
# schemas (auth, storage, ...) are managed by Supabase and not restorable by
# us, and Eddy keeps no data in them.
schemas=(--schema=public --schema=archive)

stamp="$(TZ=Asia/Hong_Kong date +%Y-%m-%d)"
work="$(mktemp -d)"
out="$work/${stamp}.dump.age"

"$bin/pg_dump" "$PGURL" --format=custom --compress=9 --no-owner "${schemas[@]}" \
  | age --recipient "$AGE_RECIPIENT" --output "$out"

size=$(stat -c %s "$out")
if [ "$size" -lt 100 ]; then
  echo "::error::Encrypted dump is only ${size} bytes; refusing to upload it as a backup."
  exit 1
fi
sha=$(sha256sum "$out" | cut -d' ' -f1)

# Row counts for the restore drill to compare against. Taken just after the
# dump, so a write in between can show as a difference of one or two rows.
counts=$("$bin/psql" "$PGURL" -Atq <<'SQL'
select coalesce(json_object_agg(t.schemaname || '.' || t.relname, t.n), '{}'::json)
from (
  select c.oid, n.nspname as schemaname, c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'archive')
) t;
SQL
)

manifest="$work/${stamp}.manifest.json"
jq -n --arg label "$LABEL" --arg stamp "$stamp" --arg sha "$sha" --argjson size "$size" \
  --arg pg_dump "$("$bin/pg_dump" --version)" --argjson counts "$counts" \
  '{label: $label, date: $stamp, sha256: $sha, bytes: $size, pg_dump: $pg_dump, row_counts: $counts}' > "$manifest"

put() { aws s3 cp --only-show-errors --endpoint-url "$endpoint" "$1" "s3://${bucket}/$2"; }
put "$out" "daily/${LABEL}/${stamp}.dump.age"
put "$manifest" "daily/${LABEL}/${stamp}.manifest.json"
echo "Uploaded daily/${LABEL}/${stamp}.dump.age (${size} bytes, sha256 ${sha:0:12}…, $(jq 'length' <<<"$counts") tables)"

monthly="${ALSO_MONTHLY:-auto}"
if [ "$monthly" = "auto" ]; then
  [ "$(TZ=Asia/Hong_Kong date +%d)" = "01" ] && monthly=yes || monthly=no
fi
if [ "$monthly" = "yes" ]; then
  put "$out" "monthly/${LABEL}/${stamp}.dump.age"
  put "$manifest" "monthly/${LABEL}/${stamp}.manifest.json"
  echo "Also kept as monthly/${LABEL}/${stamp}.dump.age"
fi

rm -rf "$work"
