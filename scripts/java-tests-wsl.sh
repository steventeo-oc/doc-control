#!/usr/bin/env bash
#
# Runs the api's Java tests inside WSL against throwaway Postgres 16 and MinIO containers.
#
# Why this exists: on the current dev machine the Windows JVM cannot open a loopback pipe (even a five-line program
# calling Selector.open() fails with "Unable to establish loopback connection"), so no Spring context can start
# there. The same tests run fine in WSL. It is a host networking fault, not a project one; this script is the
# workaround until the host is repaired. It uses neither the compose stack's data nor the Windows dev cluster.
#
#   1. On Windows, compile (WSL only has a Java runtime without the compiler's release data):
#        ( cd api && mvn -o -q test-compile )
#   2. Run:  wsl -u root bash "/mnt/c/Users/Exp Local XYZ/Downloads/doc-control/scripts/java-tests-wsl.sh" [pattern]
#      pattern = surefire -Dtest value, e.g. 'AssistantIndexViewTests,AssistantCorpusVisibilityTests'; empty runs all.
#
# The test JVM runs from a Linux-native copy of the compiled project: with its working directory on the Windows
# drive, the attach handshake that Mockito needs fails and class loading is slow. The Windows Maven repository is
# reused read-only, so nothing is downloaded. Credentials below are the checked-in dev defaults for disposable
# containers on loopback-only ports.

set -u
PATTERN="${1:-}"
REPO="/mnt/c/Users/Exp Local XYZ/Downloads/doc-control"
WORK=/tmp/api-run
PG=assistant-test-pg
MINIO=assistant-test-minio

cleanup() { docker rm -f "$PG" "$MINIO" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
docker rm -f "$PG" "$MINIO" >/dev/null 2>&1

docker run -d --rm --name "$PG" \
  -e POSTGRES_USER=doccontrol -e POSTGRES_PASSWORD=changeme_in_env_file -e POSTGRES_DB=doccontrol \
  -p 127.0.0.1:5435:5432 postgres:16 >/dev/null || exit 1
docker run -d --rm --name "$MINIO" \
  -e MINIO_ROOT_USER=doccontrol -e MINIO_ROOT_PASSWORD=changeme_in_env_file \
  -p 127.0.0.1:9000:9000 minio/minio server /data >/dev/null || exit 1
for _ in $(seq 1 40); do
  docker exec "$PG" pg_isready -U doccontrol -d doccontrol >/dev/null 2>&1 && break
  sleep 1
done

rm -rf "$WORK" && mkdir -p "$WORK"
cp -a "$REPO/api/pom.xml" "$REPO/api/target" "$WORK/" || { echo "compile first: ( cd api && mvn -o -q test-compile )"; exit 1; }
cd "$WORK" || exit 1

ARGS=(-B -ntp -o "-Dmaven.repo.local=/mnt/c/Users/Exp Local XYZ/.m2/repository" surefire:test)
if [ -n "$PATTERN" ]; then ARGS+=("-Dtest=$PATTERN"); fi
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5435/doccontrol \
DOCCONTROL_STORAGE_ENDPOINT=http://localhost:9000 \
  sh "/mnt/c/Users/Exp Local XYZ/scoop/apps/maven/current/bin/mvn" "${ARGS[@]}"
status=$?
echo "MVN EXIT: $status"
exit $status
