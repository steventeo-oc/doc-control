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
  -d "{\"name\":\"Smoke Viewer $SUFFIX\",\"email\":\"viewer$SUFFIX@doccontrol.local\",\"departments\":[{\"departmentId\":$DEPT_ID,\"level\":\"COLLABORATOR\"}],\"password\":\"viewer-pass-123\"}")"
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

step "5. A second draft is refused while one is in progress (the draft lock)"
# Since 2026-09-17 a document holds one draft at a time: approve or discard it before uploading another.
printf 'Rev B — smoke test content with changes.\n' > "$TMP/rev-b.txt"
code="$(mut "$TMP/admin.jar" -o /dev/null -w '%{http_code}' -X POST "$API/documents/$DOC_ID/versions" \
  -F "file=@$TMP/rev-b.txt;type=text/plain" -F "change_notes=Smoke test revision B")"
[ "$code" = "409" ] || fail "expected 409 for a second draft while draft v1 is in progress, got $code"
echo "OK — 409, the document is locked while its first draft is in progress"

step "6. Download version 1 via the audited original path and verify the bytes round-trip"
# Phase 2e: the default download of a renditionable version returns a
# stamped PDF rendition; original=true is the audited canModify escape hatch
V1_ID="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID/versions" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
api -b "$TMP/admin.jar" -o "$TMP/downloaded.txt" "$API/documents/$DOC_ID/versions/$V1_ID/download?original=true"
grep -q "Rev A" "$TMP/downloaded.txt" || fail "downloaded content does not match"
echo "OK — original download contains the Rev A content"

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
  -d "{\"name\":\"Smoke Admin 2 $SUFFIX\",\"email\":\"admin2$SUFFIX@doccontrol.local\",\"departments\":[{\"departmentId\":$DEPT_ID,\"level\":\"COLLABORATOR\"}],\"password\":\"admin2-pass-123\",\"roles\":[\"Admin\"]}")"
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
echo "OK — approved with effect from $EFFECTIVE; the public still sees the first version"

step "12. The daily sweep flips it on the effective date (admin trigger; idempotent per date)"
mut "$TMP/admin.jar" -X POST "$API/admin/jobs/daily-sweep?date=$EFFECTIVE" > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" status)" = "released" ] || fail "flip: expected status released"
[ "$(field "$DETAIL" currentVersionId)" = "$V3_ID" ] || fail "flip: pointer should now be the newer version"
EXPECT_REVIEW="$(date -d "$EFFECTIVE +12 months" +%F)"
[ "$(field "$DETAIL" nextReviewDue)" = "$EXPECT_REVIEW" ] || fail "flip: nextReviewDue should anchor to the effective date"
mut "$TMP/admin.jar" -X POST "$API/admin/jobs/daily-sweep?date=$EFFECTIVE" > /dev/null
DETAIL="$(api -b "$TMP/admin.jar" "$API/documents/$DOC_ID")"
[ "$(field "$DETAIL" currentVersionId)" = "$V3_ID" ] || fail "second sweep on the same date must not change state"
echo "OK — flipped to the newer version, review due $EXPECT_REVIEW; re-running the sweep changed nothing"

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
echo "OK — department member acknowledged the newer version once (idempotent); $OUT_BEFORE members outstanding before, one fewer after"

step "15. Watermarking (Phase 2e): the released document downloads as a stamped PDF rendition"
# the newer version is text/plain, so the rendition goes through the Gotenberg sidecar
# (LibreOffice headless) and comes back stamped. The first conversion may
# include LibreOffice's lazy start — allow more than the api() timeout.
RENDITION_TYPE="$(curl -s -m 120 -b "$TMP/admin.jar" \
  -o "$TMP/rendition.pdf" -w '%{content_type}' \
  "$API/documents/$DOC_ID/versions/$V3_ID/download")"
[ "$(head -c 5 "$TMP/rendition.pdf")" = "%PDF-" ] || fail "released download is not a PDF rendition"
case "$RENDITION_TYPE" in application/pdf*) ;; *) fail "expected an application/pdf rendition, got '$RENDITION_TYPE'";; esac
echo "OK — the newer version downloaded as a PDF rendition ($RENDITION_TYPE, $(wc -c < "$TMP/rendition.pdf") bytes, converted by the Gotenberg sidecar)"
api -b "$TMP/admin.jar" -o "$TMP/original-v3.txt" \
  "$API/documents/$DOC_ID/versions/$V3_ID/download?original=true"
grep -q "Rev C" "$TMP/original-v3.txt" || fail "original download does not match"
echo "OK — original=true still returns the untouched Rev C bytes (audited)"

step "16. AI assistant (Ask): runs only when the assistant profile is up (RUNBOOK section 7)"
# The assistant is served by the web container's nginx under /api/assistant/, so this section talks to the web
# port, not the api's. The admin and viewer cookies from the api login are sent along (same host, path /api).
WEB="${WEB_URL:-http://localhost:3000}"
ASSIST="${WEB%/}/api/assistant"
ASSIST_DONE=""
code="$(api -o /dev/null -w '%{http_code}' "$ASSIST/health" || true)"
if [ "$code" != "200" ]; then
  echo "SKIPPED — nothing answers at $ASSIST/health (HTTP $code). Start it: docker compose --profile assistant up -d"
else
  assistant_sync() { # trigger a sync, then wait until a newer one has finished
    local before code finished running
    before="$(api -b "$TMP/admin.jar" "$ASSIST/admin/status" \
      | python -c "import sys,json;print((json.load(sys.stdin).get('lastSync') or {}).get('finishedAt'))")"
    code=""
    for _ in 1 2 3 4 5 6; do # a scheduled sync may be running right now: a second one is refused, so retry
      code="$(mut "$TMP/admin.jar" -o /dev/null -w '%{http_code}' -X POST "$ASSIST/admin/sync")"
      [ "$code" = "202" ] && break
      sleep 2
    done
    [ "$code" = "202" ] || fail "assistant: could not start a sync (HTTP $code)"
    for _ in $(seq 1 60); do
      sleep 2
      read -r finished running <<<"$(api -b "$TMP/admin.jar" "$ASSIST/admin/status" \
        | python -c "import sys,json;d=json.load(sys.stdin);print((d.get('lastSync') or {}).get('finishedAt'), d['syncRunning'])")"
      if [ "$running" = "False" ] && [ "$finished" != "$before" ]; then return 0; fi
    done
    fail "assistant: the sync did not finish within two minutes (see $ASSIST/admin/status.html)"
  }
  ask() { # ask "<question>": prints the JSON answer
    mut "$TMP/admin.jar" -X POST "$ASSIST/ask" -H "Content-Type: application/json" -d "{\"question\":\"$1\"}"
  }

  code="$(api -o /dev/null -w '%{http_code}' "$ASSIST/config")"
  [ "$code" = "401" ] || fail "assistant: /config without a session must be 401, got $code"
  CONFIG="$(api -b "$TMP/admin.jar" "$ASSIST/config")"
  echo "OK — 401 without a session; with one: $(printf '%s' "$CONFIG" | python -c "import sys,json;d=json.load(sys.stdin);print('enabled=%s allowed=%s documents=%s' % (d['enabled'], d['allowed'], d['documents']))")"

  code="$(api -b "$TMP/viewer.jar" -o /dev/null -w '%{http_code}' "$ASSIST/admin/status")"
  [ "$code" = "403" ] || fail "assistant: a plain user must get 403 on /admin/status, got $code"
  code="$(api -b "$TMP/admin.jar" -o /dev/null -w '%{http_code}' "$ASSIST/admin/status.html")"
  [ "$code" = "200" ] || fail "assistant: the admin status page returned HTTP $code"
  echo "OK — the status page is for admins only"

  code="$(api -b "$TMP/admin.jar" -o /dev/null -w '%{http_code}' -X POST "$ASSIST/admin/sync")"
  [ "$code" = "403" ] || fail "assistant: a POST without the CSRF header must be 403, got $code"
  code="$(api -b "$TMP/admin.jar" -o /dev/null -w '%{http_code}' -X POST "$ASSIST/admin/sync" \
    -H "X-XSRF-TOKEN: $(csrf_of "$TMP/admin.jar")" -H "Origin: http://evil.example")"
  [ "$code" = "403" ] || fail "assistant: a POST from a foreign origin must be 403, got $code"
  echo "OK — POSTs need the CSRF token and a known Origin"

  if [ "$(field "$CONFIG" enabled)" != "True" ]; then
    echo "NOTE — the assistant is switched off (DOCCONTROL_ASSISTANT_ENABLED=false): the question checks are skipped"
  else
    # A document released through the real approval flow becomes answerable; once trashed it stops being cited.
    printf 'Quokka torque wrench calibration.\nThe quokka torque wrench shall be recalibrated every 37 days against the wombat reference gauge.\nRecord each recalibration in the quokka logbook.\n' > "$TMP/quokka.txt"
    QDOC="$(mut "$TMP/admin.jar" -X POST "$API/documents" \
      -F "document_type_id=$SOP_TYPE_ID" -F "department_id=$DEPT_ID" \
      -F "name=Quokka Torque Wrench Calibration $SUFFIX" -F "file=@$TMP/quokka.txt;type=text/plain")"
    QDOC_ID="$(field "$QDOC" id)"; QNUMBER="$(field "$QDOC" documentNumber)"
    QV1_ID="$(api -b "$TMP/admin.jar" "$API/documents/$QDOC_ID/versions" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
    QINST="$(mut "$TMP/admin.jar" -X POST "$API/documents/$QDOC_ID/versions/$QV1_ID/workflow/start" \
      -H "Content-Type: application/json" -d "{\"assignees\":[{\"type\":\"USER\",\"userId\":$VIEWER_ID}]}" \
      | python -c "import sys,json;print(json.load(sys.stdin)['id'])")"
    QTASK="$(api -b "$TMP/viewer.jar" "$API/workflow-instances/$QINST/tasks" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")"
    mut "$TMP/viewer.jar" -X POST "$API/workflow-tasks/$QTASK/complete" \
      -H "Content-Type: application/json" -d '{"approved":true,"comment":"Smoke approval"}' > /dev/null
    [ "$(field "$(api -b "$TMP/admin.jar" "$API/documents/$QDOC_ID")" status)" = "released" ] || fail "assistant: the fixture document was not released"
    echo "OK — $QNUMBER released; syncing the assistant"

    assistant_sync
    printf '%s' "$(ask "How often must the quokka torque wrench be recalibrated?")" | python -c "
import sys, json
d = json.load(sys.stdin)
assert d['state'] == 'answered', 'state was ' + d['state'] + ': ' + d['answer'][:200]
assert any(s['documentNumber'] == '$QNUMBER' and s['cited'] for s in d['sources']), 'not cited: ' + json.dumps([s['documentNumber'] for s in d['sources']])
print('OK — answered and cited $QNUMBER (%s ms, model %s, prompt %s)' % (d['ms'], d['model'], d['promptVersion']))
" || fail "assistant: the released document was not answered from"

    NOTFOUND="$(ask "What is the reimbursement limit for client dinners?")"
    [ "$(field "$NOTFOUND" state)" = "not_found" ] || fail "assistant: an uncovered question must be not_found, got $(field "$NOTFOUND" state)"
    echo "OK — a question the documents do not cover is answered as not_found"

    mut "$TMP/admin.jar" -X DELETE "$API/documents/$QDOC_ID" > /dev/null
    assistant_sync
    printf '%s' "$(ask "How often must the quokka torque wrench be recalibrated?")" | python -c "
import sys, json
d = json.load(sys.stdin)
assert all(s['documentNumber'] != '$QNUMBER' for s in d['sources']), 'the trashed document is still a source'
print('OK — after the document was trashed and the next sync, $QNUMBER is no longer a source')
" || fail "assistant: a trashed document is still being cited"
    ASSIST_DONE="; assistant fixture $QNUMBER (trashed)"
  fi
fi

step "DONE — all checks passed"
echo "Left behind: department $DEPT_CODE, document $DOC_NUMBER (released, second version effective, acknowledged), three users$ASSIST_DONE."
