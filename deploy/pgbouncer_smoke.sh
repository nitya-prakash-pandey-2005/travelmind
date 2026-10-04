#!/usr/bin/env bash
# PgBouncer transaction-pooling smoke (called by smoke.sh, or on its own after `up`):
#   bash deploy/pgbouncer_smoke.sh [base_url]
# Signs up two agencies through nginx, creates one client in each, then reads the client list
# 50 times alternating between the agencies (plus a concurrent burst). Every read must succeed
# (no "prepared statement does not exist" from a reused server connection) and each agency must
# only ever see its own client (the transaction-local tenant never leaks between transactions that
# share a server connection). Finally it checks the reads really went through PgBouncer.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${1:-${SMOKE_BASE_URL:-http://localhost:8080}}"
PROJECT="${COMPOSE_PROJECT_NAME:-travelmind-prod}"
compose() { docker compose -f "$HERE/docker-compose.yml" -p "$PROJECT" "$@"; }
READS="${PGB_SMOKE_READS:-50}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
die() { echo "pgbouncer_smoke: $*" >&2; exit 1; }

run="$(date +%s)-$RANDOM"
password="smoke-pass-$RANDOM-$RANDOM"

# post <jar> <path> <json>: prints the status, body in $TMP/last.b
post() {
  curl -sS --max-time 20 -o "$TMP/last.b" -w '%{http_code}' -b "$TMP/$1" -c "$TMP/$1" \
    -H 'Content-Type: application/json' -H "Origin: $BASE" -X POST --data "$3" "$BASE$2" \
    2>"$TMP/last.err" || true
}

for side in a b; do
  code="$(post "$side.jar" /api/v1/auth/signup \
    "{\"agency_name\":\"Smoke Agency ${side^^} $run\",\"full_name\":\"Smoke Owner ${side^^}\",\"email\":\"smoke-$side-$run@example.com\",\"password\":\"$password\"}")"
  [[ "$code" == 201 ]] || die "signup $side -> $code $(cat "$TMP/last.b" "$TMP/last.err" 2>/dev/null)"
  name="Client ${side^^} $run"
  code="$(post "$side.jar" /api/v1/clients "{\"name\":\"$name\"}")"
  [[ "$code" == 201 ]] || die "create client $side -> $code $(cat "$TMP/last.b" 2>/dev/null)"
done
echo "pgbouncer_smoke: two agencies and their clients created (run $run)"

# check <side> <body file> <status>: own client present, the other agency's absent
check() {
  local side="$1" body="$2" code="$3" other
  [[ "$side" == a ]] && other=b || other=a
  [[ "$code" == 200 ]] || { echo "read $side -> $code $(cat "$body")"; return 1; }
  grep -q "\"Client ${side^^} $run\"" "$body" || { echo "read $side: own client missing"; return 1; }
  if grep -q "Client ${other^^} $run" "$body"; then
    echo "read $side: saw agency $other's client (tenant leak)"
    return 1
  fi
}

failures=0
for ((i = 0; i < READS; i++)); do
  side=$([[ $((i % 2)) -eq 0 ]] && echo a || echo b)
  code="$(curl -sS --max-time 20 -o "$TMP/r.b" -w '%{http_code}' -b "$TMP/$side.jar" \
    "$BASE/api/v1/clients?limit=200" 2>/dev/null || true)"
  check "$side" "$TMP/r.b" "$code" || failures=$((failures + 1))
done
echo "pgbouncer_smoke: $READS alternating reads, $failures bad"

# Concurrent burst: both agencies at once, so their transactions interleave on the pool.
for ((i = 0; i < READS; i++)); do
  side=$([[ $((i % 2)) -eq 0 ]] && echo a || echo b)
  (curl -sS --max-time 30 -o "$TMP/c$i.b" -w '%{http_code}' -b "$TMP/$side.jar" \
    "$BASE/api/v1/clients?limit=200" >"$TMP/c$i.code" 2>/dev/null || true) &
done
wait
burst_failures=0
for ((i = 0; i < READS; i++)); do
  side=$([[ $((i % 2)) -eq 0 ]] && echo a || echo b)
  check "$side" "$TMP/c$i.b" "$(cat "$TMP/c$i.code")" || burst_failures=$((burst_failures + 1))
done
echo "pgbouncer_smoke: $READS concurrent reads, $burst_failures bad"

# The app role's traffic really goes through PgBouncer in transaction mode.
pools="$(compose exec -T postgres sh -c \
  'PGPASSWORD="$OWNER_DB_PASSWORD" psql -h pgbouncer -p 5432 -U travelmind_owner -d pgbouncer -At -F" " -c "SHOW POOLS"' \
  2>&1 | tr -d '\r')"
app_pool="$(grep '^travelmind travelmind_app ' <<<"$pools")"
if [[ -z "$app_pool" || "$app_pool" != *transaction* ]]; then
  echo "pgbouncer_smoke: no transaction-mode travelmind_app pool in SHOW POOLS:"
  echo "$pools"
  failures=$((failures + 1))
else
  echo "pgbouncer_smoke: SHOW POOLS -> $app_pool"
fi

[[ $((failures + burst_failures)) -eq 0 ]] || die "$((failures + burst_failures)) failure(s)"
echo "pgbouncer_smoke: ok"
