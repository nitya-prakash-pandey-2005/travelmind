#!/usr/bin/env bash
# Smoke checks for the production-like stack. Run after `up`:
#   bash deploy/smoke.sh                 # against http://localhost:8080
#   bash deploy/smoke.sh http://host:port
# Needs curl and docker (it reads Redis keys and nginx logs inside the compose project).
# Exits non-zero if any check fails.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${1:-${SMOKE_BASE_URL:-http://localhost:8080}}"
PROJECT="${COMPOSE_PROJECT_NAME:-travelmind-prod}"
compose() { docker compose -f "$HERE/docker-compose.yml" -p "$PROJECT" "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAILS=$((FAILS + 1)); }

# fetch <name> <path> [curl args...]: headers -> $TMP/<name>.h, body -> $TMP/<name>.b, prints status
fetch() {
  local name="$1" path="$2"
  shift 2
  curl -sS --max-time 15 -o "$TMP/$name.b" -D "$TMP/$name.h" -w '%{http_code}' "$@" "$BASE$path" \
    2>"$TMP/$name.err" || true
}
header() { grep -i "^$2:" "$TMP/$1.h" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# 1. The SPA shell.
code="$(fetch root /)"
if [[ "$code" == 200 ]] && grep -q '<div id="root">' "$TMP/root.b"; then
  pass "spa_root (/ -> 200 with <div id=\"root\">)"
else
  fail "spa_root" "status $code $(cat "$TMP/root.err" 2>/dev/null)"
fi
if [[ "$(header root x-content-type-options)" == nosniff && "$(header root x-frame-options)" == DENY \
  && "$(header root cache-control)" == no-cache \
  && "$(header root referrer-policy)" == strict-origin-when-cross-origin ]]; then
  pass "security_headers (nosniff, DENY, no-cache index, strict-origin-when-cross-origin)"
else
  fail "security_headers" "$(tr -d '\r' <"$TMP/root.h" | tr '\n' '|')"
fi

# 2. A hashed asset: long-lived cache and gzip.
asset="$(grep -o '/assets/[^"]*\.js' "$TMP/root.b" | head -1)"
if [[ -n "$asset" ]]; then
  code="$(fetch asset "$asset" -H 'Accept-Encoding: gzip')"
  if [[ "$code" == 200 && "$(header asset cache-control)" == *immutable* \
    && "$(header asset content-encoding)" == gzip ]]; then
    pass "static_assets ($asset immutable, gzip)"
  else
    fail "static_assets" "status $code cache='$(header asset cache-control)' enc='$(header asset content-encoding)'"
  fi
else
  fail "static_assets" "no /assets/*.js referenced by /"
fi

# 3. Readiness and liveness through nginx.
code="$(fetch ready /ready)"
[[ "$code" == 200 ]] && pass "ready (/ready -> 200 $(cat "$TMP/ready.b"))" || fail "ready" "status $code $(cat "$TMP/ready.b" 2>/dev/null)"
code="$(fetch health /health)"
[[ "$code" == 200 ]] && pass "health (/health -> 200)" || fail "health" "status $code"

# 4. Metrics are never exposed through nginx.
code="$(fetch metrics /metrics)"
[[ "$code" == 404 ]] && pass "metrics_hidden (/metrics -> 404)" || fail "metrics_hidden" "status $code"

# 5. Client quote links: SPA page, not indexed, no referrer.
code="$(fetch q /q/smoke-not-a-real-token)"
if [[ "$code" == 200 ]] && grep -q '<div id="root">' "$TMP/q.b" \
  && [[ "$(header q x-robots-tag)" == "noindex, nofollow" && "$(header q referrer-policy)" == no-referrer ]] \
  && [[ "$(grep -ci '^referrer-policy:' "$TMP/q.h")" == 1 ]]; then
  pass "quote_link_headers (/q/ -> 200, X-Robots-Tag noindex, Referrer-Policy no-referrer)"
else
  fail "quote_link_headers" "status $code $(tr -d '\r' <"$TMP/q.h" | tr '\n' '|')"
fi

# 6. nginx_forwards_real_ip: a spoofed X-Forwarded-For must not reach the per-IP limiter keys;
# the key must carry the address nginx saw (its access log), not nginx's own address.
email="smoke-xff-$(date +%s)-$RANDOM@example.com"
code="$(fetch xff /api/v1/auth/login -X POST -H 'Content-Type: application/json' \
  -H "Origin: $BASE" -H 'X-Forwarded-For: 1.2.3.4' \
  --data "{\"email\":\"$email\",\"password\":\"not-the-password\"}")"
keys="$(compose exec -T redis redis-cli --scan --pattern 'rl:login*' 2>/dev/null | tr -d '\r')"
key="$(grep -F ":$email" <<<"$keys" | head -1)"
seen_ip="${key#rl:login:}"
seen_ip="${seen_ip%:"$email"}"
nginx_ip="$(compose logs --no-log-prefix --since 5m nginx 2>/dev/null | grep 'POST /api/v1/auth/login' \
  | tail -1 | awk '{print $1}')"
nginx_own="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \
  "$(compose ps -q nginx 2>/dev/null)" 2>/dev/null)"
if [[ "$code" != 401 ]]; then
  fail "nginx_forwards_real_ip" "login probe status $code (want 401)"
elif [[ -z "$key" ]]; then
  fail "nginx_forwards_real_ip" "no rl:login key for the probe email"
elif grep -q '1\.2\.3\.4' <<<"$keys"; then
  fail "nginx_forwards_real_ip" "spoofed 1.2.3.4 reached a limiter key"
elif [[ -z "$nginx_ip" || "$seen_ip" != "$nginx_ip" ]]; then
  fail "nginx_forwards_real_ip" "limiter saw '$seen_ip', nginx saw '$nginx_ip'"
elif [[ " $nginx_own " == *" $seen_ip "* ]]; then
  fail "nginx_forwards_real_ip" "limiter keyed on nginx's own address $seen_ip"
else
  pass "nginx_forwards_real_ip (limiter key ip $seen_ip = nginx \$remote_addr; spoofed 1.2.3.4 ignored; nginx is $nginx_own)"
fi

# 7. PgBouncer transaction pooling keeps tenants apart.
if bash "$HERE/pgbouncer_smoke.sh" "$BASE"; then
  pass "pgbouncer_tenant_isolation"
else
  fail "pgbouncer_tenant_isolation" "see output above"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "smoke: all checks passed"
else
  echo "smoke: $FAILS check(s) failed"
  exit 1
fi
