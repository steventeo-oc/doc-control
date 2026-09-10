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
# The API is mounted under /api (server.servlet.context-path) so the SPA owns
# every other path — see application.yml.
API="${BASE_URL%/}/api"
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

# CSRF: the backend sets an XSRF-TOKEN cookie; mutating requests echo it in
# the X-XSRF-TOKEN header (double-submit cookie scheme).
csrf_of() { awk -F'\t' '$6 == "XSRF-TOKEN" {v=$7} END {print v}' "$1"; }

login() { # login <cookiejar> <email> <password>
  api -c "$1" -o /dev/null "$API/auth/me"   # seeds the XSRF-TOKEN cookie
  api -c "$1" -b "$1" -o /dev/null -X POST "$API/auth/login" \
    -H "Content-Type: application/json" -H "X-XSRF-TOKEN: $(csrf_of "$1")" \
    -d "{\"email\":\"$2\",\"password\":\"$3\"}"
}

mut() { # mut <cookiejar> <curl args...> — mutating call with the CSRF header
  local jar="$1"; shift
  api -b "$jar" -c "$jar" -H "X-XSRF-TOKEN: $(csrf_of "$jar")" "$@"
}

field() { # field <json-payload> <key>
  printf '%s' "$1" | python -c "import sys,json;print(json.load(sys.stdin)['$2'])"
}

step "0. Preflight — unauthenticated /auth/me must be rejected"
code="$(api -o /dev/null -w '%{http_code}' "$API/auth/me")"
[ "$code" = "401" ] || fail "expected 401 from /auth/me, got $code"
echo "OK (401 as expected)"

step "1. Login as admin"
login "$TMP/admin.jar" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
ME="$(api -b "$TMP/admin.jar" "$API/auth/me")"
[ "$(field "$ME" email)" = "$ADMIN_EMAIL" ] || fail "admin login failed"
echo "OK — authenticated as $ADMIN_EMAIL"

step "2. Create a department (extensible lookup — a pure data change)"
DEPT="$(mut "$TMP/admin.jar" -X POST "$API/departments" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"SMK$SUFFIX\",\"label\":\"Smoke Test Dept $SUFFIX\"}")"
DEPT_ID="$(field "$DEPT" id)"; DEPT_CODE="$(field "$DEPT" code)"
echo "OK — department $DEPT_CODE (id $DEPT_ID)"

step "3. Create a second, regular user (roles default to User)"
USER_JSON="$(mut "$TMP/admin.jar" -X POST "$API/users" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Viewer $SUFFIX\",\"email\":\"viewer$SUFFIX@doccontrol.local\",\"departmentIds\":[$DEPT_ID],\"password\":\"viewer-pass-123\"}")"
VIEWER_ID="$(field "$USER_JSON" id)"
login "$TMP/viewer.jar" "viewer$SUFFIX@doccontrol.local" "viewer-pass-123"
echo "OK — viewer user id $VIEWER_ID, logged in"

step "4. Create a document with a file (file becomes version 1)"
printf 'Rev A — smoke test content.\n' > "$TMP/rev-a.txt"
SOP_TYPE_ID="$(api -b "$TMP/admin.jar" "$API/document-types" \
  | python -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t['code']=='SOP'][0])")"
DOC="$(mut "$TMP/admin.jar" -X POST "$API/documents" \
  -F "document_type_id=$SOP_TYPE_ID" -F "department_id=$DEPT_ID" \
  -F "name=Smoke Test Procedure $SUFFIX" -F "file=@$TMP/rev-a.txt;type=text/plain")"
DOC_ID="$(field "$DOC" id)"; DOC_NUMBER="$(field "$DOC" documentNumber)"
echo "OK — $DOC_NUMBER (id $DOC_ID), version 1 stored, current_version_id=$(field "$DOC" currentVersionId)"

step "5. Upload version 2"
printf 'Rev B — smoke test content with changes.\n' > "$TMP/rev-b.txt"
V2="$(mut "$TMP/admin.jar" -X POST "$API/documents/$DOC_ID/versions" \
  -F "file=@$TMP/rev-b.txt;type=text/plain" -F "change_notes=Smoke test revision B")"
V2_ID="$(field "$V2" id)"
echo "OK — version $(field "$V2" versionNumber) uploaded (id $V2_ID)"

step "6. Download version 2 and verify the bytes round-trip"
api -b "$TMP/admin.jar" -o "$TMP/downloaded.txt" "$API/documents/$DOC_ID/versions/$V2_ID/download"
grep -q "Rev B" "$TMP/downloaded.txt" || fail "downloaded content does not match"
echo "OK — downloaded file contains the Rev B content"

step "7. A department member can see their department's draft (Phase 2a member visibility)"
code="$(api -b "$TMP/viewer.jar" -o /dev/null -w '%{http_code}' "$API/documents/$DOC_ID")"
[ "$code" = "200" ] || fail "expected 200 for department member viewing draft, got $code"
echo "OK (200 — the viewer is a member of the document's department)"
step "8. Owner starts the approval workflow; the viewer is the assigned reviewer"
VIEWER_ID="$(field "$USER_JSON" id)"
V1_ID="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID/versions" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
INST="$(mut "$TMP/admin.jar" -X POST "$API/documents/$DOC_ID/versions/$V1_ID/workflow/start"   -H "Content-Type: application/json"   -d "{\"assignees\":[{\"type\":\"USER\",\"userId\":$VIEWER_ID}]}"   | python -c "import sys,json;print(json.load(sys.stdin)['id'])")"
TASK="$(api -b "$TMP/viewer.jar" "$API/workflow-instances/$INST/tasks" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
echo "OK — approval instance $INST started, reviewer task assigned"

step "9. The reviewer approves — 100% reached, document released and version promoted"
mut "$TMP/viewer.jar" -X POST "$API/workflow-tasks/$TASK/complete"   -H "Content-Type: application/json"   -d '{"approved":true,"comment":"Smoke approval"}'   | python -c "import sys,json;d=json.load(sys.stdin);print('OK — approval', d['status'])"

step "9b. The second user can now see the released document"
SEEN="$(api -b "$TMP/viewer.jar" "$API/documents/$DOC_ID")"
[ "$(field "$SEEN" status)" = "released" ] || fail "document is not released"
[ "$(field "$SEEN" currentVersionId)" = "$V1_ID" ] || fail "released version is not current"
echo "OK — viewer reads $DOC_NUMBER, released with version 1 current"

step "10. Bonus: create a second ADMIN via roles on create (break-glass account)"
ADMIN2="$(mut "$TMP/admin.jar" -X POST "$API/users" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Admin 2 $SUFFIX\",\"email\":\"admin2$SUFFIX@doccontrol.local\",\"departmentIds\":[$DEPT_ID],\"password\":\"admin2-pass-123\",\"roles\":[\"Admin\"]}")"
ADMIN2_ID="$(field "$ADMIN2" id)"
login "$TMP/admin2.jar" "admin2$SUFFIX@doccontrol.local" "admin2-pass-123"
code="$(api -b "$TMP/admin2.jar" -o /dev/null -w '%{http_code}' "$API/users")"
[ "$code" = "200" ] || fail "second admin cannot list users (got $code)"
echo "OK — second admin (id $ADMIN2_ID) can administer"

step "11. Deferred approval: a future effective date parks the document in 'approved'"
EFFECTIVE="$(date -d '+2 days' +%F)"
printf 'Rev C — smoke test content.\n' > "$TMP/rev-c.txt"
V3="$(mut "$TMP/admin.jar" -X POST "$API/documents/$DOC_ID/versions" \
  -F "file=@$TMP/rev-c.txt;type=text/plain" -F "change_notes=Smoke test revision C")"
V3_ID="$(field "$V3" id)"
INST2="$(mut "$TMP/admin.jar" -X POST "$API/documents/$DOC_ID/versions/$V3_ID/workflow/start" \
  -H "Content-Type: application/json" \
  -d "{\"assignees\":[{\"type\":\"USER\",\"userId\":$VIEWER_ID}]}")"
INST2_ID="$(field "$INST2" id)"
TASK2_ID="$(api -b "$TMP/viewer.jar" "$API/workflow-instances/$INST2_ID/tasks" \
  | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
mut "$TMP/viewer.jar" -X POST "$API/workflow-tasks/$TASK2_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{\"approved\":true,\"comment\":\"Deferred smoke approval\",\"effectiveDate\":\"$EFFECTIVE\"}" > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" status)" = "approved" ] || fail "deferred approval: expected status approved"
[ "$(field "$DETAIL" currentVersionId)" = "$V1_ID" ] || fail "deferred approval: pointer must stay on the released version"
[ "$(field "$DETAIL" pendingEffectiveDate)" = "$EFFECTIVE" ] || fail "pendingEffectiveDate mismatch"
echo "OK — approved with effect from $EFFECTIVE; the public still sees version 1"

step "12. The daily sweep flips it on the effective date (admin trigger; idempotent per date)"
mut "$TMP/admin.jar" -X POST "$API/admin/jobs/daily-sweep?date=$EFFECTIVE" > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" status)" = "released" ] || fail "flip: expected status released"
[ "$(field "$DETAIL" currentVersionId)" = "$V3_ID" ] || fail "flip: pointer should now be version 3"
EXPECT_REVIEW="$(date -d "$EFFECTIVE +12 months" +%F)"
[ "$(field "$DETAIL" nextReviewDue)" = "$EXPECT_REVIEW" ] || fail "flip: nextReviewDue should anchor to the effective date"
mut "$TMP/admin.jar" -X POST "$API/admin/jobs/daily-sweep?date=$EFFECTIVE" > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" currentVersionId)" = "$V3_ID" ] || fail "second sweep on the same date must not change state"
echo "OK — flipped to version 3, review due $EXPECT_REVIEW; re-running the sweep changed nothing"

step "13. Periodic review re-approval is visibly flagged and re-certifies in place"
INST3="$(mut "$TMP/admin.jar" -X POST "$API/documents/$DOC_ID/review-approval" \
  -H "Content-Type: application/json" \
  -d "{\"assignees\":[{\"type\":\"USER\",\"userId\":$VIEWER_ID}]}")"
INST3_ID="$(field "$INST3" id)"
[ "$(field "$INST3" reapproval)" = "True" ] || fail "instance is not flagged as a re-approval"
TASKS3="$(api -b "$TMP/viewer.jar" "$API/workflow-instances/$INST3_ID/tasks")"
[ "$(printf '%s' "$TASKS3" | python -c "import sys,json;print(json.load(sys.stdin)[0]['name'])")" = "Periodic review re-approval" ] \
  || fail "reviewer task is not visibly flagged as a re-approval"
TASK3_ID="$(printf '%s' "$TASKS3" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
mut "$TMP/viewer.jar" -X POST "$API/workflow-tasks/$TASK3_ID/complete" \
  -H "Content-Type: application/json" -d '{"approved":true,"comment":"Still accurate"}' > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" status)" = "released" ] || fail "re-approval must not change the release state"
[ "$(field "$DETAIL" currentVersionId)" = "$V3_ID" ] || fail "re-approval must not move the version pointer"
[ "$(field "$DETAIL" lastReviewedAt)" = "$(date +%F)" ] || fail "re-approval must reset the review clock to today"
[ "$(field "$DETAIL" nextReviewDue)" = "$(date -d '+12 months' +%F)" ] || fail "nextReviewDue should anchor to today"
echo "OK — re-approval completed; pointer unchanged, review clock reset"

step "14. Read & understood acknowledgment: recorded once, reflected in status"
ACKS="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID/acknowledgments")"
OUT_BEFORE="$(printf '%s' "$ACKS" | python -c "import sys,json;print(len(json.load(sys.stdin)['outstanding']))")"
[ "$OUT_BEFORE" -ge 1 ] || fail "expected department members to be outstanding before acknowledging"
ACK1="$(mut "$TMP/viewer.jar" -X POST "$API/documents/$DOC_ID/acknowledge")"
[ "$(field "$ACK1" documentVersionId)" = "$V3_ID" ] || fail "acknowledged the wrong version"
ACK2="$(mut "$TMP/viewer.jar" -X POST "$API/documents/$DOC_ID/acknowledge")"
[ "$(field "$ACK2" id)" = "$(field "$ACK1" id)" ] || fail "acknowledge must be idempotent"
ACKS="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID/acknowledgments")"
[ "$(printf '%s' "$ACKS" | python -c "import sys,json;print(len(json.load(sys.stdin)['outstanding']))")" = "$((OUT_BEFORE - 1))" ] \
  || fail "outstanding should drop by exactly one after acknowledging"
[ "$(printf '%s' "$ACKS" | python -c "import sys,json;print(len(json.load(sys.stdin)['acknowledged']))")" = "1" ] \
  || fail "acknowledged should contain exactly the one record"
echo "OK — department member acknowledged version 3 once (idempotent); $OUT_BEFORE members outstanding before, one fewer after"

step "DONE — all checks passed"
echo "Left behind: department $DEPT_CODE, document $DOC_NUMBER (released, v3 effective, acknowledged), three users."
