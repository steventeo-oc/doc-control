#!/usr/bin/env bash
#
# Creates the assistant's two read-only credentials (RUNBOOK section 7). Safe to re-run.
#   * Postgres role "assistant_ro": SELECT on the view assistant_indexable_version and nothing else
#   * MinIO user "assistant_ro": read objects in the documents bucket, nothing else
#
# The secrets are generated here and appended to .env (gitignored); they are never printed. The SQL reaches psql on
# stdin and the MinIO secret reaches mc through a variable read from stdin, so neither shows up in a process list on
# the host. Existing values in .env are kept, so a re-run resets the role and user to the same secrets.
#
# Run it on the machine that runs the compose stack, after the api has started once on a build that includes
# migration V12 (the view must exist):
#   bash scripts/assistant-setup.sh
# On the dev machine (Docker lives in WSL):
#   wsl -u root bash -c "cd '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && bash scripts/assistant-setup.sh"

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
PG_CONTAINER="${PG_CONTAINER:-doccontrol-postgres}"
MINIO_CONTAINER="${MINIO_CONTAINER:-doccontrol-minio}"
ROLE="assistant_ro"

step() { printf '\n=== %s ===\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

touch "$ENV_FILE"
# A file that does not end in a newline would glue the first appended name onto its last line.
if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then printf '\n' >> "$ENV_FILE"; fi

env_get() { # env_get NAME [default]: the value in .env, else the default
  local v; v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  printf '%s' "${v:-${2:-}}"
}
env_set() { # env_set NAME VALUE: only when the name is missing or empty (values here are hex, safe for sed)
  if grep -qE "^$1=.+" "$ENV_FILE"; then return 0; fi
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
new_secret() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
psql_admin() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"; }

PG_USER="$(env_get POSTGRES_USER doccontrol)"
PG_DB="$(env_get POSTGRES_DB doccontrol)"
BUCKET="$(env_get DOCCONTROL_STORAGE_BUCKET doccontrol)"

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || fail "container $PG_CONTAINER is not running; start the stack first"
docker inspect "$MINIO_CONTAINER" >/dev/null 2>&1 || fail "container $MINIO_CONTAINER is not running; start the stack first"

step "1. The view exists (migration V12)"
[ "$(psql_admin -At -c "SELECT to_regclass('public.assistant_indexable_version') IS NOT NULL")" = "t" ] \
  || fail "the view assistant_indexable_version is missing: rebuild and start the api (docker compose up -d --build api) so migration V12 runs, then run this again"
echo "OK"

step "2. Postgres role $ROLE: read the view, nothing else"
env_set ASSISTANT_DB_PASSWORD "$(new_secret)"
DB_SECRET="$(env_get ASSISTANT_DB_PASSWORD)"
psql_admin -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') THEN CREATE ROLE $ROLE LOGIN; END IF;
END \$\$;
ALTER ROLE $ROLE PASSWORD '$DB_SECRET';
ALTER ROLE $ROLE SET default_transaction_read_only = on;
ALTER ROLE $ROLE SET statement_timeout = '30s';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT ON assistant_indexable_version TO $ROLE;
SQL
as_role() { psql_admin -At -c "SET ROLE $ROLE; $1" 2>&1; }
echo "OK: the role can read the view ($(as_role 'SELECT count(*) FROM assistant_indexable_version' | tail -n1) rows now)"
case "$(as_role 'SELECT count(*) FROM document' || true)" in
  *"permission denied"*) echo "OK: the role cannot read the document table" ;;
  *) fail "the role $ROLE can read the document table; check the grants" ;;
esac

step "3. MinIO user $ROLE: read objects in bucket '$BUCKET', nothing else"
env_set ASSISTANT_MINIO_ACCESS_KEY "$ROLE"
env_set ASSISTANT_MINIO_SECRET_KEY "$(new_secret)"
KEY="$(env_get ASSISTANT_MINIO_ACCESS_KEY)"
MINIO_SECRET="$(env_get ASSISTANT_MINIO_SECRET_KEY)"
POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::'"$BUCKET"'/*"]},{"Effect":"Allow","Action":["s3:GetBucketLocation"],"Resource":["arn:aws:s3:::'"$BUCKET"'"]}]}'
# mc runs inside the MinIO container with the container's own root credentials and a throwaway config directory.
printf '%s\n%s\n' "$MINIO_SECRET" "$POLICY" | docker exec -i "$MINIO_CONTAINER" sh -c '
  set -e
  read -r SECRET; read -r POLICY
  export MC_CONFIG_DIR=/tmp/mc-setup
  trap "rm -rf /tmp/mc-setup /tmp/assistant-read.json" EXIT
  mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  printf "%s" "$POLICY" > /tmp/assistant-read.json
  mc admin policy create local assistant-read /tmp/assistant-read.json >/dev/null
  mc admin user add local '"$KEY"' "$SECRET" >/dev/null
  mc admin policy attach local assistant-read --user '"$KEY"' >/dev/null 2>&1 || true
'
KEYREF="$(psql_admin -At -c "SELECT file_reference FROM assistant_indexable_version LIMIT 1")"
if [ -z "$KEYREF" ]; then
  echo "NOTE: no released document yet, so the read check is skipped"
else
  printf '%s\n%s\n' "$MINIO_SECRET" "$BUCKET/$KEYREF" | docker exec -i "$MINIO_CONTAINER" sh -c '
    read -r SECRET; read -r OBJECT
    export MC_CONFIG_DIR=/tmp/mc-check
    trap "rm -rf /tmp/mc-check" EXIT
    mc alias set reader http://localhost:9000 '"$KEY"' "$SECRET" >/dev/null
    if mc cat "reader/$OBJECT" | head -c 16 >/dev/null 2>&1; then echo "OK: the user can read a released file"; else echo "FAILED: cannot read a released file"; exit 1; fi
    if echo probe | mc pipe "reader/'"$BUCKET"'/assistant-write-probe" >/dev/null 2>&1; then echo "FAILED: the user can write"; exit 1; else echo "OK: the user cannot write"; fi
  ' || fail "the MinIO user does not behave as a read-only user"
fi

step "DONE"
echo "Secrets saved to $ENV_FILE as ASSISTANT_DB_PASSWORD, ASSISTANT_MINIO_ACCESS_KEY and ASSISTANT_MINIO_SECRET_KEY (not printed)."
echo "Next: docker compose --profile assistant up -d --build   (RUNBOOK section 7)"
