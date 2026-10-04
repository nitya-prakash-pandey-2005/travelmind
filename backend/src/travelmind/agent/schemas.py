"""The agent API's request and response shapes.

Responses mirror the run and its steps. They never carry the run's working state (`state`: the
conversation and the supplier ids behind F1/H1/P1), the agency or user ids, or anything secret:
a step's stored `by_user_id` (who replied or decided, kept for the audit) is left out of its
payload. `pending` is the question or confirmation a waiting run needs answered; a question
carries `unverified` (true when values no tool returned were hidden from it, "…"), a
confirmation `warnings` (plain sentences, [] when none: notes with values no tool returned).
"""

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, StringConstraints

from travelmind.agent.fake import DEMO_PLANNER_MODEL
from travelmind.agent.models import AgentRun, AgentStep

MAX_TEXT_CHARS = 2000  # prompts and replies

UserText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TEXT_CHARS)
]


class CreateRunIn(BaseModel):
    prompt: UserText


class ReplyIn(BaseModel):
    text: UserText


class ConfirmIn(BaseModel):
    call_id: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    approve: bool


class CreatedRun(BaseModel):
    run_id: UUID
    status: str


class StepOut(BaseModel):
    seq: int
    kind: str
    payload: dict[str, Any]
    duration_ms: int | None
    created_at: datetime


class RunOut(BaseModel):
    id: UUID
    kind: str
    status: str
    prompt: str
    provider: str
    model: str
    demo: bool  # the rule-based demo planner, not a model ("Demo planner" in the app)
    prompt_version: str | None
    grounded: bool | None
    error: str | None
    result: dict[str, Any] | None
    pending: dict[str, Any] | None
    input_tokens: int
    output_tokens: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RunDetail(RunOut):
    steps: list[StepOut]


class RunList(BaseModel):
    items: list[RunOut]


class Availability(BaseModel):
    available: bool
    provider: str | None
    model: str | None
    demo: bool


def is_demo(provider: str | None, model: str | None) -> bool:
    return provider == "fake" and model == DEMO_PLANNER_MODEL


_QUESTION_FIELDS = ("kind", "call_id", "question", "fields")
_CONFIRM_FIELDS = ("kind", "call_id", "tool", "action", "args", "warnings")


def pending_of(run: AgentRun) -> dict[str, Any] | None:
    """What a waiting run needs from the user, without the turn's stored results."""
    if run.status != "waiting_for_user" or not run.state:
        return None
    pending = run.state.get("pending")
    if not isinstance(pending, dict) or run.state.get("inbox"):
        return None
    if pending.get("kind") == "question":
        shown = {key: pending.get(key) for key in _QUESTION_FIELDS}
        shown["unverified"] = bool(pending.get("unverified"))
        return shown
    shown = {key: pending.get(key) for key in _CONFIRM_FIELDS}
    shown["warnings"] = list(shown.get("warnings") or [])  # [] for runs paused before warnings
    return shown


_STORED_ONLY = frozenset({"by_user_id"})  # kept in the stored step, never sent


def step_out(step: AgentStep) -> StepOut:
    return StepOut(
        seq=step.seq,
        kind=step.kind,
        payload={k: v for k, v in step.payload.items() if k not in _STORED_ONLY},
        duration_ms=step.duration_ms,
        created_at=step.created_at,
    )


def run_out(run: AgentRun) -> RunOut:
    return RunOut(
        id=run.id,
        kind=run.kind,
        status=run.status,
        prompt=run.prompt,
        provider=run.provider,
        model=run.model,
        demo=is_demo(run.provider, run.model),
        prompt_version=run.prompt_version,
        grounded=run.grounded,
        error=run.error,
        result=run.result,
        pending=pending_of(run),
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


def run_detail(run: AgentRun, steps: list[AgentStep]) -> RunDetail:
    return RunDetail(**run_out(run).model_dump(), steps=[step_out(s) for s in steps])
