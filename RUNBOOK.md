# RUNBOOK — Starting and verifying the Document Control stack (dev machine)

Operational notes for the current development machine. Docker does **not**
run on Windows here — Docker Engine lives inside WSL2, so every docker
command goes through `wsl`. The repo lives at
`C:\Users\Exp Local XYZ\Downloads\doc-control` (in WSL paths:
`/mnt/c/Users/Exp Local XYZ/Downloads/doc-control`).

---

## 1. Starting the stack

All five services (api, web, postgres, minio, gotenberg) come up with one
command, run from any terminal (Git Bash, PowerShell, cmd):

```
wsl -u root bash -c "cd '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && POSTGRES_HOST_PORT=15432 MINIO_HOST_PORT=19000 MINIO_CONSOLE_HOST_PORT=19001 docker compose up -d"
```

- **Never drop the three `POSTGRES_HOST_PORT`/`MINIO_*` variables.** This
  machine also runs a dev Postgres on 15432 and MinIO on 19000/19001 for
  the test suite; the overrides keep the compose services off the default
  ports (5432/9000/9001) so nothing collides. Without them, compose will
  recreate postgres/minio on the wrong host ports.
- Add `--build` after changing code: `... docker compose up -d --build`.
  Plain `up -d` just starts what's already built.
- **Why `-u root`:** passwordless `sudo` is not configured inside WSL — a
  `sudo docker ...` one-liner hangs forever waiting for a password.
  `wsl -u root` runs the same thing as root with no prompt. Don't pipe a
  password; you never need to. (If interactive `sudo` is ever required,
  the password is recorded in the gitignored `.env` — keep it out of
  tracked files.)

### Keeping the stack alive (WSL idle shutdown)

WSL2 shuts the whole VM down when nothing holds a session open — which
stops the containers too. They come back automatically on the next `wsl`
command (`restart: unless-stopped`), but during a long manual session,
hold the VM open with one of:

- an open WSL terminal window (`wsl` from the Start menu), or
- a throwaway sleeper: `wsl -e bash -c "sleep 7200"` left running.

## 2. Confirming it started cleanly

```
wsl -u root docker ps --format "{{.Names}}  {{.Status}}"
```

Expect all five `Up`, with postgres and minio showing `(healthy)` within
~30 seconds. Then:

- API is up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/auth/me`
  → **401 is the healthy answer** (unauthenticated but alive).
- SPA is up: open http://localhost:3000 (HTTP 200).
- Clean boot line: `wsl -u root docker logs doccontrol-api 2>&1 | grep "Started DocControlApplication" | tail -1`
  — a line like `Started DocControlApplication in 9 seconds` means the
  app finished booting.

**Graph/notification config — the two failure modes:**

1. *Missing config* (notification enabled but tenant/client id/secret/
   mailbox not all set) is **fail-fast**: the app dies during bean
   creation and the container restart-loops. Symptom: no
   `Started DocControlApplication` line and `docker ps` shows
   `Restarting`. Confirm with:
   `wsl -u root docker logs doccontrol-api 2>&1 | grep -iE "Error creating bean|notification" | tail -5`
2. *Wrong-but-present secret* does **not** fail startup — it fails later,
   per send, with `Graph token request failed with HTTP 401` in the logs
   (`wsl -u root docker logs doccontrol-api 2>&1 | grep "Graph token" | tail`).
   Successful sends log `NOTIFICATION (graph) to ...`.

To test the mail credential **without ever seeing the secret**, run this
from Git Bash (prints only the HTTP status; 200 = credential valid):

```
wsl -u root docker exec -i doccontrol-api sh <<'EOF'
code=$(curl -s -o /tmp/t.json -w '%{http_code}' -m 20 -X POST \
  "https://login.microsoftonline.com/$DOCCONTROL_NOTIFICATION_TENANT_ID/oauth2/v2.0/token" \
  -d grant_type=client_credentials \
  --data-urlencode "client_id=$DOCCONTROL_NOTIFICATION_CLIENT_ID" \
  --data-urlencode "client_secret=$DOCCONTROL_NOTIFICATION_CLIENT_SECRET" \
  --data-urlencode "scope=https://graph.microsoft.com/.default")
echo "token HTTP: $code"
rm -f /tmp/t.json
EOF
```

(The response body contains a live token — this discards it unread. The
heredoc matters: passing this command as a quoted one-liner through
`wsl` mangles the `$` expansions — feed it via stdin exactly as shown.)

## 3. Logging in

- URL: **http://localhost:3000** (the API is also reachable directly at
  http://localhost:8080/api and is proxied under /api on port 3000).
- Admin account: `admin@doccontrol.local`. The password is the bootstrap
  credential — it comes from `DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD` in the
  gitignored `.env` if that was set when the database was first created,
  otherwise from the dev default in
  `api/src/main/resources/application.yml` (`doccontrol.bootstrap
  .admin-password`). Ask the person who set the machine up. The value
  only takes effect on an **empty** database — changing it later does not
  change the existing admin's password (that's `POST /users/{id}/password`
  territory).
- Stale-cookie login failures (browsers that used the SPA before the
  cookie-path fix) are **self-healing**: the server expires the old
  `Path=/api` cookie automatically once it sees a request carrying the
  duplicate, so the next login attempt just works. No manual cookie
  clearing is needed on any current build.

## 4. Stopping the stack

```
wsl -u root bash -c "cd '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && docker compose stop"
```

`stop` halts the containers but keeps them and all data. `docker compose
down` also removes the containers/network (data volumes still survive).
Either way, `up -d` (section 1) brings everything back. Note the WSL idle
shutdown (section 1) "stops" the stack too — that's normal and also
recovers on its own.

## 5. Checking what data already exists

Before manual testing, look at what's already in the database (the stack
accumulates smoke-test leftovers by design):

```
wsl -u root docker exec -i doccontrol-postgres psql -U doccontrol -d doccontrol <<'EOF'
SELECT id, code, label FROM department ORDER BY id;
SELECT id, email, active FROM "user" ORDER BY id;
SELECT id, document_number, name, status FROM document WHERE deleted_at IS NULL ORDER BY id;
EOF
```

How to read it:

- `SMK...` departments, `SOP-SMK...` documents, `viewer<digits>` /
  `admin2<digits>` users are **smoke-test artifacts** (every smoke run
  leaves one department, one document and three users behind on purpose).
- The `it` and `.7` departments and the "example drawing"/"example sop"
  documents are from earlier manual exploring.
- `admin@doccontrol.local` is the real admin; `system@doccontrol.internal`
  (inactive) is the audit actor for the daily sweep — both expected.
- Anything else is yours. Don't worry about breaking dev data; there is
  no production data on this machine.

## 6. Gotchas specific to this setup

1. **`.env` is the single source for secrets and toggles** (gitignored).
   Compose only reads it when a container is **created** — after editing
   `.env` you must run `docker compose up -d api` to make it take effect;
   a restart alone re-uses the old env. Keep the file's line endings LF —
   a Windows editor saving CRLF can leave stray carriage returns inside
   values that only break things at send time.
2. **Notification flag for test runs**: set
   `DOCCONTROL_NOTIFICATION_ENABLED=false` in `.env` + `up -d api` before
   anything that would email the placeholder smoke users — their
   `@doccontrol.local` addresses bounce, and the NDRs land in the real
   sender mailbox. Flip it back to `true` + `up -d api` afterwards.
3. **sudo hangs; use `wsl -u root`** (see section 1). Interactive `sudo`
   inside WSL prompts for a password that non-interactive one-liners
   can't answer.
4. **WSL idle shutdown** stops the whole stack (section 1). First page
   load after a wake may fail once — refresh.
5. **Test suite vs stack use different databases**: `mvn test` needs the
   Windows-side Postgres on **5434** and MinIO on **9000** (see
   api/README.md); the compose stack's data lives in the WSL volume on
   15432/19000. Numbers that differ between a test run and the browser
   are not a bug.
6. **Smoke test**: `bash scripts/smoke.sh` (Git Bash, stack running)
   walks the whole system end-to-end and prints OK per section. It leaves
   its artifacts behind (see section 5) and is safe to re-run.
