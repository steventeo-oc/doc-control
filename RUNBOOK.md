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
  only takes effect while the database has **no active user yet** (the
  inactive System user doesn't count) — changing it later does not
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
   are not a bug. If the dev cluster is down, start it with the port
   override — its `postgresql.conf` still says 5432, so without `-o
   "-p 5434"` it comes up on the wrong port and every test 404s its
   connection:
   `"C:\Program Files\PostgreSQL\15\bin\pg_ctl.exe" -D
   "C:\Users\Exp Local XYZ\.doccontrol-dev\pgdata" -l
   "C:\Users\Exp Local XYZ\.doccontrol-dev\pg.log" -o "-p 5434" start`.
6. **Smoke test**: `bash scripts/smoke.sh` (Git Bash, stack running)
   walks the whole system end-to-end and prints OK per section. It leaves
   its artifacts behind (see section 5) and is safe to re-run.
7. **Java tests cannot start a Spring context on the Windows host** (found
   2026-09-21): the JVM fails to open a loopback pipe (`Selector.open()`
   throws "Unable to establish loopback connection", even in a five-line
   program), so every `@SpringBootTest` dies at bean creation. It is a host
   networking fault, not a project one; repairing it means changing
   Windows network settings, which was left to the machine's owner.
   Workaround that needs nothing installed: compile on Windows, run the
   tests in WSL against throwaway Postgres 16 and MinIO containers (ports
   5435 and 9000 on loopback; the compose stack's data is never touched):
   `( cd api && mvn -o -q test-compile )` and then
   `wsl -u root bash "/mnt/c/Users/Exp Local XYZ/Downloads/doc-control/scripts/java-tests-wsl.sh" [Class1,Class2]`
   (no argument runs the whole suite; verified 2026-09-21: all 156 tests
   pass this way). See the script's header for why it copies the project to
   a Linux path first.

---

## 7. The AI assistant ("Ask")

Optional. Nothing here starts unless its compose profile is used, so the stack
behaves exactly as before without it. Design and decisions:
`AI_Assistant_Design_PlanBack.md`; the service is `assistant/` (Python).

### One-time setup per deployment

1. **Migration V12** creates the view `assistant_indexable_version` (the
   documents every signed-in user can already read: approved or released,
   current version, not trashed). It runs when the api starts on a build
   that has it: `docker compose up -d --build api web` (the nginx route
   lives in `web`).
2. **Two read-only credentials**, generated and stored in the gitignored
   `.env`, never printed: `bash scripts/assistant-setup.sh` (dev machine:
   `wsl -u root bash -c "cd '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && bash scripts/assistant-setup.sh"`).
   It creates the Postgres role `assistant_ro` (SELECT on the view only;
   it cannot read the `document` table) and the MinIO user `assistant_ro`
   (read objects in the bucket, no write), then proves both. Safe to re-run;
   it keeps the existing secrets. Note the MinIO user can read every object
   in the bucket, drafts included (MinIO cannot restrict by document
   status); the assistant only ever fetches the keys the view lists.
3. **Model servers**, in `.env`:
   - *This dev machine (no GPU)*: the stand-ins in the `mock-models` profile,
     plumbing only, the answers prove nothing about quality:
     `ASSISTANT_LLM_BASE_URL`, `ASSISTANT_EMB_BASE_URL` and
     `ASSISTANT_RERANK_BASE_URL` all `http://mock-models:8010/v1`.
   - *The production box*: `docker-compose.ai.yml` runs the embedding and
     reranker containers (GPUs 4 and 7) and joins the assistant to the LLM's
     network. Set `ASSISTANT_LLM_BASE_URL` (`http://<llm container>:<port>/v1`),
     `ASSISTANT_LLM_API_KEY` (the dedicated key) and `LLM_DOCKER_NETWORK`
     (`docker network ls`; `docker inspect <llm container>` shows which).
     On the current box (found 2026-09-22) doc-control runs as the Compose
     project `doc-control` (network `doc-control_default`) next to the LLM's
     project, whose network is `deepseek-v41-flash-4x-rtx-pro-6000_default`:
     that is the value for `LLM_DOCKER_NETWORK`. The LLM container's name and
     the port it listens on inside its network still have to be read off the
     box: `docker network inspect deepseek-v41-flash-4x-rtx-pro-6000_default
     --format '{{range .Containers}}{{.Name}} {{end}}'` lists the names, and
     `docker ps --format '{{.Names}}  {{.Ports}}'` shows the port mapping
     (the right-hand side of `127.0.0.1:8010->NNNN/tcp` is the port to use).
     Remove the hand-started spike containers once: `docker rm -f emb-qwen rerank`.
4. **Start it**, from the repo root:
   - dev machine: `wsl -u root bash -c "cd '/mnt/c/Users/Exp Local XYZ/Downloads/doc-control' && POSTGRES_HOST_PORT=15432 MINIO_HOST_PORT=19000 MINIO_CONSOLE_HOST_PORT=19001 docker compose --profile assistant --profile mock-models up -d --build"`
   - the box: `docker compose -f docker-compose.yml -f docker-compose.ai.yml --profile assistant up -d --build`
   - to rebuild only the assistant after a code change, add `--no-deps` and its name:
     `docker compose --profile assistant --profile mock-models up -d --build --no-deps assistant`.
     Without `--no-deps`, `--build` also rebuilds `api` (a dependency), which then gets recreated.
5. **Look at the status page** (signed in as an admin):
   `http://localhost:3000/api/assistant/admin/status.html`. It shows the
   documents that are searchable, those skipped (a DWG, an image, a scan with
   no text layer: each with its reason) or failed (with attempts and the next
   retry), how many credentials were replaced in which documents, the last sync
   and whether the three model servers answer. "Sync now" starts a sync at once;
   otherwise it runs every 5 minutes.

### Trying the real AI first

The real models run on the box's GPUs and are published on the box's loopback only, so this dev machine cannot reach them (it
runs the stand-ins). Three ways, quickest first:

1. **Ask questions in a terminal on the box: nothing is deployed and nothing is touched** (about five minutes).
   `python -m app.chat` runs the service's own code path (extraction, credential redaction, chunking, hybrid search, reranker,
   neighbouring passages, the prompt, the three answer states) over a folder of documents; here, the 25 ENG documents of the
   spike. Copy the folder from this PC as the gate was copied, then run it in the shell where the gate ran (it needs
   `LLM_API_KEY` there):

   ```
   scp -r "C:\Users\Exp Local XYZ\Downloads\doc-control\assistant" overclock@192.168.9.138:~/
   PYTHONPATH=~/assistant ~/rag-spike/.venv/bin/python -m app.chat --docs ~/rag-spike/docs --data ~/assistant/chat-data
   ```

   `--context` also prints the passages the model was shown, `--ask "..."` (repeatable) asks without the keyboard, and
   `--prompt strict-1` compares prompts. It needs only the packages the gate needs (a test keeps it that way).
2. **The page with the real AI: switch it on privately on the box** (the steps below, ending with
   `ASSISTANT_ALLOWED_DEPARTMENTS=QA`). This is the test that includes sign-in, the released documents in doc-control, the query
   log and the feedback buttons.
3. **From this machine, through SSH tunnels to the box's ports 8010, 8011 and 8012.** Possible in principle, but the tunnels must
   be reachable from inside WSL's Docker (a tunnel on Windows' localhost is not), the LLM key would sit in this machine's `.env`,
   and this system's documents are test leftovers until the ENG documents are loaded into it. Not recommended until the
   dedicated key exists; the stand-ins stay the default here.

### On the box, step by step

Facts read off the box on 2026-09-22: doc-control runs as the Compose project `doc-control`, with its web container published
on **3001** (Open WebUI owns 3000); the LLM container is `deepseek-v41-flash-4x-rtx-pro-6000-deepseek-1`, listening on **8010**
inside the network `deepseek-v41-flash-4x-rtx-pro-6000_default`; `emb-qwen` and `rerank` are the hand-started spike containers.
This is production for colleagues, so several steps are about not surprising them.

1. **Find the folder doc-control runs from, and which version it is.**
   `docker inspect doccontrol-api --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'` prints the
   folder (it holds `docker-compose.yml` and `.env`). If it is a git checkout, `git -C <folder> log -1 --oneline` gives the
   commit. Everything committed after that commit ships together with the assistant when the api and web are rebuilt, so read
   `git log <that commit>..origin/main --oneline` first.
2. **Get the code there.** `git pull` in that folder (the remote is GitHub, `steventeo-oc/doc-control`), or copy the changed
   folders across.
3. **Back up the database before the migration.** V12 only adds a view, but this is the production database:
   `docker exec doccontrol-postgres pg_dump -U doccontrol -Fc doccontrol > ~/doccontrol-before-v12.dump`
4. **Add to the box's `.env`**, typing the key straight into the file (the two read-only credentials arrive in step 6; keep the
   switch off for now):

   ```
   DOCCONTROL_ASSISTANT_ENABLED=false
   LLM_DOCKER_NETWORK=deepseek-v41-flash-4x-rtx-pro-6000_default
   ASSISTANT_LLM_BASE_URL=http://deepseek-v41-flash-4x-rtx-pro-6000-deepseek-1:8010/v1
   ASSISTANT_LLM_MODEL=deepseek-v4.1-flash
   ASSISTANT_LLM_API_KEY=<the dedicated key>
   ```

5. **Rebuild the api and web.** This applies V12 and restarts both briefly, so tell colleagues or do it out of hours:
   `docker compose up -d --build api web`
6. **Create the two read-only credentials:** `bash scripts/assistant-setup.sh`. It prints only OK lines.
7. **Replace the spike containers and start the assistant:** `docker rm -f emb-qwen rerank`, then
   `docker compose -f docker-compose.yml -f docker-compose.ai.yml --profile assistant up -d --build`.
   The embedding and reranker containers need a minute or two to load their models. Run it as the `overclock` user, not with
   `sudo`: the model cache is `~/hf-cache` (override with `HF_CACHE_DIR`), and under another user it would point somewhere empty.
8. **Look at the status page** as an admin, at `http://<the box>:3001/api/assistant/admin/status.html`. Expect the released
   documents to be searchable and the three servers to say `ok`; skipped documents are listed with their reason.
9. **Try it yourself first.** Set `DOCCONTROL_ASSISTANT_ENABLED=true` and, to keep it to your own department for now,
   `ASSISTANT_ALLOWED_DEPARTMENTS=QA` (department codes, comma-separated), then run the command from step 7 again
   (it recreates only what changed). Ask real questions from the Ask page and rate the answers.
10. **Switch on for everyone:** delete the `ASSISTANT_ALLOWED_DEPARTMENTS` line and run the same command once more.

Nothing needs configuring for the address people type: a request from the page's own address (an IP or any host name) is always
accepted, and `ASSISTANT_ALLOWED_ORIGINS` only adds to that. To roll back, `docker compose ... stop assistant` (the Ask entry
disappears at once); the view is harmless, and the dump from step 3 is only for the unlikely case that something else went wrong.
Postgres, MinIO and the api are published on all interfaces on this box (15432, 19000/19001, 8080), a known open item; the
assistant does not use those ports, it talks to them over the internal network.

### Where doc-control runs

Today doc-control and the model servers are on the same box, which is what
`docker-compose.ai.yml` assumes. If doc-control later moves to another
machine, nothing in the assistant changes except addresses: `ASSISTANT_DB_URL`,
`ASSISTANT_MINIO_ENDPOINT`, `ASSISTANT_API_URL` and the three model URLs are
plain settings. The assistant should then move with doc-control (it reads its
database and files), the `llm` network in `docker-compose.ai.yml` is replaced
by the box's address, and the model servers need a route that is reachable
from the other machine and protected by a key (and TLS).

**Never run `scripts/smoke.sh` against a production database.** It creates a
department, users and documents on purpose and leaves them behind, and its
approvals email placeholder addresses. On the box, check the assistant with
the status page and real questions, and run the release gate (`assistant/README.md`).

### Day to day

- **Switch on for everyone**: `DOCCONTROL_ASSISTANT_ENABLED=true` in `.env`
  and `up -d assistant` (compose only reads `.env` when a container is
  created). With `false`, nobody sees "Ask" but admins still get the status
  page and the index keeps syncing. With `true`, every signed-in user gets an
  **Ask** entry in the left menu (after Documents, and in the phone menu); an
  admin also sees an "Index status" link at the top of the page. If the
  assistant container is stopped, the entry simply disappears for everyone.
- **New, changed and retired documents** follow automatically within about 5
  minutes of becoming current or leaving: the sync reads the view, not events.
- **The query log** (questions, answers, sources, ratings) is in the
  `assistant_data` volume, not in `audit_log`. Admins download it as CSV at
  `/api/assistant/admin/log.csv`. **Back this volume up**: the index is
  rebuildable in minutes, the log and the feedback are not.
- **Logs**: `docker logs doccontrol-assistant`. A model outage is one warning
  line per sync, not a stack trace; the status page names the server.
- **Stop it**: `docker compose --profile assistant --profile mock-models stop`
  (a plain `docker compose down` does not touch containers of an inactive
  profile). Nothing else depends on it.
- **Release gate** (after any change to the prompt, the model or the
  configuration, and weekly with real questions appended): on the box,
  `python -m app.gate` from `assistant/` (see `assistant/README.md`).
- **Smoke section 16** runs when the assistant is up and skips itself when it
  is not. It releases a fixture document through the real approval flow,
  syncs, asks a question it answers and one it does not, trashes the
  document, syncs and asks again. With the stand-in models it proves the
  plumbing only; run it on the box for the real models.

### Weekly review

The plan-back's actual go-live condition, not optional: the pilot is meant
to be watched, not just switched on. Once a week (an admin, signed in):

1. **Download the log** — `/api/assistant/admin/log.csv`, optionally
   `?since=2026-09-15` for just the last 7 days.
2. **Summarise it**:
   ```
   python -m tools.weekly_summary ~/Downloads/assistant-log.csv
   ```
   (from `assistant/`, any Python with no extra packages needed). Prints
   active users, questions per user, the share rated helpful, the share
   not covered with its most-repeated questions, thumbs-down comments, and
   p50/p95 latency.
3. **Look at the status page** too — the CSV can't see sync health,
   skipped/failed documents, or whether a model server is reachable right
   now; `/api/assistant/admin/status.html` is the only place for those.

What to actually do with it: a **repeated not-covered question** is either
a real content gap (tell the document's owner) or a naming/phrasing
problem (a candidate to add to the golden set so the release gate starts
checking it); a **thumbs-down with a comment** is direct, specific
feedback — read every one; a **rising p95** or a **model marked down on
the status page** is worth investigating before it becomes a pattern.
`AI_Assistant_Design_PlanBack.md` §8 has the fuller list of what "good"
looks like after four weeks.
