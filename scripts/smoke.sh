#!/usr/bin/env bash
#
# End-to-end smoke test for the Document Control API (Sprint 1 scope).
#
# Prerequisites:
#   * API running (mvn spring-boot:run in api/)
#   * PostgreSQL reachable (dev cluster or docker compose up postgres)
#   * MinIO reachable on :9000 (docker compose up minio, or the standalone
#     binary — see api/README.md)
#   * curl and python on PATH
#
# The script leaves the objects it creates behind (dev-friendly); codes and
# emails are timestamp-suffixed so it can be re-run safely.
#
# Usage:
#   bash scripts/smoke.sh
#   BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... bash scripts/smoke.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@doccontrol.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme_admin}"

SUFFIX="$(date +%s)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# curl.exe on Windows can't read MSYS-style /tmp/... paths — convert when possible
if command -v cygpath >/dev/null 2>&1; then TMP="$(cygpath -m "$TMP")"; fi

step() { printf '\n=== %s ===\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }
api() { curl -s -m 15 "$@"; }

login() { # login <cookiejar> <email> <password>
  api -c "$1" -o /dev/null -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$2\",\"password\":\"$3\"}"
}

field() { # field <json-payload> <key>
  printf '%s' "$1" | python -c "import sys,json;print(json.load(sys.stdin)['$2'])"
}

step "0. Preflight — unauthenticated /auth/me must be rejected"
code="$(api -o /dev/null -w '%{http_code}' "$BASE_URL/auth/me")"
[ "$code" = "401" ] || fail "expected 401 from /auth/me, got $code"
echo "OK (401 as expected)"

step "1. Login as admin"
login "$TMP/admin.jar" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
ME="$(api -b "$TMP/admin.jar" "$BASE_URL/auth/me")"
[ "$(field "$ME" email)" = "$ADMIN_EMAIL" ] || fail "admin login failed"
echo "OK — authenticated as $ADMIN_EMAIL"

step "2. Create a department (extensible lookup — a pure data change)"
DEPT="$(api -b "$TMP/admin.jar" -X POST "$BASE_URL/departments" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"SMK$SUFFIX\",\"label\":\"Smoke Test Dept $SUFFIX\"}")"
DEPT_ID="$(field "$DEPT" id)"; DEPT_CODE="$(field "$DEPT" code)"
echo "OK — department $DEPT_CODE (id $DEPT_ID)"

step "3. Create a second, regular user (roles default to User)"
USER_JSON="$(api -b "$TMP/admin.jar" -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Viewer $SUFFIX\",\"email\":\"viewer$SUFFIX@doccontrol.local\",\"departmentId\":$DEPT_ID,\"password\":\"viewer-pass-123\"}")"
VIEWER_ID="$(field "$USER_JSON" id)"
login "$TMP/viewer.jar" "viewer$SUFFIX@doccontrol.local" "viewer-pass-123"
echo "OK — viewer user id $VIEWER_ID, logged in"

step "4. Create a document with a file (file becomes version 1)"
printf 'Rev A — smoke test content.\n' > "$TMP/rev-a.txt"
SOP_TYPE_ID="$(api -b "$TMP/admin.jar" "$BASE_URL/document-types" \
  | python -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t['code']=='SOP'][0])")"
DOC="$(api -b "$TMP/admin.jar" -X POST "$BASE_URL/documents" \
  -F "document_type_id=$SOP_TYPE_ID" -F "department_id=$DEPT_ID" \
  -F "name=Smoke Test Procedure $SUFFIX" -F "file=@$TMP/rev-a.txt;type=text/plain")"
DOC_ID="$(field "$DOC" id)"; DOC_NUMBER="$(field "$DOC" documentNumber)"
echo "OK — $DOC_NUMBER (id $DOC_ID), version 1 stored, current_version_id=$(field "$DOC" currentVersionId)"

step "5. Upload version 2"
printf 'Rev B — smoke test content with changes.\n' > "$TMP/rev-b.txt"
V2="$(api -b "$TMP/admin.jar" -X POST "$BASE_URL/documents/$DOC_ID/versions" \
  -F "file=@$TMP/rev-b.txt;type=text/plain" -F "change_notes=Smoke test revision B")"
V2_ID="$(field "$V2" id)"
echo "OK — version $(field "$V2" versionNumber) uploaded (id $V2_ID)"

step "6. Download version 2 and verify the bytes round-trip"
api -b "$TMP/admin.jar" -o "$TMP/downloaded.txt" "$BASE_URL/documents/$DOC_ID/versions/$V2_ID/download"
grep -q "Rev B" "$TMP/downloaded.txt" || fail "downloaded content does not match"
echo "OK — downloaded file contains the Rev B content"

step "7. The draft is invisible to the second user (404 — existence not leaked)"
code="$(api -b "$TMP/viewer.jar" -o /dev/null -w '%{http_code}' "$BASE_URL/documents/$DOC_ID")"
[ "$code" = "404" ] || fail "expected 404 for hidden draft, got $code"
echo "OK (404 as expected)"

step "8. Admin releases the document via the status override (Sprint 1 stopgap)"
api -b "$TMP/admin.jar" -X PATCH "$BASE_URL/documents/$DOC_ID" \
  -H "Content-Type: application/json" -d '{"status":"released"}' \
  | python -c "import sys,json;print('OK — document status is now', json.load(sys.stdin)['status'])"

step "9. The second user can now see the released document"
SEEN="$(api -b "$TMP/viewer.jar" "$BASE_URL/documents/$DOC_ID")"
[ "$(field "$SEEN" documentNumber)" = "$DOC_NUMBER" ] || fail "viewer sees the wrong document"
echo "OK — viewer reads $DOC_NUMBER (released documents are public to all authenticated users)"

step "10. Bonus: create a second ADMIN via roles on create (break-glass account)"
ADMIN2="$(api -b "$TMP/admin.jar" -X POST "$BASE_URL/users" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Admin 2 $SUFFIX\",\"email\":\"admin2$SUFFIX@doccontrol.local\",\"departmentId\":$DEPT_ID,\"password\":\"admin2-pass-123\",\"roles\":[\"Admin\"]}")"
ADMIN2_ID="$(field "$ADMIN2" id)"
login "$TMP/admin2.jar" "admin2$SUFFIX@doccontrol.local" "admin2-pass-123"
code="$(api -b "$TMP/admin2.jar" -o /dev/null -w '%{http_code}' "$BASE_URL/users")"
[ "$code" = "200" ] || fail "second admin cannot list users (got $code)"
echo "OK — second admin (id $ADMIN2_ID) can administer"

step "DONE — all checks passed"
echo "Left behind: department $DEPT_CODE, document $DOC_NUMBER (released), two users."
