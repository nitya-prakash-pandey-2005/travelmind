import asyncio

from tests.helpers import signup
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.counters import format_number, next_number


async def test_numbers_increase_per_agency_and_kind(client):
    agency = (await signup(client)).json()["agency"]["id"]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        got = [await next_number(db, agency, "enquiry") for _ in range(3)]
        got.append(await next_number(db, agency, "quote"))
        await db.commit()
    assert got == [1, 2, 3, 1]
    assert format_number("enquiry", 7) == "E-0007" and format_number("quote", 12345) == "Q-12345"


async def test_concurrent_numbers_are_unique(client):
    agency = (await signup(client)).json()["agency"]["id"]

    async def one() -> int:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            n = await next_number(db, agency, "quote")
            await db.commit()
            return n

    assert sorted(await asyncio.gather(*(one() for _ in range(8)))) == list(range(1, 9))
