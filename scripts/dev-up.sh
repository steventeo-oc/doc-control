#!/usr/bin/env bash
# Start ONE clean doc-control dev stack on this machine:
#
#   API -> http://localhost:8080   (Spring Boot, context path /api)
#   SPA -> http://localhost:3000   (Vite, proxies /api through to 8080)
#
# Idempotent: anything already holding 8080 or 3000 is stopped first, so this
# doubles as a "collapse the duplicates" button.
#
# Usage:  bash scripts/dev-up.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="$REPO_ROOT/api-8080.log"
WEB_LOG="$REPO_ROOT/web-3000.log"

# Git Bash shells that disable POSIX->Windows path conversion
# (MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL) break Maven: the launcher hands the
# JVM a "/c/..." path and it dies with ClassNotFoundException on
# plexus-classworlds. Clear both. This has to be an unset rather than a wrapper
# function, because the services are started via nohup (an external binary that
# cannot see shell functions).
unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

# PIDs currently LISTENING on a port (covers IPv4 and IPv6 binds).
listeners_on() {
  { netstat -ano -p tcp; netstat -ano -p tcpv6; } 2>/dev/null |
    awk -v port="$1" 'toupper($4) == "LISTENING" { n = split($2, a, ":"); if (a[n] == port) print $NF }' |
    sort -u
}

stop_port() {
  local port=$1 pid
  for pid in $(listeners_on "$port"); do
    echo "  stopping PID $pid (was holding :$port)"
    MSYS_NO_PATHCONV=1 taskkill /PID "$pid" /F >/dev/null 2>&1
  done
}

cd "$REPO_ROOT" || exit 1

# Config: .env first, then the two host-side overrides that differ from the
# in-compose defaults in api/src/main/resources/application.yml.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:15432/doccontrol"
export DOCCONTROL_STORAGE_ENDPOINT="http://localhost:19000"

echo "Freeing ports 8080 and 3000..."
stop_port 8080
stop_port 3000
sleep 2

echo "Starting API on 8080 (log: $API_LOG)"
( cd "$REPO_ROOT/api" && nohup mvn -o spring-boot:run >"$API_LOG" 2>&1 & )

echo "Starting Vite on 3000 (log: $WEB_LOG)"
( cd "$REPO_ROOT/web" && nohup npm run dev >"$WEB_LOG" 2>&1 & )

api=""; spa=""
for _ in $(seq 1 60); do
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:8080/api/auth/me 2>/dev/null)
  spa=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/ 2>/dev/null)
  [ "$api" = "401" ] && [ "$spa" = "200" ] && break
  sleep 2
done

echo
echo "API  http://localhost:8080/api/auth/me -> ${api:-down}   (401 = alive, unauthenticated)"
echo "SPA  http://localhost:3000/            -> ${spa:-down}"
echo "Logs: $API_LOG"
echo "      $WEB_LOG"
