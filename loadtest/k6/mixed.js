// TravelMind mixed-traffic load test (k6). See loadtest/run.sh and docs/perf/.
//
// Env:
//   BASE_URL           default http://nginx (k6 on the travelmind-prod_default network)
//   LT_STAGES          smoke | full | steps | custom "target:duration,..." (default full).
//                      Not K6_STAGES: k6 itself reads that variable as its own stage list.
//   LOADTEST_PASSWORD  the seeded users' password (default as in loadtest/seed.py)
//   USERS_FILE         default ../users.json (written by loadtest/seed.py)
//   SESSIONS           how many seeded users sign in during setup (default 200)
//   RUN_ID             names the summary file (default "run")
//   SUMMARY_DIR        where the summary JSON goes (default /scripts/results)
//   LOGIN_BATCH        sign-ins sent at once during setup (default 4)
//   THINK_MIN/THINK_MAX  seconds of think time between iterations (default 1 / 3)
//
// Each iteration is one user action, picked by weight: 30% public pages, 45% signed-in reads,
// 15% a sandbox flight search plus one reprice, 10% writes. Every request is tagged `kind`
// (public, read, search, reprice, write), `name` (the route template) and `level` (the VU level
// of the hold stage it ran in, or "ramp"), so results can be read per kind and per level.
// Sign-ins happen only in setup(): the VUs share a pool of SESSIONS cookies, so password hashing
// never dominates the run.

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Gauge } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://nginx';
const PASSWORD = __ENV.LOADTEST_PASSWORD || 'loadtest-pass-2026';
const SESSIONS = parseInt(__ENV.SESSIONS || '200', 10);
const THINK_MIN = parseFloat(__ENV.THINK_MIN || '1');
const THINK_MAX = parseFloat(__ENV.THINK_MAX || '3');
const RUN_ID = __ENV.RUN_ID || 'run';
const LOGIN_BATCH = parseInt(__ENV.LOGIN_BATCH || '4', 10);
const SUMMARY_DIR = __ENV.SUMMARY_DIR || '/scripts/results';
const COOKIE = 'tm_session';

const seeded = JSON.parse(open(__ENV.USERS_FILE || '../users.json'));
const EMAILS = new SharedArray('emails', () =>
  seeded.agencies.flatMap((a) => a.users).slice(0, SESSIONS),
);
const TOKENS = new SharedArray('tokens', () =>
  seeded.agencies.map((a) => a.quote_token).filter((t) => t),
);

// Stage shapes. `hold` marks a stage whose requests are tagged with its VU level.
const SHAPES = {
  smoke: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50, hold: true },
    { duration: '10s', target: 0 },
  ],
  // The plan's shape: 0→200 (2m), →500 (3m), →1000 (5m), hold 1000 (5m), down (1m).
  full: [
    { duration: '2m', target: 200 },
    { duration: '3m', target: 500 },
    { duration: '5m', target: 1000 },
    { duration: '5m', target: 1000, hold: true },
    { duration: '1m', target: 0 },
  ],
  // Same ramp with a hold at each level, so every level gets its own numbers.
  steps: [
    { duration: '1m', target: 200 },
    { duration: '3m', target: 200, hold: true },
    { duration: '1m', target: 500 },
    { duration: '3m', target: 500, hold: true },
    { duration: '2m', target: 1000 },
    { duration: '3m', target: 1000, hold: true },
    { duration: '1m', target: 0 },
  ],
};

function parseStages(spec) {
  if (SHAPES[spec]) return SHAPES[spec];
  // "200:1m,200:3m,0:30s": a stage that keeps the previous target is a hold.
  let previous = 0;
  return spec.split(',').map((part) => {
    const [target, duration] = part.split(':');
    const t = parseInt(target, 10);
    const stage = { duration, target: t, hold: t === previous && t > 0 };
    previous = t;
    return stage;
  });
}

const STAGES = parseStages(__ENV.LT_STAGES || 'full');
const LEVELS = [...new Set(STAGES.filter((s) => s.hold).map((s) => String(s.target)))];
const KINDS = ['public', 'read', 'search', 'reprice', 'write'];

function seconds(duration) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration);
  const unit = { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
  return parseFloat(m[1]) * unit;
}

// [startSeconds, endSeconds, level] for every hold stage.
const HOLD_WINDOWS = (() => {
  const windows = [];
  let at = 0;
  for (const s of STAGES) {
    const end = at + seconds(s.duration);
    if (s.hold) windows.push([at, end, String(s.target)]);
    at = end;
  }
  return windows;
})();

function thresholds() {
  const t = {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:public}': ['p(95)<300'],
    'http_req_duration{kind:search}': ['p(95)<2500'],
    http_req_failed: ['rate<0.01'],
    // Sign-in and limiter failures would mean the run measured the wrong thing.
    'http_reqs{status:401}': ['count<1'],
    'http_reqs{status:429}': ['count<1'],
  };
  // Declared so the summary carries every kind (and kind × level); always true.
  for (const kind of KINDS) {
    t[`http_req_duration{kind:${kind}}`] = t[`http_req_duration{kind:${kind}}`] || ['max>=0'];
    t[`http_req_failed{kind:${kind}}`] = ['rate>=0'];
    t[`http_reqs{kind:${kind}}`] = ['count>=0'];
    for (const level of LEVELS) {
      t[`http_req_duration{kind:${kind},level:${level}}`] = ['max>=0'];
      t[`http_req_failed{kind:${kind},level:${level}}`] = ['rate>=0'];
      t[`http_reqs{kind:${kind},level:${level}}`] = ['count>=0'];
    }
  }
  for (const level of LEVELS) {
    t[`http_reqs{level:${level}}`] = ['count>=0'];
    t[`http_req_failed{level:${level}}`] = ['rate>=0'];
  }
  return t;
}

export const options = {
  scenarios: {
    mixed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: STAGES.map(({ duration, target }) => ({ duration, target })),
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: true,
  setupTimeout: '5m',
  noConnectionReuse: false,
  userAgent: 'travelmind-loadtest/1.0',
};

// ---------------------------------------------------------------------------------------------

export function setup() {
  const sessions = [];
  // Small batches: each sign-in is an argon2 verification (memory-hard), and a burst of them is
  // a memory spike on the API, not the traffic being measured.
  const batchSize = LOGIN_BATCH;
  for (let i = 0; i < EMAILS.length; i += batchSize) {
    const batch = EMAILS.slice(i, i + batchSize).map((email) => ({
      method: 'POST',
      url: `${BASE}/api/v1/auth/login`,
      body: JSON.stringify({ email, password: PASSWORD }),
      params: {
        headers: { 'Content-Type': 'application/json' },
        tags: { kind: 'setup', name: 'POST /api/v1/auth/login' },
      },
    }));
    for (const res of http.batch(batch)) {
      const cookie = res.cookies[COOKIE] && res.cookies[COOKIE][0];
      if (res.status !== 200 || !cookie) {
        throw new Error(`login failed: HTTP ${res.status}`);
      }
      sessions.push(cookie.value);
    }
  }
  if (sessions.length === 0) throw new Error('no sessions: run loadtest/seed.py first');
  return { sessions };
}

// Seconds since the scenario started, as last seen by any VU. Its max tells handleSummary how
// much of a hold stage really ran when a test is stopped early.
const ELAPSED = new Gauge('scenario_elapsed_s');

function level() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  ELAPSED.add(elapsed);
  for (const [start, end, lvl] of HOLD_WINDOWS) {
    if (elapsed >= start && elapsed < end) return lvl;
  }
  return 'ramp';
}

function params(kind, name, cookie, extra) {
  const p = { tags: { kind, name, level: level() }, headers: {} };
  if (cookie) p.headers.Cookie = `${COOKIE}=${cookie}`;
  if (extra && extra.json) p.headers['Content-Type'] = 'application/json';
  if (extra && extra.body) p.responseType = 'text';
  return p;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ok(res, expected) {
  return check(res, { [`status ${expected}`]: (r) => r.status === expected });
}

// ---- public (30%) ---------------------------------------------------------------------------

function publicTraffic() {
  const r = Math.random();
  if (r < 1 / 3) {
    ok(http.get(`${BASE}/`, params('public', 'GET /')), 200);
  } else if (r < 2 / 3) {
    ok(http.get(`${BASE}/api/v1/platform/facts`, params('public', 'GET /api/v1/platform/facts')), 200);
  } else {
    const token = pick(TOKENS);
    ok(
      http.get(
        `${BASE}/api/v1/public/quotes/${token}`,
        params('public', 'GET /api/v1/public/quotes/{token}'),
      ),
      200,
    );
  }
}

// ---- signed-in reads (45%) ------------------------------------------------------------------

const READS = [
  '/api/v1/dashboard/summary',
  '/api/v1/dashboard/pipeline',
  '/api/v1/dashboard/activity',
  '/api/v1/quotes',
  '/api/v1/enquiries',
  '/api/v1/clients',
  'airports',
];
const AIRPORT_QUERIES = ['del', 'mumbai', 'bom', 'dubai', 'lon', 'singapore', 'blr', 'goa', 'bangkok', 'paris'];

function readTraffic(cookie) {
  const path = pick(READS);
  if (path === 'airports') {
    const q = pick(AIRPORT_QUERIES);
    ok(
      http.get(`${BASE}/api/v1/reference/airports?q=${q}`, params('read', 'GET /api/v1/reference/airports', cookie)),
      200,
    );
    return;
  }
  ok(http.get(`${BASE}${path}`, params('read', `GET ${path}`, cookie)), 200);
}

// ---- sandbox flight search + one reprice (15%) ----------------------------------------------

const ROUTES = [
  ['DEL', 'BOM'], ['BOM', 'DXB'], ['BLR', 'SIN'], ['DEL', 'LHR'], ['BOM', 'JFK'], ['MAA', 'KUL'],
  ['DEL', 'DXB'], ['HYD', 'BLR'], ['CCU', 'BKK'], ['DEL', 'GOI'], ['BOM', 'SIN'], ['BLR', 'DXB'],
  ['DEL', 'CDG'], ['BOM', 'LHR'], ['COK', 'DXB'], ['AMD', 'BOM'],
];

function isoDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function searchTraffic(cookie) {
  const [origin, destination] = pick(ROUTES);
  const depart = 14 + Math.floor(Math.random() * 120);
  const body = {
    origin,
    destination,
    departure_date: isoDate(depart),
    adults: 1 + Math.floor(Math.random() * 2),
  };
  if (Math.random() < 0.5) body.return_date = isoDate(depart + 3 + Math.floor(Math.random() * 10));
  const res = http.post(
    `${BASE}/api/v1/flights/search`,
    JSON.stringify(body),
    params('search', 'POST /api/v1/flights/search', cookie, { json: true, body: true }),
  );
  if (!ok(res, 200)) return;
  let offerId = null;
  try {
    const offers = res.json('offers');
    if (offers && offers.length) offerId = offers[0].id;
  } catch (e) {
    offerId = null;
  }
  if (!offerId) return;
  sleep(0.5 + Math.random());
  ok(
    http.post(
      `${BASE}/api/v1/flights/offers/${encodeURIComponent(offerId)}/price`,
      null,
      params('reprice', 'POST /api/v1/flights/offers/{offer_id}/price', cookie),
    ),
    200,
  );
}

// ---- writes (10%) ---------------------------------------------------------------------------

let clientIds = null; // this VU's agency's clients, fetched on its first client update

function writeTraffic(cookie) {
  if (Math.random() < 0.5) {
    const [origin, destination] = pick(ROUTES);
    const depart = 20 + Math.floor(Math.random() * 90);
    const body = {
      origin,
      destination,
      depart_date: isoDate(depart),
      return_date: isoDate(depart + 5),
      adults: 2,
      notes: 'Load test enquiry',
    };
    ok(
      http.post(
        `${BASE}/api/v1/enquiries`,
        JSON.stringify(body),
        params('write', 'POST /api/v1/enquiries', cookie, { json: true }),
      ),
      201,
    );
    return;
  }
  if (clientIds === null) {
    const res = http.get(
      `${BASE}/api/v1/clients?limit=20`,
      params('read', 'GET /api/v1/clients', cookie, { body: true }),
    );
    clientIds = res.status === 200 ? (res.json('items') || []).map((c) => c.id) : [];
  }
  if (clientIds.length === 0) return;
  const id = pick(clientIds);
  ok(
    http.patch(
      `${BASE}/api/v1/clients/${id}`,
      JSON.stringify({ notes: `Load test note ${Date.now()}` }),
      params('write', 'PATCH /api/v1/clients/{client_id}', cookie, { json: true }),
    ),
    200,
  );
}

// ---------------------------------------------------------------------------------------------

export default function (data) {
  const cookie = data.sessions[(exec.vu.idInTest - 1) % data.sessions.length];
  const r = Math.random();
  if (r < 0.3) publicTraffic();
  else if (r < 0.75) readTraffic(cookie);
  else if (r < 0.9) searchTraffic(cookie);
  else writeTraffic(cookie);
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

// ---- summary --------------------------------------------------------------------------------

function trend(data, name) {
  const m = data.metrics[name];
  return m ? m.values : null;
}

function row(data, selector) {
  const d = trend(data, `http_req_duration${selector}`);
  const f = trend(data, `http_req_failed${selector}`);
  const n = trend(data, `http_reqs${selector}`);
  if (!d || !n || !n.count) return null;
  return {
    requests: n.count,
    rps: Math.round(n.rate * 10) / 10,
    p50_ms: Math.round(d.med),
    p95_ms: Math.round(d['p(95)']),
    p99_ms: Math.round(d['p(99)']),
    max_ms: Math.round(d.max),
    error_rate: f ? Math.round(f.rate * 100000) / 100000 : null,
  };
}

export function handleSummary(data) {
  const kinds = {};
  for (const kind of KINDS) kinds[kind] = row(data, `{kind:${kind}}`);
  const levels = {};
  for (const lvl of LEVELS) {
    const [start, end] = HOLD_WINDOWS.find((w) => w[2] === lvl);
    // A stopped test (Ctrl-C, the memory guard in run.sh) cuts the hold short: rates use the part
    // that ran.
    const seen = trend(data, 'scenario_elapsed_s');
    const span = Math.max(0, Math.min(end, seen ? seen.max : end) - start) || 1;
    const total = trend(data, `http_reqs{level:${lvl}}`);
    const failed = trend(data, `http_req_failed{level:${lvl}}`);
    levels[lvl] = {
      hold_seconds_planned: end - start,
      hold_seconds: Math.round(span),
      requests: total ? total.count : 0,
      rps: total ? Math.round((total.count / span) * 10) / 10 : 0,
      error_rate: failed ? Math.round(failed.rate * 100000) / 100000 : null,
      kinds: {},
    };
    for (const kind of KINDS) {
      const r = row(data, `{kind:${kind},level:${lvl}}`);
      if (r) r.rps = Math.round((r.requests / span) * 10) / 10; // per second of the hold
      levels[lvl].kinds[kind] = r;
    }
  }
  const thresholdResults = {};
  for (const [name, m] of Object.entries(data.metrics)) {
    if (m.thresholds) {
      for (const [expr, res] of Object.entries(m.thresholds)) {
        if (!/>=0$/.test(expr)) thresholdResults[`${name} ${expr}`] = res.ok;
      }
    }
  }
  const all = trend(data, 'http_reqs');
  const summary = {
    run_id: RUN_ID,
    stages: STAGES,
    max_vus: trend(data, 'vus_max') ? trend(data, 'vus_max').max : null,
    duration_s: Math.round(data.state.testRunDurationMs / 1000),
    total: {
      requests: all ? all.count : 0,
      rps: all ? Math.round(all.rate * 10) / 10 : 0,
      error_rate: trend(data, 'http_req_failed') ? trend(data, 'http_req_failed').rate : null,
      iterations: trend(data, 'iterations') ? trend(data, 'iterations').count : 0,
    },
    checks: trend(data, 'checks'),
    kinds,
    levels,
    thresholds: thresholdResults,
  };
  const text = JSON.stringify(summary, null, 2);
  return {
    stdout: `\n${text}\n`,
    [`${SUMMARY_DIR}/${RUN_ID}-summary.json`]: text,
  };
}
