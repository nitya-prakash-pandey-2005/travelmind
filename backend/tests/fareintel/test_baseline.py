from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update
from sqlalchemy.exc import DBAPIError

from travelmind.db import get_sessionmaker
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.service import Baseline, assess, compute_baseline

TODAY = datetime.now(UTC).date()


async def add(
    totals: list[int],
    *,
    provenance: str = "LIVE",
    days_to_departure: int = 30,
    age_days: int = 0,
    currency: str = "INR",
    cabin: str = "economy",
) -> None:
    async with get_sessionmaker()() as db:
        db.add_all(
            FareSnapshot(
                observed_at=datetime.now(UTC) - timedelta(days=age_days),
                origin="DEL",
                destination="BOM",
                departure_date=TODAY + timedelta(days=days_to_departure),
                days_to_departure=days_to_departure,
                cabin=cabin,
                carrier="AI",
                stops=0,
                total_minor=t,
                currency=currency,
                provenance=provenance,
                source="test",
            )
            for t in totals
        )
        await db.commit()


async def baseline(**changes) -> Baseline | None:
    fields = {
        "origin": "DEL",
        "destination": "BOM",
        "cabin": "economy",
        "currency": "INR",
        "days_to_departure": 30,
        "family": "market",
    } | changes
    async with get_sessionmaker()() as db:
        return await compute_baseline(db, **fields)


async def test_no_baseline_until_enough_fares_are_seen():
    await add([1000 * i for i in range(1, 8)])
    assert await baseline() is None


async def test_percentiles_of_matching_fares():
    await add([1000 * i for i in range(1, 11)])
    result = await baseline()
    assert result is not None
    assert (result.sample_size, result.p25_minor, result.median_minor, result.p75_minor) == (
        10,
        3250,
        5500,
        7750,
    )


async def test_half_minor_unit_percentiles_round_half_up():
    # Median 1002.5: half-up gives 1003, where Python's banker's round() would give 1002.
    await add([1002] * 4 + [1003] * 4)
    result = await baseline()
    assert result is not None and result.median_minor == 1003


async def test_sandbox_fares_never_shape_the_market_baseline():
    await add([1000] * 10, provenance="SANDBOX")
    assert await baseline(family="market") is None
    sandbox = await baseline(family="sandbox")
    assert sandbox is not None and sandbox.median_minor == 1000


async def test_cached_prices_count_as_market_data():
    await add([2000] * 5, provenance="LIVE")
    await add([4000] * 5, provenance="CACHED")
    result = await baseline()
    assert result is not None and result.sample_size == 10


async def test_old_or_far_off_observations_are_ignored():
    await add([1000] * 10, age_days=60)
    await add([1000] * 10, days_to_departure=90)
    await add([1000] * 10, currency="USD")
    await add([1000] * 10, cabin="business")
    assert await baseline() is None


def test_assess_signals():
    base = Baseline(
        family="market",
        currency="INR",
        sample_size=20,
        p25_minor=4000,
        median_minor=5000,
        p75_minor=6000,
    )
    good = assess(3800, base, 30)
    assert good.signal == "good" and good.delta_pct == -24.0 and "Good time to book" in good.message
    # Fare history is per traveller, and the message says so.
    assert good.message == (
        "24% under the median of 20 per-traveller fares seen for this route. Good time to book."
    )
    assert assess(5100, base, 30).signal == "typical"
    high_far = assess(6500, base, 45)
    assert high_far.signal == "high" and "consider waiting" in high_far.message
    high_near = assess(6500, base, 10)
    assert high_near.signal == "high" and "rarely fall" in high_near.message


def market(p25: int, median: int, p75: int) -> Baseline:
    return Baseline(
        family="market",
        currency="INR",
        sample_size=20,
        p25_minor=p25,
        median_minor=median,
        p75_minor=p75,
    )


@pytest.mark.parametrize(
    ("base", "price"),
    [
        (market(5000, 5000, 6000), 5000),  # at p25, but only because p25 == median
        (market(4000, 5000, 5000), 5000),  # at p75, but only because p75 == median
        (market(5000, 5000, 5000), 5000),  # every fare the same
        (market(9990, 10000, 10010), 9960),  # under p25 by -0.4%: rounds to "0% under"
        (market(9990, 10000, 10010), 10040),  # over p75 by +0.4%: rounds to "0% over"
    ],
)
def test_ties_and_negligible_differences_are_typical(base, price):
    insight = assess(price, base, 30)
    assert insight.signal == "typical"
    assert "0% under" not in insight.message and "0% over" not in insight.message


def test_half_a_percent_is_shown_as_one_percent():
    base = market(9990, 10000, 10010)
    good = assess(9950, base, 30)
    assert (good.signal, good.delta_pct) == ("good", -0.5)
    assert good.message.startswith("1% under")
    high = assess(10050, base, 10)
    assert (high.signal, high.delta_pct) == ("high", 0.5)
    assert high.message.startswith("1% over")


async def test_snapshots_are_append_only_for_the_app():
    await add([1000])
    async with get_sessionmaker()() as db:
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(update(FareSnapshot).values(total_minor=1))
    async with get_sessionmaker()() as db:
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(delete(FareSnapshot))


@pytest.mark.parametrize("total", [0, -100])
async def test_snapshots_must_have_a_positive_total(total):
    with pytest.raises(DBAPIError, match="ck_fare_snapshots_total_positive"):
        await add([total])
