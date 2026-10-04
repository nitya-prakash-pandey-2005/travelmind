#!/usr/bin/env bash
# Run the k6 mixed scenario against the production-like stack (deploy/) and sample the stack.
#
#   bash loadtest/run.sh                    # K6_STAGES=full (the plan's 1000-VU ramp)
#   K6_STAGES=smoke bash loadtest/run.sh    # 50 VUs, about 2 minutes
#   K6_STAGES=steps bash loadtest/run.sh    # 200 / 500 / 1000 with a 3-minute hold at each
#   K6_STAGES=200:1m,200:3m,0:30s bash loadtest/run.sh
#
# Needs: the stack up (with deploy/.env.loadtest), loadtest/users.json from loadtest/seed.py,
# docker and bash. k6 runs in a container (grafana/k6) on the stack's network and hits nginx.
#
# Output in loadtest/results/ (git-ignored except *-summary.json):
#   <run>-summary.json   per-kind and per-level p50/p95/p99, error rate, RPS (k6 handleSummary)
#   <run>-k6.log         k6's console output
#   <run>-stats.txt      every SAMPLE_EVERY s: host free memory, docker stats, PgBouncer
#                        SHOW POOLS, Postgres connections by state
#   <run>-metrics-<t>.txt  the API's /metrics (merged gunicorn workers), every METRICS_EVERY s
#
# Safety: when the host's free memory drops below MIN_FREE_MB (default 400), k6 is stopped at
# once (SIGTERM, so the summary is still written; SIGKILL after 20 s) and <run>-abort.txt records
# the moment with per-container memory. Set MIN_FREE_MB=0 to turn that off.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${PROJECT:-travelmind-prod}"
NETWORK="${NETWORK:-${PROJECT}_default}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:latest}"
# K6_STAGES is accepted for convenience; k6 gets it as LT_STAGES (k6 reserves K6_STAGES).
STAGES="${LT_STAGES:-${K6_STAGES:-full}}"
RUN_ID="${RUN_ID:-$(date +%Y-%m-%d)-${STAGES//[:,]/_}}"
SAMPLE_EVERY="${SAMPLE_EVERY:-15}"
METRICS_EVERY="${METRICS_EVERY:-60}"
MIN_FREE_MB="${MIN_FREE_MB:-400}"
K6_NAME="${PROJECT}-k6"
RESULTS="$ROOT/loadtest/results"
PG="${PROJECT}-postgres-1"
API="${PROJECT}-api-1"
NGINX="${PROJECT}-nginx-1"

mkdir -p "$RESULTS"
[ -f "$ROOT/loadtest/users.json" ] || { echo "loadtest/users.json missing: run loadtest/seed.py" >&2; exit 1; }

# Git Bash on Windows: keep container paths as they are, and give docker a Windows host path.
MOUNT="$ROOT/loadtest"
if [ -n "${MSYSTEM:-}" ]; then
  export MSYS_NO_PATHCONV=1
  MOUNT="$(cd "$ROOT/loadtest" && pwd -W)"
fi

free_mb() {
  # Linux: MemAvailable. Git Bash on Windows emulates /proc/meminfo with MemFree only, which is
  # Windows' free physical memory (the same figure as Win32_OperatingSystem.FreePhysicalMemory).
  if [ -r /proc/meminfo ]; then
    awk '/^MemAvailable:/ {a=$2} /^MemFree:/ {f=$2} END {print int((a ? a : f) / 1024)}' /proc/meminfo
  else
    echo -1
  fi
}

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

sample() {
  local out="$RESULTS/$RUN_ID-stats.txt"
  {
    echo "=== $(stamp) host_free_mb=$(free_mb)"
    docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>&1 || true
    echo "--- pgbouncer SHOW POOLS"
    docker exec "$PG" sh -c \
      'PGPASSWORD="$OWNER_DB_PASSWORD" psql -h pgbouncer -U travelmind_owner -d pgbouncer -c "SHOW POOLS"' 2>&1 || true
    echo "--- postgres connections by state"
    docker exec "$PG" psql -U postgres -d travelmind -Atc \
      "select coalesce(state,'(bg)'), count(*) from pg_stat_activity group by 1 order by 1" 2>&1 || true
  } >>"$out"
}

scrape_metrics() {
  local token
  token="$(docker exec "$API" printenv TM_METRICS_TOKEN 2>/dev/null || true)"
  [ -n "$token" ] || return 0
  # nginx's busybox wget, inside the network (nginx itself answers /metrics with 404).
  docker exec "$NGINX" wget -q -O - --header "Authorization: Bearer $token" \
    http://api:8000/metrics >"$RESULTS/$RUN_ID-metrics-$(date -u +%H%M%S).txt" 2>/dev/null || true
}

watch_memory() {
  [ "$MIN_FREE_MB" -gt 0 ] || return 0
  while docker inspect "$K6_NAME" >/dev/null 2>&1; do
    local mb
    mb="$(free_mb)"
    if [ "$mb" -ge 0 ] && [ "$mb" -lt "$MIN_FREE_MB" ]; then
      # SIGTERM first: k6 stops the test and still writes its summary. Hard kill after 20 s.
      docker kill --signal=TERM "$K6_NAME" >/dev/null 2>&1 || true
      echo "ABORTED: host free memory ${mb} MB < ${MIN_FREE_MB} MB" >&2
      {
        echo "=== $(stamp) ABORT host_free_mb=$mb < $MIN_FREE_MB: stopping k6"
        docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>&1 || true
      } >"$RESULTS/$RUN_ID-abort.txt" # its own file: concurrent appends interleave on Windows
      local waited=0
      while docker inspect -f '{{.State.Running}}' "$K6_NAME" 2>/dev/null | grep -q true; do
        if [ "$waited" -ge 20 ]; then docker kill "$K6_NAME" >/dev/null 2>&1 || true; break; fi
        sleep 1
        waited=$((waited + 1))
      done
      return 0
    fi
    sleep 5
  done
}

sampler() {
  local n=0
  sleep 2
  while docker inspect "$K6_NAME" >/dev/null 2>&1; do
    sample
    if [ $((n % (METRICS_EVERY / SAMPLE_EVERY))) -eq 0 ]; then scrape_metrics; fi
    n=$((n + 1))
    sleep "$SAMPLE_EVERY"
  done
}

echo "run $RUN_ID: stages=$STAGES network=$NETWORK results=$RESULTS"
sample
docker rm -f "$K6_NAME" >/dev/null 2>&1 || true
docker run -d --name "$K6_NAME" --network "$NETWORK" \
  -v "$MOUNT:/scripts" \
  -e LT_STAGES="$STAGES" -e RUN_ID="$RUN_ID" -e BASE_URL="${BASE_URL:-http://nginx}" \
  -e LOADTEST_PASSWORD="${LOADTEST_PASSWORD:-}" -e SESSIONS="${SESSIONS:-200}" -e LOGIN_BATCH="${LOGIN_BATCH:-4}" \
  -e THINK_MIN="${THINK_MIN:-1}" -e THINK_MAX="${THINK_MAX:-3}" \
  "$K6_IMAGE" run --quiet /scripts/k6/mixed.js >/dev/null

sampler &
SAMPLER=$!
watch_memory &
WATCH=$!

status="$(docker wait "$K6_NAME" 2>/dev/null || echo 1)"
docker logs "$K6_NAME" >"$RESULTS/$RUN_ID-k6.log" 2>&1 || true
docker rm "$K6_NAME" >/dev/null 2>&1 || true
wait "$SAMPLER" "$WATCH" 2>/dev/null || true
sample
scrape_metrics
echo "k6 exit status $status (99 = a threshold failed); summary: $RESULTS/$RUN_ID-summary.json"
exit "$status"
