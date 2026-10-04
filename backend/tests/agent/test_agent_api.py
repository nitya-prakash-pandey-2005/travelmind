"""The agent API: creating runs (inline in development and tests, queued otherwise), reading them,
the live event stream, replies, confirmations, cancellation, limits and tenancy."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select

from tests.agent.conftest import open_meteo_archive
from tests.helpers import exec_as_tenant, make_client, signup
from travelmind.agent import events, service
from travelmind.agent.fake import FakeProvider
from travelmind.agent.models import AgentStep
from travelmind.agent.provider import AgentUnavailable, Generation, ToolCall
from travelmind.agent.tools.base import display_date
from travelmind.agent.tools.weather import ARCHIVE_URL
from travelmind.cache import get_shared_redis
from travelmind.config import Settings, get_settings
from travelmind.db import bind_tenant, get_sessionmaker

RUNS = "/api/v1/agent/runs"
TODAY = datetime.now(UTC).date()
RUN_KEYS = {
    "id",
    "kind",
    "status",
    "prompt",
    "provider",
    "model",
    "demo",
    "prompt_version",
    "grounded",
    "error",
    "result",
    "pending",
    "input_tokens",
    "output_tokens",
    "created_at",
    "started_at",
    "finished_at",
}
STEP_KEYS = {"seq", "kind", "payload", "duration_ms", "created_at"}


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def gen(text: str | None = None, *calls: ToolCall) -> Generation:
    return Generation(text=text, calls=calls, input_tokens=3, output_tokens=2)


@pytest.fixture(autouse=True)
async def drain_inline_runs():
    yield
    await service.drain_inline_runs()


@pytest.fixture(autouse=True)
def sandbox_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "sandbox_supplier", True)


def use(monkeypatch, provider) -> None:
    monkeypatch.setattr(service, "get_provider", lambda settings: provider)


async def wait_for(client, run_id: str, *statuses: str, within_s: float = 15.0) -> dict[str, Any]:
    wanted = set(statuses) or {"done", "failed", "cancelled", "budget_exceeded", "waiting_for_user"}
    deadline = asyncio.get_running_loop().time() + within_s
    while True:
        body = (await client.get(f"{RUNS}/{run_id}")).json()
        if body["status"] in wanted:
            return body
        assert asyncio.get_running_loop().time() < deadline, body
        await asyncio.sleep(0.02)


def parse_sse(raw: str) -> list[dict[str, Any]]:
    events_: list[dict[str, Any]] = []
    for block in raw.split("\n\n"):
        fields: dict[str, Any] = {}
        for line in block.splitlines():
            if line.startswith(":"):
                continue
            name, _, value = line.partition(": ")
            fields[name] = value
        if "data" in fields:
            fields["data"] = json.loads(fields["data"])
            events_.append(fields)
    return events_


# --- creating and reading runs --------------------------------------------------------------


async def test_the_demo_planner_plans_a_grounded_trip_end_to_end(client, airports, respx_mock):
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    await signup(client)
    prompt = f"Delhi to Mumbai for 2 adults from {day(30)} to {day(33)}"
    created = await client.post(RUNS, json={"prompt": prompt})
    assert created.status_code == 202
    assert set(created.json()) == {"run_id", "status"}
    run = await wait_for(client, created.json()["run_id"], "done", "failed")
    assert run["status"] == "done", run
    assert set(run) == RUN_KEYS | {"steps"}
    assert run["provider"] == "fake" and run["model"] == "demo-planner" and run["demo"] is True
    assert run["grounded"] is True
    result = run["result"]
    assert result["fallback"] is False
    assert result["flights"] and result["flights"][0]["offer_id"].startswith("F")
    assert result["flights"][0]["total_formatted"] in result["summary"]
    assert result["trip"]["origin"] == "DEL" and result["trip"]["destination"] == "BOM"
    assert result["weather"]["label"] == "typical"
    kinds = [s["kind"] for s in run["steps"]]
    assert kinds[-2:] == ["guard", "answer"]
    assert [s["seq"] for s in run["steps"]] == list(range(len(kinds)))
    assert all(set(s) == STEP_KEYS for s in run["steps"])
    raw = json.dumps(run)
    assert "source_id" not in raw and "state" not in run
    listed = (await client.get(RUNS)).json()["items"]
    assert [r["id"] for r in listed] == [run["id"]]
    assert "steps" not in listed[0]


def shown(offset: int) -> str:
    return display_date(TODAY + timedelta(days=offset))


async def approve(client, run: dict[str, Any], tool: str) -> dict[str, Any]:
    """Approve the write `run` waits on (it must be `tool`); the run once it stops again."""
    assert run["status"] == "waiting_for_user", run
    pending = run["pending"]
    assert pending["kind"] == "confirm" and pending["tool"] == tool, pending
    decided = await client.post(
        f"{RUNS}/{run['id']}/confirm", json={"call_id": pending["call_id"], "approve": True}
    )
    assert decided.status_code == 202, decided.text
    await asyncio.sleep(0.05)  # let the queued run start
    return await wait_for(client, run["id"], "done", "failed", "waiting_for_user")


async def test_the_demo_planner_creates_the_enquiry_it_was_asked_for(client, airports, respx_mock):
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    await signup(client)
    # exactly the follow-up the plan board sends
    prompt = (
        f"Create an enquiry for this trip: DEL to BOM, {shown(30)} to {shown(33)}, 2 adults, "
        "economy."
    )
    created = await client.post(RUNS, json={"prompt": prompt})
    run = await wait_for(client, created.json()["run_id"], "done", "failed", "waiting_for_user")
    assert run["pending"]["action"].startswith(
        f"Create an enquiry DEL → BOM, {shown(30)} to {shown(33)}, 2 adults"
    )
    assert (await client.get("/api/v1/enquiries")).json()["total"] == 0
    run = await approve(client, run, "create_enquiry")
    assert run["status"] == "done" and run["grounded"] is True, run
    summary = run["result"]["summary"]
    assert "Enquiry E-0001 is created" in summary
    assert f"{shown(30)} to {shown(33)}" in summary and day(30) not in summary
    assert (await client.get("/api/v1/enquiries")).json()["total"] == 1


async def test_the_demo_planner_drafts_a_quote_after_two_approvals(client, airports, respx_mock):
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    await signup(client)
    prompt = f"Draft a quote for this trip: DEL to BOM, {shown(30)} to {shown(33)}, 2 adults."
    created = await client.post(RUNS, json={"prompt": prompt})
    run = await wait_for(client, created.json()["run_id"], "done", "failed", "waiting_for_user")
    run = await approve(client, run, "create_enquiry")
    action = run["pending"]["action"]
    assert action.startswith("Draft a quote on E-0001 with F1 (") and "F3 (" in action
    assert action.endswith("at a 10% markup.")
    run = await approve(client, run, "draft_quote")
    assert run["status"] == "done" and run["grounded"] is True, run
    summary = run["result"]["summary"]
    assert "Quote Q-0001 is drafted on E-0001 with F1, F2 and F3 at a 10% markup" in summary


async def test_prompts_and_replies_are_capped_at_2000_characters(client):
    await signup(client)
    assert (await client.post(RUNS, json={"prompt": "x" * 2001})).status_code == 422
    assert (await client.post(RUNS, json={"prompt": "   "})).status_code == 422
    fake = "00000000-0000-0000-0000-000000000000"
    long_reply = await client.post(f"{RUNS}/{fake}/reply", json={"text": "x" * 2001})
    assert long_reply.status_code == 422


async def test_the_agent_says_when_no_model_is_configured(client, monkeypatch):
    await signup(client)

    def unavailable(settings):
        raise AgentUnavailable

    monkeypatch.setattr(service, "get_provider", unavailable)
    response = await client.post(RUNS, json={"prompt": "Plan a trip"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Agent unavailable — no model configured."
    assert (await client.get("/api/v1/agent/availability")).json() == {
        "available": False,
        "provider": None,
        "model": None,
        "demo": False,
    }


async def test_availability_names_the_demo_planner(client):
    await signup(client)
    assert (await client.get("/api/v1/agent/availability")).json() == {
        "available": True,
        "provider": "fake",
        "model": "demo-planner",
        "demo": True,
    }


# --- inline runs vs the queue ---------------------------------------------------------------


def test_runs_are_inline_only_in_development_and_test():
    def inline(environment: str, value: bool | None = None) -> bool:
        changes: dict[str, Any] = {"environment": environment}
        if value is not None:
            changes["agent_inline"] = value
        return Settings(_env_file=None, **changes).agent_inline_enabled  # type: ignore[arg-type]

    assert inline("development") and inline("test")
    assert not inline("production")
    assert not inline("development", False) and not inline("production", False)


def test_production_refuses_inline_agent_runs_at_startup():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="TM_AGENT_INLINE=true is not allowed in production"):
        Settings(_env_file=None, environment="production", agent_inline=True)  # type: ignore[call-arg]


async def test_without_inline_runs_the_job_is_queued(client, monkeypatch):
    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_inline", False)
    queued: list[tuple[Any, ...]] = []

    async def enqueue(name, *args, job_id=None):
        queued.append((name, *args))
        return "job-1"

    monkeypatch.setattr(service.jobs, "enqueue", enqueue)
    created = await client.post(RUNS, json={"prompt": "Plan a trip"})
    assert created.status_code == 202
    run_id = created.json()["run_id"]
    agency = (await client.get("/api/v1/agency")).json()["id"]
    assert queued == [("run_agent_job", run_id, agency)]
    assert (await client.get(f"{RUNS}/{run_id}")).json()["status"] == "queued"


async def test_a_queue_timeout_is_503_and_frees_the_slot(client, monkeypatch):
    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_inline", False)
    monkeypatch.setattr(get_settings(), "agent_max_concurrent_runs_per_agency", 1)

    async def hung(name, *args, job_id=None):
        raise TimeoutError

    monkeypatch.setattr(service.jobs, "enqueue", hung)
    first = await client.post(RUNS, json={"prompt": "Plan a trip"})
    assert first.status_code == 503
    assert "try again" in first.json()["detail"].lower()
    second = await client.post(RUNS, json={"prompt": "Plan a trip"})
    assert second.status_code == 503  # not 429: the first run gave its slot back
    runs = (await client.get(RUNS)).json()["items"]
    assert {r["status"] for r in runs} == {"failed"}


# --- limits ---------------------------------------------------------------------------------


async def test_concurrent_runs_are_limited_per_agency(client, monkeypatch):
    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_inline", False)
    monkeypatch.setattr(get_settings(), "agent_max_concurrent_runs_per_agency", 1)

    async def enqueue(name, *args, job_id=None):
        return "job"

    monkeypatch.setattr(service.jobs, "enqueue", enqueue)
    assert (await client.post(RUNS, json={"prompt": "One"})).status_code == 202
    second = await client.post(RUNS, json={"prompt": "Two"})
    assert second.status_code == 429
    assert second.json()["detail"].startswith("Too many plans are running at once")


async def test_run_creation_is_rate_limited_per_agency(client, monkeypatch):
    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_runs_per_minute", 1)
    use(monkeypatch, FakeProvider(responder=lambda messages: gen("Hi.")))
    assert (await client.post(RUNS, json={"prompt": "One"})).status_code == 202
    second = await client.post(RUNS, json={"prompt": "Two"})
    assert second.status_code == 429
    assert "minute" in second.json()["detail"]


async def test_a_spent_monthly_budget_refuses_new_runs(client, monkeypatch):
    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_monthly_token_budget", 10)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    month = TODAY.replace(day=1)
    await exec_as_tenant(
        agency,
        "INSERT INTO agent_usage_monthly (agency_id, month, input_tokens, output_tokens) "
        "VALUES (:a, :m, 10, 0)",
        {"a": agency, "m": month},
    )
    response = await client.post(RUNS, json={"prompt": "Plan"})
    assert response.status_code == 429
    assert response.json()["detail"] == "This month's agent budget is used up."


# --- replies, confirmations, cancellation ---------------------------------------------------


async def test_ask_and_reply_through_the_api(client, monkeypatch):
    await signup(client)
    use(
        monkeypatch,
        FakeProvider(
            [
                gen(None, ToolCall("a1", "ask_user", {"question": "How many adults?"})),
                gen("Planned for 2 adults."),
            ]
        ),
    )
    run_id = (await client.post(RUNS, json={"prompt": "Plan a trip"})).json()["run_id"]
    waiting = await wait_for(client, run_id, "waiting_for_user")
    assert waiting["pending"] == {
        "kind": "question",
        "call_id": "a1",
        "question": "How many adults?",
        "fields": [],
        "unverified": False,
    }
    replied = await client.post(f"{RUNS}/{run_id}/reply", json={"text": "2 adults"})
    assert replied.status_code == 202 and replied.json()["status"] == "queued"
    done = await wait_for(client, run_id, "done")
    assert done["pending"] is None
    reply = next(s for s in done["steps"] if s["kind"] == "user")
    assert reply["payload"]["text"] == "2 adults"
    assert "by_user_id" not in reply["payload"]  # stored for the audit, never sent
    again = await client.post(f"{RUNS}/{run_id}/reply", json={"text": "more"})
    assert again.status_code == 409


async def test_confirm_and_reject_through_the_api(client, monkeypatch):
    await signup(client)
    create = ToolCall("w1", "create_enquiry", {"origin": "DEL", "destination": "BOM"})
    use(monkeypatch, FakeProvider([gen(None, create), gen("Declined, nothing created.")]))
    run_id = (await client.post(RUNS, json={"prompt": "Make an enquiry"})).json()["run_id"]
    waiting = await wait_for(client, run_id, "waiting_for_user")
    assert waiting["pending"]["kind"] == "confirm" and waiting["pending"]["call_id"] == "w1"
    assert waiting["pending"]["action"].startswith("Create an enquiry DEL → BOM")
    wrong = await client.post(f"{RUNS}/{run_id}/confirm", json={"call_id": "x", "approve": True})
    assert wrong.status_code == 409
    rejected = await client.post(
        f"{RUNS}/{run_id}/confirm", json={"call_id": "w1", "approve": False}
    )
    assert rejected.status_code == 202
    done = await wait_for(client, run_id, "done")
    assert (await client.get("/api/v1/enquiries")).json()["total"] == 0
    decision = next(s for s in done["steps"] if s["kind"] == "user")
    assert decision["payload"]["decision"] == "declined"
    assert "by_user_id" not in decision["payload"]


async def test_cancel_through_the_api(client, monkeypatch):
    await signup(client)
    use(monkeypatch, FakeProvider([gen(None, ToolCall("a1", "ask_user", {"question": "Who?"}))]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    await wait_for(client, run_id, "waiting_for_user")
    cancelled = await client.post(f"{RUNS}/{run_id}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (await client.post(f"{RUNS}/{run_id}/cancel")).status_code == 409


# --- tenancy ----------------------------------------------------------------------------------


async def test_runs_are_tenant_scoped(client, app, monkeypatch):
    await signup(client)
    use(monkeypatch, FakeProvider([gen(None, ToolCall("a1", "ask_user", {"question": "Who?"}))]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    await wait_for(client, run_id, "waiting_for_user")
    async with make_client(app) as other:
        await signup(other, email="owner@beta.example", agency_name="Beta Travels")
        assert (await other.get(f"{RUNS}/{run_id}")).status_code == 404
        assert (await other.get(f"{RUNS}/{run_id}/events")).status_code == 404
        reply = await other.post(f"{RUNS}/{run_id}/reply", json={"text": "me"})
        assert reply.status_code == 404
        confirm = await other.post(
            f"{RUNS}/{run_id}/confirm", json={"call_id": "a1", "approve": True}
        )
        assert confirm.status_code == 404
        assert (await other.post(f"{RUNS}/{run_id}/cancel")).status_code == 404
        assert (await other.get(RUNS)).json() == {"items": []}
    assert (await client.get(f"{RUNS}/{run_id}")).json()["status"] == "waiting_for_user"
    assert (await client.get(f"{RUNS}/not-a-uuid")).status_code == 422


async def test_the_api_needs_a_session(client):
    assert (await client.get(RUNS)).status_code == 401
    assert (await client.post(RUNS, json={"prompt": "x"})).status_code == 401


# --- the event stream -------------------------------------------------------------------------


async def test_sse_replays_stored_steps_after_the_last_event_id(client, monkeypatch):
    await signup(client)
    use(
        monkeypatch,
        FakeProvider(
            [gen(None, ToolCall("l1", "lookup_airport", {"query": "Delhi"})), gen("Done.")]
        ),
    )
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    run = await wait_for(client, run_id, "done")
    seqs = [s["seq"] for s in run["steps"]]
    response = await client.get(f"{RUNS}/{run_id}/events", headers={"Last-Event-ID": "1"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["cache-control"] == "no-cache"
    sent = parse_sse(response.text)
    steps = [e for e in sent if e["event"] == "step"]
    assert [int(e["id"]) for e in steps] == [s for s in seqs if s > 1]
    assert [e["data"]["seq"] for e in steps] == [s for s in seqs if s > 1]
    assert sent[-1]["event"] == "status" and sent[-1]["data"]["status"] == "done"
    assert "id" not in sent[-1]
    by_query = await client.get(f"{RUNS}/{run_id}/events", params={"last_event_id": "2"})
    assert [e["data"]["seq"] for e in parse_sse(by_query.text) if e["event"] == "step"] == [
        s for s in seqs if s > 2
    ]
    everything = await client.get(f"{RUNS}/{run_id}/events")
    assert [e["data"]["seq"] for e in parse_sse(everything.text) if e["event"] == "step"] == seqs


async def _subscribers(run_id: str) -> int:
    counts = await get_shared_redis().pubsub_numsub(events.channel(run_id))
    return int(counts[0][1])


async def test_sse_replays_then_streams(client, monkeypatch):
    """A browser reconnecting mid-run sees every step exactly once, in order: the stored ones
    after its Last-Event-ID, then the live ones, then the final status."""
    await signup(client)
    gate = asyncio.Event()

    async def held(messages):
        await gate.wait()
        return gen(None, ToolCall("l2", "lookup_airport", {"query": "Mumbai"}))

    use(
        monkeypatch,
        FakeProvider(
            [
                gen(None, ToolCall("l1", "lookup_airport", {"query": "Delhi"})),
                held,
                gen("All done."),
            ]
        ),  # fmt: skip
    )
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    for _ in range(500):
        if len((await client.get(f"{RUNS}/{run_id}")).json()["steps"]) >= 2:
            break
        await asyncio.sleep(0.02)
    stream = asyncio.create_task(
        client.get(f"{RUNS}/{run_id}/events", headers={"Last-Event-ID": "0"})
    )
    for _ in range(500):
        if await _subscribers(run_id):
            break
        await asyncio.sleep(0.02)
    assert await _subscribers(run_id) == 1
    gate.set()
    response = await asyncio.wait_for(stream, 15)
    sent = parse_sse(response.text)
    seqs = [e["data"]["seq"] for e in sent if e["event"] == "step"]
    assert seqs == list(range(1, len(seqs) + 1))  # 1, 2, 3, ...: once each, in order
    kinds = [e["data"]["kind"] for e in sent if e["event"] == "step"]
    assert kinds[-2:] == ["guard", "answer"]
    assert sent[-1]["event"] == "status" and sent[-1]["data"]["status"] == "done"


async def test_a_step_landing_between_subscribe_and_replay_is_sent_once(client, monkeypatch):
    await signup(client)
    use(monkeypatch, FakeProvider([gen(None, ToolCall("a1", "ask_user", {"question": "Who?"}))]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    await wait_for(client, run_id, "waiting_for_user")
    agency = (await client.get("/api/v1/agency")).json()["id"]
    real = events.read_steps
    landed: list[int] = []

    async def racing(db, run, after):
        if not landed:  # once subscribed, before the replay reads: a step is written and published
            async with get_sessionmaker()() as other:
                await bind_tenant(other, agency)
                writer = await events.StepWriter.open(other, get_shared_redis(), run, agency)
                step = await writer.emit("error", {"code": "test", "message": "Landed."})
                landed.append(step.seq)
                await service.cancel(other, get_shared_redis(), agency_id=agency, run_id=run)
        return await real(db, run, after)

    monkeypatch.setattr(events, "read_steps", racing)
    response = await client.get(f"{RUNS}/{run_id}/events")
    sent = parse_sse(response.text)
    seqs = [e["data"]["seq"] for e in sent if e["event"] == "step"]
    assert seqs.count(landed[0]) == 1
    assert seqs == sorted(set(seqs))
    assert sent[-1]["data"]["status"] == "cancelled"


async def test_the_stream_heartbeats_and_picks_up_steps_without_pubsub(monkeypatch, client):
    """Steps are in the database before they are published: a stream that misses a message
    (Redis away) still finds the step at its next heartbeat."""
    await signup(client)
    use(monkeypatch, FakeProvider([gen(None, ToolCall("a1", "ask_user", {"question": "Who?"}))]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    await wait_for(client, run_id, "waiting_for_user")
    agency = (await client.get("/api/v1/agency")).json()["id"]
    monkeypatch.setattr(events, "HEARTBEAT_S", 0.05)

    async def silent(redis, run, message):
        return None

    async def later():
        await asyncio.sleep(0.2)
        monkeypatch.setattr(events, "publish", silent)
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            await service.cancel(db, get_shared_redis(), agency_id=agency, run_id=run_id)

    task = asyncio.create_task(later())
    response = await asyncio.wait_for(client.get(f"{RUNS}/{run_id}/events"), 10)
    await task
    assert ": heartbeat" in response.text
    assert parse_sse(response.text)[-1]["data"]["status"] == "cancelled"


async def _waiting_run(client, monkeypatch) -> str:
    use(monkeypatch, FakeProvider([gen(None, ToolCall("a1", "ask_user", {"question": "Who?"}))]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    await wait_for(client, run_id, "waiting_for_user")
    return run_id


async def _until_subscribed(run_id: str, count: int = 1) -> None:
    for _ in range(500):
        if await _subscribers(run_id) >= count:
            return
        await asyncio.sleep(0.02)
    raise AssertionError("the stream never subscribed")


async def _cancel_via(client, run_id: str) -> None:
    assert (await client.post(f"{RUNS}/{run_id}/cancel")).status_code == 200


@pytest.mark.parametrize("cap", ["STREAMS_PER_USER", "STREAMS_PER_AGENCY"])
async def test_live_streams_are_capped_per_user_and_per_agency(client, monkeypatch, cap):
    await signup(client)
    run_id = await _waiting_run(client, monkeypatch)
    monkeypatch.setattr(events, "STREAMS_PER_USER", 5)
    monkeypatch.setattr(events, "STREAMS_PER_AGENCY", 5)
    monkeypatch.setattr(events, cap, 1)
    first = asyncio.create_task(client.get(f"{RUNS}/{run_id}/events"))
    await _until_subscribed(run_id)
    refused = await client.get(f"{RUNS}/{run_id}/events")
    assert refused.status_code == 429
    assert refused.json()["detail"] == events.TOO_MANY_STREAMS
    await _cancel_via(client, run_id)
    assert (await asyncio.wait_for(first, 10)).status_code == 200
    # The first stream's slots went back when it closed.
    again = await client.get(f"{RUNS}/{run_id}/events")
    assert again.status_code == 200


async def test_two_streams_on_one_run_share_one_subscription(client, monkeypatch):
    await signup(client)
    gate = asyncio.Event()

    async def held(messages):
        await gate.wait()
        return gen(None, ToolCall("l2", "lookup_airport", {"query": "Mumbai"}))

    use(
        monkeypatch,
        FakeProvider(
            [gen(None, ToolCall("l1", "lookup_airport", {"query": "Delhi"})), held, gen("Done.")]
        ),
    )
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    for _ in range(500):
        if len((await client.get(f"{RUNS}/{run_id}")).json()["steps"]) >= 2:
            break
        await asyncio.sleep(0.02)
    streams = [
        asyncio.create_task(client.get(f"{RUNS}/{run_id}/events", headers={"Last-Event-ID": "1"}))
        for _ in range(2)
    ]
    for _ in range(500):  # both streams listening (each sent its replay and status)
        if events.listeners(events.channel(run_id)) == 2:
            break
        await asyncio.sleep(0.02)
    assert events.listeners(events.channel(run_id)) == 2
    assert await _subscribers(run_id) == 1  # one Redis subscription for the process
    gate.set()
    sent = [parse_sse((await asyncio.wait_for(task, 15)).text) for task in streams]
    seqs = [[e["data"]["seq"] for e in one if e["event"] == "step"] for one in sent]
    assert seqs[0] == seqs[1] and seqs[0] == list(range(2, 2 + len(seqs[0])))
    assert all(one[-1]["data"]["status"] == "done" for one in sent)
    assert events.listeners(events.channel(run_id)) == 0
    assert await _subscribers(run_id) == 0  # unsubscribed once the last stream closed


async def test_a_revoked_session_closes_its_stream(client, monkeypatch):
    await signup(client)
    run_id = await _waiting_run(client, monkeypatch)
    monkeypatch.setattr(events, "HEARTBEAT_S", 0.05)
    stream = asyncio.create_task(client.get(f"{RUNS}/{run_id}/events"))
    await _until_subscribed(run_id)
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    response = await asyncio.wait_for(stream, 10)
    sent = parse_sse(response.text)
    assert [e["data"]["status"] for e in sent if e["event"] == "status"] == ["waiting_for_user"]
    assert await _subscribers(run_id) == 0


async def test_without_pubsub_the_stream_backs_off_its_database_reads(monkeypatch):
    """Redis down: the stream polls the database, 1 s growing to 5 s (with jitter)."""
    monkeypatch.setattr(events.random, "uniform", lambda low, high: 1.0)
    assert [events.poll_delay(n) for n in range(5)] == [1.0, 2.0, 4.0, 5.0, 5.0]
    monkeypatch.undo()
    for attempt in range(6):
        base = min(events.POLL_MAX_S, events.POLL_FIRST_S * 2**attempt)
        for _ in range(20):
            assert base * 0.8 <= events.poll_delay(attempt) <= base * 1.2  # jittered


# --- the worker and shutdown ----------------------------------------------------------------


def test_the_worker_runs_agent_jobs():
    from travelmind import worker

    agent = next(
        f for f in worker.WorkerSettings.functions if getattr(f, "name", None) == "run_agent_job"
    )
    assert agent.max_tries == 1
    assert agent.timeout_s >= get_settings().agent_run_timeout_s


async def test_the_worker_job_drives_the_run(client, monkeypatch):
    from travelmind import worker

    await signup(client)
    monkeypatch.setattr(get_settings(), "agent_inline", False)

    async def enqueue(name, *args, job_id=None):
        return "job"

    monkeypatch.setattr(service.jobs, "enqueue", enqueue)
    use(monkeypatch, FakeProvider([gen("Hello from the worker.")]))
    run_id = (await client.post(RUNS, json={"prompt": "Plan"})).json()["run_id"]
    agency = (await client.get("/api/v1/agency")).json()["id"]
    assert await worker.run_agent_job({}, run_id, agency) == "done"
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        kinds = (await db.execute(select(AgentStep.kind).order_by(AgentStep.seq))).scalars()
        assert list(kinds) == ["guard", "answer"]


async def test_shutdown_closes_the_model_clients(monkeypatch):
    from travelmind import main, worker
    from travelmind.agent import gemini

    closed: list[str] = []

    async def close():
        closed.append("closed")

    monkeypatch.setattr(gemini, "close_clients", close)
    async with main.lifespan(main.create_app()):
        pass
    await worker.shutdown({})
    assert closed == ["closed", "closed"]
