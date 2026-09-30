"""Typical fares for a route and booking window, and what a price means against them."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

MIN_SAMPLES = 8
WINDOW_DAYS = 45
DTD_TOLERANCE = 10
WAIT_THRESHOLD_DAYS = 21

Family = Literal["market", "sandbox"]
PROVENANCES: dict[Family, tuple[str, ...]] = {"market": ("LIVE", "CACHED"), "sandbox": ("SANDBOX",)}

_BASELINE_SQL = text(
    """
    SELECT count(*) AS n,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY total_minor) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY total_minor) AS p50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY total_minor) AS p75
    FROM fare_snapshots
    WHERE origin = :origin AND destination = :destination
      AND cabin = :cabin AND currency = :currency
      AND provenance = ANY(:provenances)
      AND observed_at >= now() - make_interval(days => :window)
      AND abs(days_to_departure - :dtd) <= :tolerance
    """
)


@dataclass(frozen=True)
class Baseline:
    family: Family
    currency: str
    sample_size: int
    p25_minor: int
    median_minor: int
    p75_minor: int
    window_days: int = WINDOW_DAYS


@dataclass(frozen=True)
class Insight:
    signal: Literal["good", "typical", "high"]
    delta_pct: float
    message: str


def _minor(value: float) -> int:
    """A percentile rounded half-up to a whole minor unit (Python's round() is half-to-even)."""
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


async def compute_baseline(
    db: AsyncSession,
    *,
    origin: str,
    destination: str,
    cabin: str,
    currency: str,
    days_to_departure: int,
    family: Family,
) -> Baseline | None:
    row = (
        await db.execute(
            _BASELINE_SQL,
            {
                "origin": origin,
                "destination": destination,
                "cabin": cabin,
                "currency": currency,
                "provenances": list(PROVENANCES[family]),
                "window": WINDOW_DAYS,
                "dtd": days_to_departure,
                "tolerance": DTD_TOLERANCE,
            },
        )
    ).one()
    if row.n < MIN_SAMPLES:
        return None
    return Baseline(
        family=family,
        currency=currency,
        sample_size=int(row.n),
        p25_minor=_minor(row.p25),
        median_minor=_minor(row.p50),
        p75_minor=_minor(row.p75),
    )


def assess(price_minor: int, baseline: Baseline, days_to_departure: int) -> Insight:
    """What one traveller's fare (`price_minor`, in the baseline's currency) means today."""
    delta = round((price_minor - baseline.median_minor) / baseline.median_minor * 100, 1)
    # Whole percent shown to the user, rounded half-up (f"{x:.0f}" would round 0.5 down to 0).
    pct = int(Decimal(str(abs(delta))).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    # Fare history holds one traveller's fare per row, so `price_minor` must be per traveller too.
    seen = f"the median of {baseline.sample_size} per-traveller fares seen for this route"
    # A verdict needs a real, visible difference from the median: sitting on a percentile that
    # ties with the median, or a difference that rounds to 0%, is just the typical price.
    if pct > 0 and price_minor <= baseline.p25_minor and price_minor < baseline.median_minor:
        return Insight("good", delta, f"{pct}% under {seen}. Good time to book.")
    if pct > 0 and price_minor >= baseline.p75_minor and price_minor > baseline.median_minor:
        if days_to_departure > WAIT_THRESHOLD_DAYS:
            return Insight(
                "high",
                delta,
                f"{pct}% over {seen}. Prices this far out often dip — consider waiting.",
            )
        return Insight(
            "high",
            delta,
            f"{pct}% over {seen}, but departure is close — prices rarely fall now.",
        )
    sign = "-" if delta < 0 and pct else "+"
    return Insight(
        "typical",
        delta,
        f"Around the typical price for this route and booking window ({sign}{pct}%).",
    )


_ROUTES_WITH_HISTORY = text(
    """
    SELECT count(DISTINCT (origin, destination)) FROM fare_snapshots
    WHERE provenance = ANY(:provenances)
    """
)


async def count_routes_with_history(db: AsyncSession) -> int:
    """Routes with market fare history (live or cached fares; sandbox fares don't count)."""
    result = await db.scalar(_ROUTES_WITH_HISTORY, {"provenances": list(PROVENANCES["market"])})
    return int(result or 0)
