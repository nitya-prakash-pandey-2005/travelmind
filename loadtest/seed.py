"""Seed load-test agencies into the production-like stack (deploy/) and write loadtest/users.json.

Each agency gets an owner (through the signup service), agents with the same known password,
and a month of realistic work (clients, enquiries, quotes, searches, activity) from the demo
seeder, which runs every step through the workspace and offers services against the in-process
sandbox supplier. One quote per agency is (re)sent to mint a client share link for k6.

The stack's database is reachable only on its compose network, so run this inside a container
that has the app's settings (the worker service; see "Load tests" in deploy/README.md):

    docker compose -f deploy/docker-compose.yml -p travelmind-prod --env-file deploy/.env \
      run --rm --no-deps -v "$PWD/loadtest:/loadtest" -e LOADTEST_PASSWORD \
      worker python /loadtest/seed.py --i-know --agencies 50 --users-per-agency 4 \
      --out /loadtest/users.json

From backend/ against a non-production database: `uv run python ../loadtest/seed.py`.

The stack runs with TM_ENVIRONMENT=production, so the script refuses to run unless `--i-know`
is given: never point it at a real deployment. It is idempotent: agencies that already exist
(by owner email) are reused, and only their share links are re-minted.

Password: env LOADTEST_PASSWORD, default `loadtest-pass-2026` (test-only).
users.json is git-ignored; it holds emails, agency numbers and share tokens, never passwords.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from travelmind.cache import close_redis, get_shared_redis
from travelmind.config import get_settings
from travelmind.db import bind_tenant, get_engine, get_sessionmaker, pinned_session
from travelmind.demo.generator import seed_demo_workspace
from travelmind.http import close_http_clients
from travelmind.identity import service as identity_service
from travelmind.identity.models import User
from travelmind.identity.passwords import hash_password_async
from travelmind.identity.service import SessionContext, TeamMember
from travelmind.workspace.models import Quote
from travelmind.workspace.quotes import load_quote, send_quote

DEFAULT_PASSWORD = "loadtest-pass-2026"
EMAIL_DOMAIN = "loadtest.example.com"
CTX = SessionContext(user_agent="loadtest-seed", ip_address=None)


def email_for(agency: int, user: int) -> str:
    return f"lt{agency:03d}-u{user}@{EMAIL_DOMAIN}"


async def _team(
    agency_no: int, users_per_agency: int, password: str, agent_hash: str
) -> tuple[UUID, list[TeamMember], bool]:
    """The agency's id and team (owner first), creating them if needed. True when created."""
    async with get_sessionmaker()() as db:
        owner_email = email_for(agency_no, 0)
        existing = await db.scalar(select(User).where(User.email == owner_email))
        if existing is not None:
            await bind_tenant(db, existing.agency_id)
            rows = (
                await db.scalars(
                    select(User).where(User.agency_id == existing.agency_id).order_by(User.email)
                )
            ).all()
            team = [TeamMember(id=u.id, full_name=u.full_name) for u in rows]
            return existing.agency_id, team, False
        owner, agency, _token = await identity_service.signup(
            db,
            agency_name=f"Loadtest Travel {agency_no:03d}",
            full_name=f"Loadtest Owner {agency_no:03d}",
            email=owner_email,
            password=password,
            ctx=CTX,
        )
        agents = [
            User(
                id=uuid4(),
                agency_id=agency.id,
                email=email_for(agency_no, n),
                full_name=f"Loadtest Agent {agency_no:03d}-{n}",
                password_hash=agent_hash,
                role="agent",
            )
            for n in range(1, users_per_agency)
        ]
        db.add_all(agents)
        await db.commit()
        team = [TeamMember(id=owner.id, full_name=owner.full_name)]
        team += [TeamMember(id=a.id, full_name=a.full_name) for a in agents]
        return agency.id, team, True


async def _seed_workspace(agency_id: UUID, team: list[TeamMember]) -> None:
    settings = get_settings()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        agency_settings = await identity_service.get_agency_settings(db, agency_id)
    async with pinned_session() as seed_db:
        await seed_demo_workspace(
            seed_db,
            get_shared_redis(),
            settings,
            agency=agency_settings,
            users=team,
            now=datetime.now(UTC),
        )


async def _share_link(agency_id: UUID, actor: UUID) -> str | None:
    """Re-send one of the agency's sent (or viewed) quotes: a fresh share token, the old one
    stops working. None when the agency has no such quote."""
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        quote_id = await db.scalar(
            select(Quote.id)
            .where(
                Quote.agency_id == agency_id,
                Quote.status.in_(("sent", "viewed")),
                Quote.current_version >= 1,
            )
            .order_by(Quote.number)
            .limit(1)
        )
        if quote_id is None:
            return None
        quote = await load_quote(db, quote_id, for_update=True)
        token = await send_quote(db, quote, actor)
        await db.commit()
        return token


async def _one(
    agency_no: int, users_per_agency: int, password: str, agent_hash: str
) -> dict[str, object]:
    agency_id, team, created = await _team(agency_no, users_per_agency, password, agent_hash)
    if created:
        await _seed_workspace(agency_id, team)
    token = await _share_link(agency_id, team[0].id)
    print(
        f"agency {agency_no:03d}: {'seeded' if created else 'reused'}, "
        f"{len(team)} users, share link {'yes' if token else 'NONE'}",
        flush=True,
    )
    return {
        "agency": agency_no,
        "users": [email_for(agency_no, n) for n in range(len(team))],
        "quote_token": token,
    }


async def run(args: argparse.Namespace, password: str) -> list[dict[str, object]]:
    agent_hash = await hash_password_async(password)
    sem = asyncio.Semaphore(args.concurrency)

    async def guarded(n: int) -> dict[str, object]:
        async with sem:
            return await _one(n, args.users_per_agency, password, agent_hash)

    try:
        agencies = await asyncio.gather(*(guarded(n) for n in range(args.agencies)))
    finally:
        await close_redis()
        await close_http_clients()
        await get_engine().dispose()
    return list(agencies)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--agencies", type=int, default=50)
    parser.add_argument("--users-per-agency", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=4, help="agencies seeded at once")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent / "users.json"),
        help="where to write users.json (git-ignored)",
    )
    parser.add_argument(
        "--i-know",
        action="store_true",
        help="allow TM_ENVIRONMENT=production (the local deploy/ stack only)",
    )
    args = parser.parse_args(argv)
    if args.agencies < 1 or args.users_per_agency < 1:
        parser.error("--agencies and --users-per-agency must be at least 1")
    if get_settings().environment == "production" and not args.i_know:
        print(
            "Refusing to seed load-test accounts: TM_ENVIRONMENT=production. This script is for "
            "the local deploy/ stack only; pass --i-know if that is what this is.",
            file=sys.stderr,
        )
        return 2
    password = os.environ.get("LOADTEST_PASSWORD") or DEFAULT_PASSWORD
    agencies = asyncio.run(run(args, password))
    result = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "password_env": "LOADTEST_PASSWORD",
        "agencies": agencies,
    }
    out = Path(args.out)
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    missing = sum(1 for a in agencies if not a["quote_token"])
    print(f"wrote {out} ({args.agencies} agencies, {missing} without a share link)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
