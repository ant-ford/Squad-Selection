#!/usr/bin/env bash
# Records this backup run in public.heartbeats of the database it backed up,
# for Eddy's daily health check (worker/src/systemHealth.ts), which flags a
# backup older than 30 hours.
#
#   PGURL   session-pooler connection string (a secret, never printed)
#   OK      "true" or "false": whether the backup step succeeded
#   LABEL   eddy-production | eddy-preview
#
# Never fails the workflow: a missing heartbeat shows up in Eddy instead.
set -uo pipefail

: "${PGURL:?}" "${OK:?}" "${LABEL:?}"
[ "$OK" = "true" ] || OK=false

if ! command -v psql >/dev/null; then
  sudo apt-get -qq update >/dev/null && sudo apt-get -qq install -y postgresql-client >/dev/null
fi

# Values go in as psql variables (:'name' quotes them), not into the SQL text.
if psql "$PGURL" -v ON_ERROR_STOP=1 -q -v ok="$OK" -v label="$LABEL" -v run="${GITHUB_RUN_ID:-}" >/dev/null 2>&1 <<'SQL'
insert into public.heartbeats (job, ok, detail)
values ('backup', :'ok'::boolean, jsonb_build_object('label', :'label', 'run', :'run'));
SQL
then
  echo "Heartbeat recorded (ok=${OK})"
else
  echo "::warning::Backup heartbeat not recorded"
fi
