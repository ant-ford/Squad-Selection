#!/usr/bin/env bash
# Installs the PostgreSQL client tools whose major version matches the server
# at $PGURL, and prints their bin directory.
#
# pg_dump refuses to dump a server newer than itself, and a pg_restore older
# than the pg_dump that wrote an archive cannot read it, so the version is
# read from the server each run rather than pinned here.
#
# Never prints the connection string. GitHub masks secrets in logs anyway,
# but the repo is public, so nothing here relies on that.
set -euo pipefail

: "${PGURL:?PGURL must be set}"

# Any psql can ask the server its version; the runner image normally has one.
sudo apt-get -qq update >/dev/null
sudo apt-get -qq install -y postgresql-common >/dev/null
command -v psql >/dev/null || sudo apt-get -qq install -y postgresql-client >/dev/null
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null 2>&1

num=$(psql "$PGURL" -Atqc "show server_version_num")
major=$((num / 10000))
sudo apt-get -qq install -y "postgresql-client-${major}" >/dev/null

bin="/usr/lib/postgresql/${major}/bin"
echo "Server is PostgreSQL ${major}; using $("${bin}/pg_dump" --version)" >&2
echo "$bin"
