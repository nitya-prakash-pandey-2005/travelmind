"""Shared support for the agent's tool tests: agencies, run contexts and feed fixtures."""

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest

from tests.helpers import run_as_owner
from travelmind.cache import get_shared_redis
from travelmind.config import Settings
from travelmind.db import get_sessionmaker

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_json(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


async def make_agency(
    name: str, *, country: str = "IN", currency: str = "INR"
) -> tuple[UUID, UUID]:
    """An agency and its owner, inserted as the table owner. Returns (agency_id, user_id)."""
    agency_id, user_id = uuid4(), uuid4()
    await run_as_owner(
        "INSERT INTO agencies (id, name, country_code, currency) "
        "VALUES (:id, :name, :country, :currency)",
        {"id": agency_id, "name": name, "country": country, "currency": currency},
    )
    await run_as_owner(
        "INSERT INTO users (id, agency_id, email, full_name, password_hash, role) "
        "VALUES (:id, :aid, :email, 'Owner', 'x', 'owner')",
        {"id": user_id, "aid": agency_id, "email": f"owner@{name.lower()}.example"},
    )
    return agency_id, user_id


def agent_settings(**changes: Any) -> Settings:
    """Settings without backend/.env (the sandbox supplier on, no keys), plus `changes`."""
    return Settings(_env_file=None).model_copy(update=changes)


def fixed_clock(day: date) -> Callable[[], datetime]:
    return lambda: datetime.combine(day, time(6, 0), tzinfo=UTC)


@asynccontextmanager
async def run_context(
    agency_id: UUID,
    user_id: UUID,
    *,
    role: str = "agency",
    settings: Settings | None = None,
    today: date | None = None,
) -> AsyncIterator[Any]:
    from travelmind.agent.context import build_context

    async with get_sessionmaker()() as db:
        ctx = await build_context(
            db,
            get_shared_redis(),
            settings or agent_settings(),
            agency_id=agency_id,
            user_id=user_id,
            role=role,  # type: ignore[arg-type]
            **({"clock": fixed_clock(today)} if today else {}),
        )
        yield ctx


@pytest.fixture
async def agency() -> tuple[UUID, UUID]:
    return await make_agency("Alpha")


def open_meteo_archive(request: Any) -> Any:
    """A respx side effect: an Open-Meteo archive answer for the requested dates. Each day's
    maximum is 30 °C plus 0.2 °C per year after 2020, its minimum 10 °C lower, and it rains 2 mm
    on every day of an odd year (none in even years)."""
    import httpx

    params = request.url.params
    start, end = date.fromisoformat(params["start_date"]), date.fromisoformat(params["end_date"])
    days = [date.fromordinal(n) for n in range(start.toordinal(), end.toordinal() + 1)]
    highs = [round(30 + 0.2 * (d.year - 2020), 1) for d in days]
    return httpx.Response(
        200,
        json={
            "latitude": float(params["latitude"]),
            "longitude": float(params["longitude"]),
            "timezone": "Asia/Kolkata",
            "daily_units": {"temperature_2m_max": "°C", "precipitation_sum": "mm"},
            "daily": {
                "time": [d.isoformat() for d in days],
                "temperature_2m_max": highs,
                "temperature_2m_min": [round(h - 10, 1) for h in highs],
                "precipitation_sum": [2.0 if d.year % 2 else 0.0 for d in days],
            },
        },
    )
