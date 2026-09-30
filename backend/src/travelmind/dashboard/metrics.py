"""Command Center figures, computed in SQL from the agency's own workspace data.

Every function takes `now`, so tests can pin time. A range of N days is the agency's last N
local calendar days, today included (`AT TIME ZONE :tz`); the previous period is the N days
before it. Daily series come from `generate_series`, so days without rows are 0. Money is summed
only for quotes in the agency currency, from the version the client was sent (`sent_version`).

All SQL is `text()` with bound parameters; the fragments composed below are fixed strings.
RLS already scopes every table to the session's agency: the `agency_id = :agency` filters are a
second guard and let the planner use the per-agency indexes. Users are read only through the
identity service.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.dashboard.schemas import (
    ActivityItem,
    ActivityOut,
    ActorRef,
    ClientHit,
    Departure,
    DeparturesOut,
    EnquiryHit,
    HealthRange,
    Kpi,
    KpiKey,
    KpiUnit,
    MarketPulseOut,
    MarketRoute,
    MemberRef,
    NotificationItem,
    NotificationsOut,
    Number,
    OnboardingItem,
    OnboardingOut,
    PipelineOut,
    PipelineStage,
    Provenance,
    QuoteHit,
    Range,
    SearchOut,
    SeriesPoint,
    SummaryOut,
    SupplierHealth,
    SupplierHealthOut,
    TeamMemberStats,
    TeamOut,
)
from travelmind.identity import service as identity_service
from travelmind.identity.service import AgencySettings
from travelmind.offers.registry import supplier_statuses
from travelmind.workspace._common import escape_like
from travelmind.workspace.counters import format_number

__all__ = [
    "ACTIVITY_MAX",
    "RANGE_DAYS",
    "Window",
    "activity",
    "departures",
    "global_search",
    "market_pulse",
    "notifications",
    "onboarding",
    "pipeline",
    "summary",
    "supplier_health",
    "team",
    "window",
]

RANGE_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}
HEALTH_WINDOWS: dict[str, timedelta] = {"24h": timedelta(hours=24), "7d": timedelta(days=7)}
ACTIVITY_MAX = 100
NOTIFICATIONS_LIMIT = 20
SEARCH_LIMIT = 5
MARKET_ROUTES = 6
MARKET_WEEKS = 8
MARKET_MIN_SAMPLES = 2
DEPARTURES_LIMIT = 10
EnquiryStatus = Literal["new", "quoting", "quoted", "won", "lost"]
PIPELINE_STATUSES: tuple[EnquiryStatus, ...] = ("new", "quoting", "quoted", "won", "lost")
LIVE_SUPPLIER_CODES = frozenset({"duffel", "liteapi"})


# --- time and number helpers ------------------------------------------------------------------


@dataclass(frozen=True)
class Window:
    """The agency's last `days` local days (today included) and the `days` before them."""

    first: date
    today: date
    start: datetime  # local midnight at the start of `first`
    end: datetime  # local midnight after `today`
    prev_start: datetime


def window(now: datetime, timezone: str, days: int) -> Window:
    zone = ZoneInfo(timezone)
    today = now.astimezone(zone).date()
    first = today - timedelta(days=days - 1)

    def midnight(day: date) -> datetime:
        return datetime.combine(day, time(), tzinfo=zone)

    return Window(
        first=first,
        today=today,
        start=midnight(first),
        end=midnight(today + timedelta(days=1)),
        prev_start=midnight(first - timedelta(days=days)),
    )


def _decimal(value: Any) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _half_up(value: Any) -> int | None:
    """A whole number rounded half-up (medians and averages of minor units, ms)."""
    if value is None:
        return None
    return int(_decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _one_dp(value: Any) -> float | None:
    if value is None:
        return None
    return float(_decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _number(value: Any) -> Number | None:
    """An int when whole, else rounded to 1 dp (so JSON shows 120, not 120.0)."""
    if value is None:
        return None
    rounded = _decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return int(rounded) if rounded == rounded.to_integral_value() else float(rounded)


def _percent(part: int, whole: int) -> float | None:
    if not whole:
        return None
    return _one_dp(Decimal(part) * 100 / Decimal(whole))


def _series_sql(daily: str) -> TextClause:
    """Every day of the window with `daily`'s value for it (a `day`, `value` query), else 0."""
    return text(
        "SELECT g.day::date AS day, COALESCE(agg.value, 0) AS value "
        "FROM generate_series(CAST(:first AS date)::timestamp, CAST(:today AS date)::timestamp, "
        "interval '1 day') AS g(day) "
        f"LEFT JOIN ({daily}) AS agg ON agg.day = g.day::date "
        "ORDER BY 1"
    )


# --- summary ----------------------------------------------------------------------------------

_OPEN = text(
    """
    SELECT count(*) FILTER (WHERE status IN ('new', 'quoting', 'quoted')) AS value,
           count(*) FILTER (
               WHERE created_at < :start AND (closed_at IS NULL OR closed_at >= :start)
           ) AS previous
    FROM enquiries WHERE agency_id = :agency
    """
)
_OPEN_DAILY = _series_sql(
    """
    SELECT (created_at AT TIME ZONE :tz)::date AS day, count(*) AS value
    FROM enquiries
    WHERE agency_id = :agency AND created_at >= :start AND created_at < :end
    GROUP BY 1
    """
)

_SENT = text(
    """
    SELECT count(*) FILTER (WHERE sent_at >= :start) AS value,
           count(*) FILTER (WHERE sent_at < :start) AS previous
    FROM quotes
    WHERE agency_id = :agency AND sent_at >= :prev_start AND sent_at < :end
    """
)
_SENT_DAILY = _series_sql(
    """
    SELECT (sent_at AT TIME ZONE :tz)::date AS day, count(*) AS value
    FROM quotes
    WHERE agency_id = :agency AND sent_at >= :start AND sent_at < :end
    GROUP BY 1
    """
)

_WINS = text(
    """
    SELECT count(*) FILTER (WHERE status = 'won' AND closed_at >= :start) AS won,
           count(*) FILTER (WHERE status = 'lost' AND closed_at >= :start) AS lost,
           count(*) FILTER (WHERE status = 'won' AND closed_at < :start) AS prev_won,
           count(*) FILTER (WHERE status = 'lost' AND closed_at < :start) AS prev_lost
    FROM enquiries
    WHERE agency_id = :agency AND status IN ('won', 'lost')
      AND closed_at >= :prev_start AND closed_at < :end
    """
)
_WINS_DAILY = _series_sql(
    """
    SELECT (closed_at AT TIME ZONE :tz)::date AS day, count(*) AS value
    FROM enquiries
    WHERE agency_id = :agency AND status = 'won' AND closed_at >= :start AND closed_at < :end
    GROUP BY 1
    """
)

# The sent version of each quote: what the client has.
_SENT_VERSION = """
    FROM quotes q
    JOIN quote_versions v ON v.quote_id = q.id AND v.version = q.sent_version
"""
_MIN_SELL = "(v.totals ->> 'min_sell_minor')::bigint"
_PIPELINE = text(
    f"""
    SELECT COALESCE(sum({_MIN_SELL}), 0) AS value
    {_SENT_VERSION}
    WHERE q.agency_id = :agency AND q.status IN ('sent', 'viewed') AND q.currency = :currency
    """
)
_PIPELINE_DAILY = _series_sql(
    f"""
    SELECT (q.sent_at AT TIME ZONE :tz)::date AS day, sum({_MIN_SELL}) AS value
    {_SENT_VERSION}
    WHERE q.agency_id = :agency AND q.currency = :currency
      AND q.sent_at >= :start AND q.sent_at < :end
    GROUP BY 1
    """
)

# Each enquiry's first sent quote and the minutes it took.
_FIRST_RESPONSES = """
    WITH firsts AS (
        SELECT min(q.sent_at) AS sent_at,
               extract(epoch FROM min(q.sent_at) - e.created_at) / 60 AS minutes
        FROM enquiries e JOIN quotes q ON q.enquiry_id = e.id
        WHERE e.agency_id = :agency AND q.sent_at IS NOT NULL
        GROUP BY e.id, e.created_at
    )
"""
_MEDIAN_MINUTES = "percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)"
_RESPONSE = text(
    f"""
    {_FIRST_RESPONSES}
    SELECT {_MEDIAN_MINUTES} FILTER (WHERE sent_at >= :start) AS value,
           {_MEDIAN_MINUTES} FILTER (WHERE sent_at < :start) AS previous
    FROM firsts WHERE sent_at >= :prev_start AND sent_at < :end
    """
)
_RESPONSE_DAILY = _series_sql(
    f"""
    {_FIRST_RESPONSES}
    SELECT (sent_at AT TIME ZONE :tz)::date AS day, {_MEDIAN_MINUTES} AS value
    FROM firsts WHERE sent_at >= :start AND sent_at < :end
    GROUP BY 1
    """
)

# CO2 of every option of each sent version, for the enquiry's travellers; options without CO2
# are skipped, so a period where no option carried CO2 is NULL (unknown), not 0.
_CO2_ROWS = f"""
    SELECT q.sent_at,
           (o.item -> 'offer' ->> 'co2_kg_per_passenger')::numeric
               * (e.adults + cardinality(e.children_ages)) AS kg
    {_SENT_VERSION}
    JOIN enquiries e ON e.id = q.enquiry_id
    CROSS JOIN LATERAL jsonb_array_elements(v.options) AS o(item)
    WHERE q.agency_id = :agency AND q.sent_at >= :prev_start AND q.sent_at < :end
      AND jsonb_typeof(o.item -> 'offer' -> 'co2_kg_per_passenger') = 'number'
"""
_CO2 = text(
    f"""
    SELECT sum(kg) FILTER (WHERE sent_at >= :start) AS value,
           sum(kg) FILTER (WHERE sent_at < :start) AS previous
    FROM ({_CO2_ROWS}) AS c
    """
)
_CO2_DAILY = _series_sql(
    f"""
    SELECT (sent_at AT TIME ZONE :tz)::date AS day, sum(kg) AS value
    FROM ({_CO2_ROWS}) AS c
    WHERE sent_at >= :start
    GROUP BY 1
    """
)

# Every search writes a `search.*` event, including hotel searches that never reached a supplier
# (and so have no search_source_results row).
_SEARCH_KINDS = "kind IN ('search.flights', 'search.hotels')"
_SEARCHES = text(
    f"""
    SELECT count(*) FILTER (WHERE occurred_at >= :start) AS value,
           count(*) FILTER (WHERE occurred_at < :start) AS previous
    FROM activity_events
    WHERE agency_id = :agency AND {_SEARCH_KINDS}
      AND occurred_at >= :prev_start AND occurred_at < :end
    """
)
_SEARCHES_DAILY = _series_sql(
    f"""
    SELECT (occurred_at AT TIME ZONE :tz)::date AS day, count(*) AS value
    FROM activity_events
    WHERE agency_id = :agency AND {_SEARCH_KINDS} AND occurred_at >= :start AND occurred_at < :end
    GROUP BY 1
    """
)

_LABELS: dict[KpiKey, tuple[str, KpiUnit]] = {
    "open_enquiries": ("Open enquiries", "count"),
    "quotes_sent": ("Quotes sent", "count"),
    "win_rate": ("Win rate", "percent"),
    "pipeline_value": ("Pipeline value", "money"),
    "response_time": ("Response time", "minutes"),
    "co2_quoted": ("CO₂ quoted", "kg"),
    "searches": ("Searches", "count"),
}


def _range_params(agency: AgencySettings, span: Window) -> dict[str, Any]:
    return {
        "agency": agency.id,
        "tz": agency.timezone,
        "currency": agency.currency,
        "first": span.first,
        "today": span.today,
        "start": span.start,
        "end": span.end,
        "prev_start": span.prev_start,
    }


async def _series(db: AsyncSession, query: TextClause, params: dict[str, Any]) -> list[SeriesPoint]:
    rows = await db.execute(query, params)
    return [SeriesPoint(date=row.day, value=_number(row.value) or 0) for row in rows]


def _kpi(
    key: KpiKey, value: Number | None, previous: Number | None, series: list[SeriesPoint]
) -> Kpi:
    label, unit = _LABELS[key]
    return Kpi(key=key, label=label, value=value, unit=unit, previous=previous, series=series)


async def summary(
    db: AsyncSession, agency: AgencySettings, range_: Range, *, now: datetime
) -> SummaryOut:
    params = _range_params(agency, window(now, agency.timezone, RANGE_DAYS[range_]))

    async def one(query: TextClause) -> Any:
        return (await db.execute(query, params)).one()

    opened = await one(_OPEN)
    sent = await one(_SENT)
    wins = await one(_WINS)
    pipeline_value = await one(_PIPELINE)
    response = await one(_RESPONSE)
    co2 = await one(_CO2)
    searches = await one(_SEARCHES)
    kpis = [
        _kpi(
            "open_enquiries",
            opened.value,
            opened.previous,
            await _series(db, _OPEN_DAILY, params),
        ),
        _kpi("quotes_sent", sent.value, sent.previous, await _series(db, _SENT_DAILY, params)),
        _kpi(
            "win_rate",
            _percent(wins.won, wins.won + wins.lost),
            _percent(wins.prev_won, wins.prev_won + wins.prev_lost),
            await _series(db, _WINS_DAILY, params),
        ),
        _kpi(
            "pipeline_value",
            int(pipeline_value.value),
            None,
            await _series(db, _PIPELINE_DAILY, params),
        ),
        _kpi(
            "response_time",
            _number(response.value),
            _number(response.previous),
            await _series(db, _RESPONSE_DAILY, params),
        ),
        _kpi(
            "co2_quoted",
            _number(co2.value),
            _number(co2.previous),
            await _series(db, _CO2_DAILY, params),
        ),
        _kpi(
            "searches",
            searches.value,
            searches.previous,
            await _series(db, _SEARCHES_DAILY, params),
        ),
    ]
    return SummaryOut(range=range_, currency=agency.currency, kpis=kpis)


# --- pipeline ---------------------------------------------------------------------------------

# Each enquiry's most recent quote, valued at the version the client has (else its latest draft).
_PIPELINE_STAGES = text(
    f"""
    WITH latest AS (
        SELECT DISTINCT ON (enquiry_id)
               id, enquiry_id, currency, COALESCE(sent_version, current_version) AS version
        FROM quotes
        WHERE agency_id = :agency
        ORDER BY enquiry_id, created_at DESC, number DESC
    )
    SELECT e.status, count(*) AS count,
           COALESCE(sum({_MIN_SELL}) FILTER (WHERE l.currency = :currency), 0) AS value
    FROM enquiries e
    LEFT JOIN latest l ON l.enquiry_id = e.id
    LEFT JOIN quote_versions v ON v.quote_id = l.id AND v.version = l.version
    WHERE e.agency_id = :agency
    GROUP BY e.status
    """
)


async def pipeline(db: AsyncSession, agency: AgencySettings) -> PipelineOut:
    rows = await db.execute(_PIPELINE_STAGES, {"agency": agency.id, "currency": agency.currency})
    found = {row.status: (row.count, int(row.value)) for row in rows}
    return PipelineOut(
        currency=agency.currency,
        stages=[
            PipelineStage(
                status=status,
                count=found.get(status, (0, 0))[0],
                value_minor=found.get(status, (0, 0))[1],
            )
            for status in PIPELINE_STATUSES
        ],
    )


# --- activity ---------------------------------------------------------------------------------

_ACTIVITY_SQL = """
    SELECT id, kind, summary, occurred_at, actor_user_id, entity_type, entity_id
    FROM activity_events
    WHERE agency_id = :agency {condition}
    ORDER BY occurred_at DESC, id DESC
    LIMIT :limit
"""
_ACTIVITY = text(_ACTIVITY_SQL.format(condition=""))
_ACTIVITY_BEFORE = text(_ACTIVITY_SQL.format(condition="AND occurred_at < :before"))
# Keyset paging: several events can share one instant, so the last item's id breaks the tie.
_ACTIVITY_BEFORE_ITEM = text(
    _ACTIVITY_SQL.format(condition="AND (occurred_at, id) < (:before, :before_id)")
)


async def activity(
    db: AsyncSession,
    agency: AgencySettings,
    *,
    limit: int,
    before: datetime | None,
    before_id: UUID | None = None,
) -> ActivityOut:
    """Newest first. `before` pages back from an item's `occurred_at` (exclusive); adding that
    item's id as `before_id` also keeps later items that happened at the same instant."""
    params: dict[str, Any] = {"agency": agency.id, "limit": limit}
    query = _ACTIVITY
    if before is not None:
        params["before"] = before
        query = _ACTIVITY_BEFORE
        if before_id is not None:
            params["before_id"] = before_id
            query = _ACTIVITY_BEFORE_ITEM
    rows = (await db.execute(query, params)).all()
    names = await identity_service.team_names(
        db, agency.id, (row.actor_user_id for row in rows if row.actor_user_id is not None)
    )
    return ActivityOut(
        items=[
            ActivityItem(
                id=row.id,
                kind=row.kind,
                summary=row.summary,
                occurred_at=row.occurred_at,
                actor=ActorRef(id=row.actor_user_id, full_name=names[row.actor_user_id])
                if row.actor_user_id in names
                else None,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
            )
            for row in rows
        ]
    )


# --- market pulse -----------------------------------------------------------------------------

# Adults-only searches billed in the agency currency, one traveller's cheapest fare each, with
# the week they fall in (0 = the last 7 local days).
_PULSE_SEARCHES = """
    searches AS (
        SELECT id, origin, destination,
               round(cheapest_minor::numeric / adults) AS fare,
               (CAST(:today AS date) - (created_at AT TIME ZONE :tz)::date) / 7 AS week
        FROM flight_searches
        WHERE agency_id = :agency AND children = 0 AND adults > 0
          AND display_currency = :currency AND cheapest_minor IS NOT NULL
          AND created_at >= :since AND created_at < :end
    )
"""
_MEDIAN_FARE = "percentile_cont(0.5) WITHIN GROUP (ORDER BY fare)"
# Weeks 0-4 compared, with whether sandbox / other suppliers answered them: each search's
# sources are aggregated once (ix_ssr_search), not probed per row.
_MARKET_ROUTES = text(
    f"""
    WITH {_PULSE_SEARCHES},
    compared AS (SELECT * FROM searches WHERE week <= 4),
    sources AS (
        SELECT search_id,
               bool_or(supplier = 'sandbox') AS has_sandbox,
               bool_or(supplier <> 'sandbox') AS has_live
        FROM search_source_results
        WHERE agency_id = :agency AND status = 'ok'
          AND search_id IN (SELECT id FROM compared)
        GROUP BY search_id
    )
    SELECT c.origin, c.destination,
           {_MEDIAN_FARE} FILTER (WHERE c.week = 0) AS current,
           {_MEDIAN_FARE} FILTER (WHERE c.week BETWEEN 1 AND 4) AS previous,
           count(*) AS samples,
           COALESCE(bool_or(s.has_sandbox), false) AS sandbox,
           COALESCE(bool_or(s.has_live), false) AS live
    FROM compared c
    LEFT JOIN sources s ON s.search_id = c.id
    GROUP BY c.origin, c.destination
    HAVING count(*) FILTER (WHERE c.week = 0) >= :min_samples
       AND count(*) FILTER (WHERE c.week BETWEEN 1 AND 4) >= :min_samples
    """
)
# Weekly medians for the chosen routes only (`origins[i]` → `destinations[i]`).
_MARKET_WEEKS = text(
    f"""
    WITH {_PULSE_SEARCHES}
    SELECT origin, destination, week, {_MEDIAN_FARE} AS median
    FROM searches
    WHERE (origin, destination) IN (
        SELECT * FROM unnest(CAST(:origins AS text[]), CAST(:destinations AS text[]))
    )
    GROUP BY origin, destination, week
    """
)


def _provenance(sandbox: bool, live: bool) -> Provenance:
    if sandbox and live:
        return "MIXED"
    return "SANDBOX" if sandbox else "LIVE"


async def market_pulse(
    db: AsyncSession, agency: AgencySettings, *, now: datetime
) -> MarketPulseOut:
    """The agency's searched routes whose median per-traveller cheapest fare moved most: the
    last 7 local days against days 8–35, with the last 8 weeks' medians (oldest first)."""
    span = window(now, agency.timezone, 7 * MARKET_WEEKS)
    params: dict[str, Any] = {
        "agency": agency.id,
        "tz": agency.timezone,
        "currency": agency.currency,
        "today": span.today,
        "since": span.start,
        "end": span.end,
        "min_samples": MARKET_MIN_SAMPLES,
    }
    routes: list[MarketRoute] = []
    for row in await db.execute(_MARKET_ROUTES, params):
        current, previous = _half_up(row.current), _half_up(row.previous)
        if current is None or not previous:
            continue
        change = _one_dp(Decimal(current - previous) * 100 / Decimal(previous))
        assert change is not None
        routes.append(
            MarketRoute(
                origin=row.origin,
                destination=row.destination,
                current_minor=current,
                previous_minor=previous,
                change_pct=change,
                samples=row.samples,
                weekly=[None] * MARKET_WEEKS,
                provenance=_provenance(row.sandbox, row.live),
            )
        )
    routes.sort(key=lambda r: (-abs(r.change_pct), -r.samples, r.origin, r.destination))
    routes = routes[:MARKET_ROUTES]
    if not routes:
        return MarketPulseOut(currency=agency.currency, routes=[])
    by_route = {(r.origin, r.destination): r for r in routes}
    chosen = params | {
        "origins": [r.origin for r in routes],
        "destinations": [r.destination for r in routes],
    }
    for row in await db.execute(_MARKET_WEEKS, chosen):
        route = by_route.get((row.origin, row.destination))
        if route is not None and 0 <= row.week < MARKET_WEEKS:
            route.weekly[MARKET_WEEKS - 1 - row.week] = _half_up(row.median)
    return MarketPulseOut(currency=agency.currency, routes=routes)


# --- supplier health --------------------------------------------------------------------------

# Latency and offers describe the calls that succeeded; failures only lower the success rate
# (a timed-out call's latency is the timeout, not the supplier's speed).
_SUPPLIER_HEALTH = text(
    """
    SELECT supplier, search_kind AS kind, count(*) AS calls,
           count(*) FILTER (WHERE status = 'ok') AS ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
               FILTER (WHERE status = 'ok') AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
               FILTER (WHERE status = 'ok') AS p95,
           avg(offer_count) FILTER (WHERE status = 'ok') AS avg_offers
    FROM search_source_results
    WHERE agency_id = :agency AND occurred_at >= :since
    GROUP BY supplier, search_kind
    ORDER BY calls DESC, supplier, kind
    """
)


async def supplier_health(
    db: AsyncSession, agency: AgencySettings, range_: HealthRange, *, now: datetime
) -> SupplierHealthOut:
    rows = await db.execute(
        _SUPPLIER_HEALTH, {"agency": agency.id, "since": now - HEALTH_WINDOWS[range_]}
    )
    return SupplierHealthOut(
        suppliers=[
            SupplierHealth(
                supplier=row.supplier,
                kind=row.kind,
                calls=row.calls,
                ok=row.ok,
                success_pct=_percent(row.ok, row.calls) or 0.0,
                p50_ms=_half_up(row.p50),
                p95_ms=_half_up(row.p95),
                avg_offers=_one_dp(row.avg_offers),
            )
            for row in rows
        ]
    )


# --- team -------------------------------------------------------------------------------------

# Per user in the range: enquiries they hold (assignee, else creator) created, quotes they
# created and sent, and the value of those quotes accepted.
_TEAM = text(
    f"""
    SELECT user_id, sum(enquiries) AS enquiries, sum(quotes_sent) AS quotes_sent,
           sum(won) AS won
    FROM (
        SELECT COALESCE(assignee_user_id, created_by) AS user_id,
               1 AS enquiries, 0 AS quotes_sent, 0::bigint AS won
        FROM enquiries
        WHERE agency_id = :agency AND created_at >= :start AND created_at < :end
        UNION ALL
        SELECT created_by, 0, 1, 0
        FROM quotes
        WHERE agency_id = :agency AND sent_at >= :start AND sent_at < :end
        UNION ALL
        SELECT q.created_by, 0, 0, {_MIN_SELL}
        {_SENT_VERSION}
        WHERE q.agency_id = :agency AND q.status = 'accepted' AND q.currency = :currency
          AND q.decided_at >= :start AND q.decided_at < :end
    ) AS t
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    """
)


async def team(
    db: AsyncSession, agency: AgencySettings, range_: Range, *, now: datetime
) -> TeamOut:
    """Every active member (zeros included): most won value first, then most quotes sent."""
    params = _range_params(agency, window(now, agency.timezone, RANGE_DAYS[range_]))
    stats: dict[UUID, tuple[int, int, int]] = {
        row.user_id: (int(row.enquiries), int(row.quotes_sent), int(row.won))
        for row in await db.execute(_TEAM, params)
    }
    members = [
        TeamMemberStats(
            user=MemberRef(id=m.id, full_name=m.full_name, role=m.role),
            enquiries=stats.get(m.id, (0, 0, 0))[0],
            quotes_sent=stats.get(m.id, (0, 0, 0))[1],
            won_value_minor=stats.get(m.id, (0, 0, 0))[2],
        )
        for m in await identity_service.list_active_members(db, agency.id)
    ]
    members.sort(key=lambda s: (-s.won_value_minor, -s.quotes_sent, -s.enquiries))
    return TeamOut(members=members)


# --- departures -------------------------------------------------------------------------------

_DEPARTURES = text(
    """
    SELECT e.id, e.number, c.name AS client, e.origin, e.destination, e.depart_date,
           e.adults + cardinality(e.children_ages) AS travellers
    FROM enquiries e
    LEFT JOIN clients c ON c.id = e.client_id
    WHERE e.agency_id = :agency AND e.status = 'won' AND e.depart_date >= :today
    ORDER BY e.depart_date, e.number
    LIMIT :limit
    """
)


async def departures(db: AsyncSession, agency: AgencySettings, *, now: datetime) -> DeparturesOut:
    """Won trips departing today (agency time) or later, soonest first."""
    today = now.astimezone(ZoneInfo(agency.timezone)).date()
    rows = await db.execute(
        _DEPARTURES, {"agency": agency.id, "today": today, "limit": DEPARTURES_LIMIT}
    )
    return DeparturesOut(
        items=[
            Departure(
                enquiry_id=row.id,
                number=format_number("enquiry", row.number),
                client=row.client,
                origin=row.origin,
                destination=row.destination,
                depart_date=row.depart_date,
                travellers=row.travellers,
            )
            for row in rows
        ]
    )


# --- onboarding -------------------------------------------------------------------------------

_ONBOARDING = text(
    """
    SELECT
        EXISTS (
            SELECT 1 FROM activity_events WHERE agency_id = :agency AND kind = 'agency.updated'
        ) AS profile,
        EXISTS (SELECT 1 FROM flight_searches WHERE agency_id = :agency) AS fare_scan,
        EXISTS (SELECT 1 FROM clients WHERE agency_id = :agency) AS client,
        EXISTS (
            SELECT 1 FROM quotes WHERE agency_id = :agency AND sent_at IS NOT NULL
        ) AS quote
    """
)
OnboardingKey = Literal["profile", "supplier", "team", "fare_scan", "client", "quote"]
# (key, label, link). No link: the step's screen isn't built yet, so it is listed as coming.
_STEPS: list[tuple[OnboardingKey, str, str | None]] = [
    ("profile", "Add your agency details", None),
    ("supplier", "Connect a live supplier", "/app/suppliers"),
    ("team", "Invite a teammate", "/app/team"),
    ("fare_scan", "Run your first fare scan", "/app/fares"),
    ("client", "Add a client", "/app"),
    ("quote", "Send your first quote", None),
]


async def onboarding(db: AsyncSession, agency: AgencySettings, settings: Settings) -> OnboardingOut:
    row = (await db.execute(_ONBOARDING, {"agency": agency.id})).one()
    live_supplier = any(
        s.connected for s in supplier_statuses(settings) if s.code in LIVE_SUPPLIER_CODES
    )
    done: dict[OnboardingKey, bool] = {
        "profile": row.profile or agency.is_demo,
        "supplier": live_supplier or agency.is_demo,
        "team": len(await identity_service.list_active_members(db, agency.id)) >= 2,
        "fare_scan": row.fare_scan,
        "client": row.client,
        "quote": row.quote,
    }
    items = [
        OnboardingItem(key=key, label=label, done=done[key], available=href is not None, href=href)
        for key, label, href in _STEPS
    ]
    return OnboardingOut(items=items, completed=sum(item.done for item in items), total=len(items))


# --- notifications ----------------------------------------------------------------------------

# Events that concern the user and that someone else caused: decisions on quotes they created,
# enquiries assigned to them, and teammates joining.
_RELEVANT = """
    FROM activity_events a
    LEFT JOIN quotes q ON a.entity_type = 'quote' AND q.id = a.entity_id
    WHERE a.agency_id = :agency
      AND a.actor_user_id IS DISTINCT FROM :user
      AND (
          (a.kind IN ('quote.viewed', 'quote.accepted', 'quote.declined')
               AND q.created_by = :user)
          OR (a.kind = 'enquiry.assigned' AND a.data ->> 'assignee_user_id' = :user_text)
          OR a.kind = 'team.joined'
      )
"""
_NOTIFICATIONS = text(
    f"""
    SELECT a.id, a.kind, a.summary, a.occurred_at
    {_RELEVANT}
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT :limit
    """
)
_UNREAD = text(
    f"""
    SELECT count(*)
    {_RELEVANT}
      AND a.occurred_at > :seen
    """
)


async def notifications(
    db: AsyncSession, agency: AgencySettings, user_id: UUID
) -> NotificationsOut:
    seen = await identity_service.get_notifications_read_until(db, user_id)
    params = {
        "agency": agency.id,
        "user": user_id,
        "user_text": str(user_id),
        "seen": seen,
        "limit": NOTIFICATIONS_LIMIT,
    }
    unread: int = (await db.execute(_UNREAD, params)).scalar_one()
    rows = await db.execute(_NOTIFICATIONS, params)
    return NotificationsOut(
        unread=unread,
        items=[
            NotificationItem(
                id=row.id,
                kind=row.kind,
                summary=row.summary,
                occurred_at=row.occurred_at,
                read=row.occurred_at <= seen,
            )
            for row in rows
        ],
    )


# --- global search ----------------------------------------------------------------------------

_CLIENT_HITS = text(
    """
    SELECT id, name, email, company_name
    FROM clients
    WHERE agency_id = :agency
      AND (name ILIKE :pattern ESCAPE '\\' OR email ILIKE :pattern ESCAPE '\\'
           OR company_name ILIKE :pattern ESCAPE '\\')
    ORDER BY name, id
    LIMIT :limit
    """
)
_ENQUIRY_HITS = """
    SELECT e.id, e.number, e.origin, e.destination, e.status
    FROM enquiries e
    LEFT JOIN clients c ON c.id = e.client_id
    WHERE e.agency_id = :agency AND {condition}
    ORDER BY e.created_at DESC, e.number DESC
    LIMIT :limit
"""
_ENQUIRIES_BY_NUMBER = text(_ENQUIRY_HITS.format(condition="e.number = :number"))
_ENQUIRIES_BY_TEXT = text(
    _ENQUIRY_HITS.format(
        condition="(e.origin ILIKE :pattern ESCAPE '\\' OR e.destination ILIKE :pattern "
        "ESCAPE '\\' OR c.name ILIKE :pattern ESCAPE '\\')"
    )
)
_QUOTE_HITS = """
    SELECT q.id, q.number, q.status, c.name AS client_name
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    WHERE q.agency_id = :agency AND {condition}
    ORDER BY q.created_at DESC, q.number DESC
    LIMIT :limit
"""
_QUOTES_BY_NUMBER = text(_QUOTE_HITS.format(condition="q.number = :number"))
_QUOTES_BY_TEXT = text(_QUOTE_HITS.format(condition="c.name ILIKE :pattern ESCAPE '\\'"))


def _numbered(query: str, prefix: str) -> int | None:
    """The number in 'E-0007' / 'q-7' style queries for `prefix`, else None."""
    head, sep, digits = query.partition("-")
    if sep and head.upper() == prefix and digits.isascii() and digits.isdigit():
        return int(digits) if len(digits) <= 9 else None
    return None


async def global_search(db: AsyncSession, agency: AgencySettings, query: str) -> SearchOut:
    """Clients (name, email, company), enquiries (route codes, client name) and quotes (client
    name), up to 5 each. 'E-0002' / 'Q-0001' match that number exactly and nothing else."""
    base = {"agency": agency.id, "limit": SEARCH_LIMIT}
    enquiry_number, quote_number = _numbered(query, "E"), _numbered(query, "Q")

    async def rows(sql: TextClause, params: dict[str, Any]) -> Sequence[Any]:
        return (await db.execute(sql, base | params)).all()

    def enquiry_hits(found: Sequence[Any]) -> list[EnquiryHit]:
        return [
            EnquiryHit(
                id=r.id,
                number=format_number("enquiry", r.number),
                origin=r.origin,
                destination=r.destination,
                status=r.status,
            )
            for r in found
        ]

    def quote_hits(found: Sequence[Any]) -> list[QuoteHit]:
        return [
            QuoteHit(
                id=r.id,
                number=format_number("quote", r.number),
                status=r.status,
                client_name=r.client_name,
            )
            for r in found
        ]

    if enquiry_number is not None or quote_number is not None:
        return SearchOut(
            clients=[],
            enquiries=enquiry_hits(
                await rows(_ENQUIRIES_BY_NUMBER, {"number": enquiry_number})
                if enquiry_number is not None
                else []
            ),
            quotes=quote_hits(
                await rows(_QUOTES_BY_NUMBER, {"number": quote_number})
                if quote_number is not None
                else []
            ),
        )
    pattern = {"pattern": f"%{escape_like(query)}%"}
    return SearchOut(
        clients=[
            ClientHit(id=r.id, name=r.name, email=r.email, company_name=r.company_name)
            for r in await rows(_CLIENT_HITS, pattern)
        ],
        enquiries=enquiry_hits(await rows(_ENQUIRIES_BY_TEXT, pattern)),
        quotes=quote_hits(await rows(_QUOTES_BY_TEXT, pattern)),
    )
