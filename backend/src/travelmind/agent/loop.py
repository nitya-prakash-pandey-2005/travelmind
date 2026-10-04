"""The bounded tool-calling loop.

Each model turn may return text and/or tool calls. Calls run one after another (at most
MAX_CALLS_PER_TURN; any more are answered "too_many_calls"), their results go back to the model
as data, and the loop repeats until the model answers without calls, the run waits for the user,
or a limit is hit. An identical repeated call (same tool and arguments) is answered from the
run's memo instead of running again.

Pauses (status waiting_for_user, the run's slot handed back by the service):
- ask_user: the question is stored as pending; the user's reply comes back as the call's result
  (`answer`) together with the reply as a user message. Calls planned after it in the same turn
  are not run ("skipped").
- a write tool (`confirm`): never runs before the user approves it, and never through
  `execute` outside an approval. Its arguments are checked first, and so are its targets (the
  client, the enquiry: looked up in the run's agency): a call that would fail is answered with
  its error at once, never put to the user. Otherwise the run stores what will happen ("Create
  an enquiry DEL → BOM, 3 Nov 2026, 2 adults, for client Priya Sharma, with notes: «...».",
  `describe_action`), with warnings when the notes carry values no tool returned (the guard's
  check), and stops. Approved, it runs once (the trace keeps the one tool_call written when it
  was asked, then its result), as the approver (the activity names them), unless the run was
  cancelled meanwhile; the turn's remaining calls follow. Declined, the model is told so. So a
  tool result that "asks" for a write (prompt injection) can at most produce a confirmation
  request.

Limits, each ending the run with a clear status:
- `agent_max_steps` model calls: failed, "The plan took too many steps."
- a model call over `agent_step_timeout_s`: an error step and one retry (after the cancel,
  step and budget checks again); a second: failed.
- `agent_run_timeout_s` of running time in all (time spent waiting for the user excluded):
  failed, "The plan took too long."
- the run's token cap, or the agency's monthly budget (checked before every model call; every
  call's tokens, a failed call's too, recorded at once): budget_exceeded.
- cancelled by the user (or failed by the stuck-run sweeper): checked before every model call,
  every tool call and every step written, so a cancelled run writes nothing more.

The answer goes through the grounding guard (`agent.grounding`): an answer with values that are
not in the results is re-prompted once, then replaced by the plan's own summary (grounded=false).
What is checked: the prose, the plan block's summary and next steps, and the itinerary the board
would show (its days' titles, notes and dates are the model's words: `plan.itinerary_text`); on
a fallback the itinerary keeps only its dates and items. Interim text with unverified values is
not shown in the trace.
"""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal
from uuid import UUID

import structlog
from sqlalchemy import select

from travelmind.agent import budget
from travelmind.agent.context import RunContext
from travelmind.agent.facts import GroundFacts, facts_of
from travelmind.agent.grounding import Violation, find_violations, reprompt_text, stated_facts
from travelmind.agent.models import AgentRun
from travelmind.agent.plan import build_result, fallback_summary, itinerary_text, split_answer
from travelmind.agent.prompts import system_prompt
from travelmind.agent.provider import (
    Generation,
    LLMProvider,
    Message,
    ProviderError,
    ToolCall,
    ToolResult,
)
from travelmind.agent.state import (
    RunState,
    call_from_json,
    call_to_json,
    result_from_json,
    result_to_json,
)
from travelmind.agent.tools import execute, get_tool, specs_for
from travelmind.agent.tools.base import ToolError, clean_text, display_date, format_money
from travelmind.agent.tools.travel import check_codes
from travelmind.db import release_connection
from travelmind.metrics import AGENT_TOKENS
from travelmind.offers.money import Money
from travelmind.reference.service import get_airport_index
from travelmind.workspace.counters import format_number
from travelmind.workspace.enquiries import CLIENT_NOT_FOUND_MESSAGE
from travelmind.workspace.enquiries import NOT_FOUND_MESSAGE as ENQUIRY_NOT_FOUND
from travelmind.workspace.models import Client, Enquiry

log = structlog.get_logger()

Status = Literal["done", "failed", "budget_exceeded", "waiting_for_user", "cancelled"]
Emit = Callable[..., Awaitable[Any]]  # emit(kind, payload, duration_ms=None)

MAX_CALLS_PER_TURN = 4
TOO_MANY_CALLS = ToolError(
    "too_many_calls", f"Only {MAX_CALLS_PER_TURN} tool calls run per turn. Call it again."
)
SKIPPED = ToolError("skipped", "Not run: the run stopped to ask the user first.")
DECLINED = {"status": "declined", "message": "The user declined this action. Nothing was changed."}
NOT_APPROVED = ToolError("not_allowed", "This action needs the user's confirmation.")
NOTES_SHOWN = 120  # characters of an enquiry's notes the confirmation quotes

TOO_MANY_STEPS = "The plan took too many steps."
TOO_LONG = "The plan took too long."
MODEL_TOO_SLOW = "The planning model took too long to answer."
RETRYING = "The planning model took too long; trying again."
TOKEN_CAP = "This plan reached its token limit."
MONTHLY_BUDGET = "This month's agent budget is used up."

LABELS = {
    "lookup_airport": "Looking up airports",
    "search_flights": "Searching flights",
    "search_hotels": "Searching hotels",
    "price_check": "Checking the price",
    "fare_insight": "Checking fare history",
    "weather_forecast": "Checking the weather",
    "find_places": "Finding places",
    "build_itinerary": "Building the itinerary",
    "estimate_budget": "Adding up the budget",
    "find_client": "Finding clients",
    "create_enquiry": "Creating an enquiry",
    "draft_quote": "Drafting a quote",
}
CABINS = {"premium_economy": "premium economy", "business": "business", "first": "first"}


@dataclass
class LoopOutcome:
    status: Status
    error: str | None = None
    result: dict[str, Any] | None = None
    grounded: bool | None = None


class _Stop(Exception):
    def __init__(self, outcome: LoopOutcome) -> None:
        super().__init__(outcome.status)
        self.outcome = outcome


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _text(value: object, limit: int = 60) -> str | None:
    return clean_text(value, limit) if isinstance(value, str) else None


def call_label(call: ToolCall) -> str:
    """The step's plain words: "Searching flights DEL → DXB"."""
    args = call.args
    base = LABELS.get(call.name, _text(call.name) or "Running a tool")
    origin, destination = _text(args.get("origin"), 10), _text(args.get("destination"), 60)
    if origin and destination:
        return f"{base} {origin} → {destination}"
    where = destination or _text(args.get("place_or_airport")) or _text(args.get("query"))
    if call.name == "price_check" and _text(args.get("offer_id"), 10):
        return f"{base} of {_text(args.get('offer_id'), 10)}"
    if where and call.name in ("search_hotels", "weather_forecast", "find_places"):
        return f"{base} in {where}"
    if where and call.name in ("lookup_airport", "find_client"):
        return f"{base} for “{where}”"
    return base


def result_summary(name: str, data: dict[str, Any]) -> str:
    """A one-line result for the trace."""
    error = data.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or "The tool failed.")
    if data.get("status") == "declined":
        return "Declined."
    counts = {
        "lookup_airport": ("matches", "airport", "airports"),
        "search_flights": ("offers", "flight offer", "flight offers"),
        "search_hotels": ("hotels", "hotel", "hotels"),
        "find_places": ("places", "place", "places"),
        "find_client": ("clients", "client", "clients"),
        "weather_forecast": ("days", "day", "days"),
        "build_itinerary": ("days", "day", "days"),
    }
    if name in counts:
        key, one, many = counts[name]
        n = len(data.get(key) or [])
        return f"{n} {one if n == 1 else many}"
    if name == "estimate_budget" and data.get("total_formatted"):
        return f"Total {data['total_formatted']}"
    if name == "price_check":
        return "Price changed" if data.get("price_changed") else "Price confirmed"
    if name in ("create_enquiry", "draft_quote") and data.get("number"):
        return f"Created {data['number']}"
    return "Done"


def _travellers(adults: int, children: Sequence[int]) -> str:
    text = f"{adults} adult{'s' if adults != 1 else ''}"
    if children:
        text += f" and {len(children)} {'child' if len(children) == 1 else 'children'}"
    return text


async def _client_name(ctx: RunContext, client_id: UUID) -> str:
    """The client's name, looked up in the run's agency; another agency's is not found."""
    name = await ctx.db.scalar(
        select(Client.name).where(Client.id == client_id, Client.agency_id == ctx.agency_id)
    )
    await release_connection(ctx.db)
    if name is None:
        raise ToolError("not_found", CLIENT_NOT_FOUND_MESSAGE)
    return clean_text(name, 80) or "(unnamed)"


async def _enquiry_number(ctx: RunContext, enquiry_id: UUID) -> str:
    number = await ctx.db.scalar(
        select(Enquiry.number).where(Enquiry.id == enquiry_id, Enquiry.agency_id == ctx.agency_id)
    )
    await release_connection(ctx.db)
    if number is None:
        raise ToolError("not_found", ENQUIRY_NOT_FOUND)
    return format_number("enquiry", number)


async def describe_action(ctx: RunContext, name: str, parsed: Any) -> str:
    """What a confirmed write will do, in plain words, from its validated arguments: the trip,
    whose it is (the client by name) and its notes (the first NOTES_SHOWN characters), or the
    quote's enquiry by number. A target the agency doesn't have raises ToolError (not_found),
    and so does a code that reads as another airport ("GOA" not looked up)."""
    if name == "create_enquiry":
        await check_codes(ctx, parsed.origin, parsed.destination)
        text = "Create an enquiry"
        if parsed.origin and parsed.destination:
            text += f" {parsed.origin} → {parsed.destination}"
        elif parsed.destination:
            text += f" to {parsed.destination}"
        if parsed.depart_date:
            text += f", {display_date(parsed.depart_date)}"
            if parsed.return_date:
                text += f" to {display_date(parsed.return_date)}"
        text += f", {_travellers(parsed.adults, parsed.children_ages)}"
        if parsed.cabin in CABINS:
            text += f", {CABINS[parsed.cabin]}"
        if parsed.budget_minor and parsed.budget_currency:
            money = Money(amount_minor=parsed.budget_minor, currency=parsed.budget_currency)
            text += f", budget {format_money(money)}"
        if parsed.client_id is not None:
            text += f", for client {await _client_name(ctx, parsed.client_id)}"
        else:
            text += ", no client"
        notes = clean_text(parsed.notes, NOTES_SHOWN)
        if notes:
            text += f", with notes: «{notes}»"
        return text + "."
    if name == "draft_quote":
        enquiry = await _enquiry_number(ctx, parsed.enquiry_id)
        options = []
        for ref in parsed.offer_ids:
            item = ctx.memory.get(ref)
            if item is None:
                options.append(_text(ref, 10) or "?")
                continue
            price = (
                f", {item.card.get('total_formatted')}" if item.card.get("total_formatted") else ""
            )
            options.append(f"{item.ref} ({item.label}{price})")
        if parsed.markup_kind == "percent":
            markup = f"a {parsed.markup_value / 100:g}% markup"
        else:
            money = Money(amount_minor=parsed.markup_value, currency=ctx.currency)
            markup = f"a {format_money(money)} markup per option"
        return f"Draft a quote on {enquiry} with {', '.join(options)} at {markup}."
    return f"Run {_text(name) or 'a tool'}."


class _Loop:
    def __init__(
        self,
        ctx: RunContext,
        provider: LLMProvider,
        run: AgentRun,
        state: RunState,
        emit: Emit,
    ) -> None:
        self.ctx = ctx
        self.provider = provider
        self.run = run
        self.run_id = run.id  # kept: a rollback (a timeout mid-call) expires the run's attributes
        self.state = state
        self.emit = emit
        self.settings = ctx.settings
        self.specs = specs_for(ctx.role)
        self.system = system_prompt(
            role=ctx.role,
            today=ctx.today(),
            currency=ctx.currency,
            timezone=ctx.timezone,
            tools=self.specs,
        )

    # --- the segment ----------------------------------------------------------------------

    async def go(self) -> LoopOutcome:
        started = time.monotonic()
        remaining = self.settings.agent_run_timeout_s - self.state.elapsed_s
        try:
            if remaining <= 0:
                raise TimeoutError
            async with asyncio.timeout(remaining):
                return await self._segment()
        except _Stop as stop:
            return stop.outcome
        except TimeoutError:
            await self._rollback()
            try:
                await self._emit("error", {"code": "run_timeout", "message": TOO_LONG})
            except _Stop as stop:
                return stop.outcome
            return LoopOutcome("failed", error=TOO_LONG)
        finally:
            self.state.elapsed_s += time.monotonic() - started

    async def _rollback(self) -> None:
        try:
            await self.ctx.db.rollback()
        except Exception as exc:
            log.warning("agent_rollback_failed", error_type=type(exc).__name__)

    async def _segment(self) -> LoopOutcome:
        if self.state.pending is not None:
            paused = await self._resume()
            if paused is not None:
                return paused
        while True:
            outcome = await self._turn()
            if outcome is not None:
                return outcome

    async def _stop(self, status: Status, message: str, code: str) -> None:
        await self._emit("error", {"code": code, "message": message})
        raise _Stop(LoopOutcome(status, error=message))

    async def _check_cancelled(self) -> None:
        """Stop when the run is no longer running: cancelled by the user (or failed by the
        stuck-run sweeper). The job's final move then finds it moved and leaves it be."""
        status = await self.ctx.db.scalar(select(AgentRun.status).where(AgentRun.id == self.run_id))
        await release_connection(self.ctx.db)
        if status != "running":
            raise _Stop(LoopOutcome("cancelled"))

    async def _emit(self, kind: str, payload: dict[str, Any], took: int | None = None) -> None:
        """Write a step, unless the run was cancelled: then stop instead."""
        await self._check_cancelled()
        await self.emit(kind, payload, took)

    # --- model turns ----------------------------------------------------------------------

    async def _turn(self) -> LoopOutcome | None:
        await self._check_cancelled()
        await self._check_limits()
        generation, took = await self._generate()
        if generation.calls:
            if generation.text:
                await self._thinking(generation.text, took)
            self.state.messages.append(
                Message(
                    role="model",
                    text=generation.text,
                    calls=generation.calls,
                    text_signature=generation.text_signature,
                )
            )
            calls = list(generation.calls)
            tail = [
                ToolResult(c.id, c.name, TOO_MANY_CALLS.as_data())
                for c in calls[MAX_CALLS_PER_TURN:]
            ]
            return await self._run_calls(calls[:MAX_CALLS_PER_TURN], [], tail)
        return await self._answer(generation, took)

    async def _check_limits(self) -> None:
        if self.state.turns >= self.settings.agent_max_steps:
            await self._stop("failed", TOO_MANY_STEPS, "max_steps")
        if self.run.input_tokens + self.run.output_tokens >= self.settings.agent_run_token_cap:
            await self._stop("budget_exceeded", TOKEN_CAP, "token_cap")
        try:
            await budget.assert_within_budget(
                self.ctx.db,
                self.ctx.agency_id,
                self.ctx.now(),
                budget=self.settings.agent_monthly_token_budget,
            )
        except budget.BudgetExceeded:
            await release_connection(self.ctx.db)
            await self._stop("budget_exceeded", MONTHLY_BUDGET, "monthly_budget")
        await release_connection(self.ctx.db)

    async def _generate(self) -> tuple[Generation, int]:
        timeouts = 0
        while True:
            self.state.turns += 1
            started = time.monotonic()
            try:
                async with asyncio.timeout(self.settings.agent_step_timeout_s):
                    generation = await self.provider.generate(
                        system=self.system,
                        messages=list(self.state.messages),
                        tools=self.specs,
                        timeout_s=self.settings.agent_step_timeout_s,
                    )
            except TimeoutError:
                pass
            except ProviderError as exc:
                await self._tokens(exc.input_tokens, exc.output_tokens)
                if exc.kind != "timeout":
                    await self._stop("failed", exc.message, exc.kind)
            else:
                await self._tokens(generation.input_tokens, generation.output_tokens)
                return generation, _ms(started)
            timeouts += 1
            if timeouts >= 2:
                await self._stop("failed", MODEL_TOO_SLOW, "timeout")
            await self._emit("error", {"code": "timeout", "message": RETRYING}, _ms(started))
            await self._check_limits()  # steps, the run's tokens and the month's budget again

    async def _tokens(self, input_tokens: int, output_tokens: int) -> None:
        input_tokens, output_tokens = max(0, input_tokens), max(0, output_tokens)
        if not (input_tokens or output_tokens):
            return
        self.run.input_tokens += input_tokens
        self.run.output_tokens += output_tokens
        await budget.record(
            self.ctx.db, self.ctx.agency_id, self.ctx.now(), input_tokens, output_tokens
        )
        await self.ctx.db.commit()
        AGENT_TOKENS.labels(direction="input").inc(input_tokens)
        AGENT_TOKENS.labels(direction="output").inc(output_tokens)

    # --- the guard ------------------------------------------------------------------------

    async def _violations(self, text: str, *, within_trip: bool = False) -> list[Violation]:
        if not text.strip():
            return []
        index = await get_airport_index(self.ctx.db)
        await release_connection(self.ctx.db)
        today = self.ctx.today()
        user = stated_facts(self.state.user_texts, today=today, currency=self.ctx.currency)
        user = user | GroundFacts(dates=frozenset({today}))
        return find_violations(
            text,
            facts_of(self.state.results()),
            user,
            is_airport=lambda code: index.get(code) is not None,
            within_trip=within_trip,
        )

    async def _thinking(self, text: str, took: int) -> None:
        unverified = bool(await self._violations(text))
        payload = {"text": None if unverified else text, "unverified": unverified}
        await self._emit("thinking", payload, took)

    async def _answer(self, generation: Generation, took: int) -> LoopOutcome | None:
        text = (generation.text or "").strip()
        prose, plan = split_answer(text)
        checked = "\n".join(
            [prose, (plan.summary or "") if plan else "", *(plan.next_steps if plan else [])]
        )
        summary = prose or ((plan.summary or "") if plan else "")
        memory, results = self.ctx.memory, self.state.results()
        draft = build_result(memory, results, plan, summary=summary, fallback=False)
        violations: list[Violation] = []
        if text:  # the prose, and the itinerary the board would show (the model's words too)
            violations = await self._violations(checked)
            violations += await self._violations(itinerary_text(draft.itinerary), within_trip=True)
        said = Message(role="model", text=generation.text, text_signature=generation.text_signature)
        if violations and not self.state.reprompted:
            await self._emit(
                "guard",
                {
                    "passed": False,
                    "action": "reprompt",
                    "violations": [v.to_json() for v in violations],
                },
            )
            self.state.messages += [said, Message(role="user", text=reprompt_text(violations))]
            self.state.reprompted = True
            return None
        fallback = bool(violations) or not text
        await self._emit(
            "guard",
            {
                "passed": not fallback,
                "action": "fallback" if fallback else "passed",
                "violations": [v.to_json() for v in violations],
            },
        )
        result = draft
        if fallback:
            result = build_result(memory, results, plan, summary=summary, fallback=True)
            result.summary = fallback_summary(result)
        self.state.messages.append(said)
        await self._emit(
            "answer",
            {"text": result.summary, "grounded": not fallback, "fallback": fallback},
            took,
        )
        return LoopOutcome("done", result=result.model_dump(mode="json"), grounded=not fallback)

    # --- tool calls -----------------------------------------------------------------------

    async def _run_calls(
        self, queue: list[ToolCall], done: list[ToolResult], tail: list[ToolResult]
    ) -> LoopOutcome | None:
        """Run the turn's calls in order; pause on a question or a write to confirm."""
        while queue:
            call = queue.pop(0)
            await self._check_cancelled()
            tool = get_tool(self.ctx.role, call.name)
            if tool is not None and (tool.confirm or tool.ends_turn):
                try:
                    parsed = tool.parse(dict(call.args))
                    action = (
                        await describe_action(self.ctx, call.name, parsed) if tool.confirm else ""
                    )
                except ToolError as exc:  # answered with its error, never put to the user
                    done.append(await self._refused(call, exc))
                    continue
                if tool.confirm:
                    warnings = await self._warnings(parsed)
                    return await self._ask_confirmation(call, action, warnings, queue, done, tail)
                paused = await self._ask_question(call, queue, done, tail)
                if paused is not None:
                    return paused
                continue
            done.append(await self._call(call))
        self.state.messages.append(Message(role="tool", results=tuple(done + tail)))
        return None

    def _pending(
        self,
        kind: str,
        call: ToolCall,
        queue: list[ToolCall],
        done: list[ToolResult],
        tail: list[ToolResult],
        **shown: Any,
    ) -> dict[str, Any]:
        return {
            "kind": kind,
            "call_id": call.id,
            **shown,
            "call": call_to_json(call),
            "done": [result_to_json(r) for r in done],
            "rest": [call_to_json(c) for c in queue],
            "tail": [result_to_json(r) for r in tail],
        }

    async def _refused(self, call: ToolCall, error: ToolError) -> ToolResult:
        """Answer a call that can't run (bad arguments, a target the agency doesn't have) with
        its error, without running anything: its two trace steps, then the result."""
        await self._emit(
            "tool_call",
            {"call_id": call.id, "tool": call.name, "args": call.args, "label": call_label(call)},
        )
        data = error.as_data()
        await self._result_step(call, data, took=0)
        return ToolResult(call_id=call.id, name=call.name, data=data)

    async def _warnings(self, parsed: Any) -> list[str]:
        """What the user should know before approving: notes with values no tool returned."""
        notes = getattr(parsed, "notes", None)
        if not isinstance(notes, str):
            return []
        violations = await self._violations(notes)
        if not violations:
            return []
        listed = ", ".join(dict.fromkeys(v.text for v in violations))
        return [f"The notes mention values no search returned: {listed}. Check them first."]

    async def _ask_confirmation(
        self,
        call: ToolCall,
        action: str,
        warnings: list[str],
        queue: list[ToolCall],
        done: list[ToolResult],
        tail: list[ToolResult],
    ) -> LoopOutcome:
        await self._emit(
            "tool_call",
            {"call_id": call.id, "tool": call.name, "args": call.args, "label": call_label(call)},
        )
        shown = {"tool": call.name, "action": action, "args": call.args, "warnings": warnings}
        self.state.pending = self._pending("confirm", call, queue, done, tail, **shown)
        await self._emit("ask_user", {"kind": "confirm", "call_id": call.id, **shown})
        return LoopOutcome("waiting_for_user")

    async def _ask_question(
        self,
        call: ToolCall,
        queue: list[ToolCall],
        done: list[ToolResult],
        tail: list[ToolResult],
    ) -> LoopOutcome | None:
        result = await execute(self.ctx, call)
        data = result.data
        if "error" in data:  # a question that didn't validate: the model sees why
            done.append(result)
            return None
        shown = {"question": data["question"], "fields": data.get("fields") or []}
        self.state.pending = self._pending("question", call, queue, done, tail, **shown)
        await self._emit("ask_user", {"kind": "question", "call_id": call.id, **shown})
        return LoopOutcome("waiting_for_user")

    async def _call(self, call: ToolCall) -> ToolResult:
        """Run one call (or answer it from the memo), with its two trace steps. Never a write
        tool: those run only through `_approved`."""
        await self._emit(
            "tool_call",
            {"call_id": call.id, "tool": call.name, "args": call.args, "label": call_label(call)},
        )
        tool = get_tool(self.ctx.role, call.name)
        if tool is not None and tool.confirm:  # a bug if reached: writes need an approval
            log.error("agent_write_without_approval", tool=call.name)
            data = NOT_APPROVED.as_data()
            await self._result_step(call, data, took=0)
            return ToolResult(call_id=call.id, name=call.name, data=data)
        # Questions are never repeated from memory.
        cacheable = tool is None or not tool.ends_turn
        key = json.dumps([call.name, call.args], sort_keys=True, default=str)
        started = time.monotonic()
        memo = cacheable and key in self.state.memo
        if memo:
            data = self.state.memo[key]
        else:
            data = (await execute(self.ctx, call)).data
            if cacheable and "error" not in data:
                self.state.memo[key] = data
        await self._result_step(call, data, memo=memo, took=_ms(started))
        return ToolResult(call_id=call.id, name=call.name, data=data)

    async def _approved(self, call: ToolCall, approver: object) -> ToolResult:
        """Run the write the user approved, once, as the approver: its result step only (its
        tool_call step was written when the user was asked). Never after a cancel."""
        await self._check_cancelled()
        ctx = self.ctx
        try:
            ctx = replace(ctx, user_id=UUID(str(approver))) if approver else ctx
        except ValueError:
            pass
        started = time.monotonic()
        data = (await execute(ctx, call)).data
        # Written whatever happens next: the write is done, the trace must say so.
        await self._result_step(call, data, took=_ms(started), checked=False)
        return ToolResult(call_id=call.id, name=call.name, data=data)

    async def _result_step(
        self,
        call: ToolCall,
        data: dict[str, Any],
        *,
        memo: bool = False,
        took: int | None = None,
        checked: bool = True,
    ) -> None:
        emit = self._emit if checked else self.emit
        await emit(
            "tool_result",
            {
                "call_id": call.id,
                "tool": call.name,
                "ok": "error" not in data and data.get("status") != "declined",
                "summary": result_summary(call.name, data),
                "data": data,
                "memo": memo,
            },
            took,
        )

    # --- resuming after the user ----------------------------------------------------------

    async def _resume(self) -> LoopOutcome | None:
        pending, inbox = self.state.pending or {}, self.state.inbox
        if not inbox:
            return LoopOutcome("waiting_for_user")  # nothing to resume with yet
        self.state.pending = self.state.inbox = None
        call = call_from_json(pending["call"])
        done = [result_from_json(r) for r in pending.get("done") or []]
        queue = [call_from_json(c) for c in pending.get("rest") or []]
        tail = [result_from_json(r) for r in pending.get("tail") or []]
        if pending["kind"] == "question":
            answer = str(inbox.get("text") or "")
            asked = {"question": pending.get("question"), "fields": pending.get("fields") or []}
            done.append(ToolResult(call.id, call.name, asked | {"answer": answer}))
            done += [ToolResult(c.id, c.name, SKIPPED.as_data()) for c in queue]
            self.state.messages.append(
                Message(role="user", text=answer, results=tuple(done + tail))
            )
            self.state.user_texts.append(answer)
            return None
        if inbox.get("approve"):
            done.append(await self._approved(call, inbox.get("by_user_id")))
        else:
            await self._result_step(call, DECLINED)
            done.append(ToolResult(call.id, call.name, dict(DECLINED)))
        return await self._run_calls(queue, done, tail)


async def run_loop(
    ctx: RunContext, provider: LLMProvider, run: AgentRun, state: RunState, emit: Emit
) -> LoopOutcome:
    """Run (or resume) the run until it answers, waits for the user, or stops (see the module
    docstring). `state` is updated in place; the caller stores it with the outcome."""
    return await _Loop(ctx, provider, run, state, emit).go()
