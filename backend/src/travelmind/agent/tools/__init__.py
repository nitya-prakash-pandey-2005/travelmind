"""The agent's tool registry, scoped by role, and `execute`, which runs one tool call.

Roles scope the tools: travellers get the travel, place, weather and planning tools; agencies
also get the workspace tools (find_client, create_enquiry, draft_quote). The server decides the
role (the run's kind) when it builds the RunContext.

`execute(ctx, call)` always returns a ToolResult whose `data` is JSON-safe: the tool's trimmed
output, or `{"error": {"code", "message"}}` (an unknown or out-of-role tool, bad arguments, a
service refusal, a feed that is down, or "This tool failed unexpectedly." for a bug, which is
logged). Providers send it back to the model as data (Gemini: a function_response part whose
response is `{"data": ...}`), never as instructions. A call runs only when the context's session
is bound to the context's agency. Each call is its own unit of work: committed (releasing the
connection) when it succeeds, rolled back when it fails. Cancellation (the run's timeout or a
user's cancel) rolls back too, shielded so the rollback itself can't be cut short, and then
propagates: it is the only thing `execute` raises. An unknown role is a `not_allowed` result.

What `data` carries for the grounding guard: `travelmind.agent.facts` collects the values a
result vouches for (prices, flight numbers, dates, codes, names) and skips the fields the model
wrote itself (`MODEL_AUTHORED_PATHS`: itinerary titles, notes and dates, ask_user's question)
and every error.

`for_model(message)` is what the model is sent of a message's results: the data less what it
needs no words for (the supplier's own total and the rates' date when nothing was converted,
provenance, attribution, sources that answered normally, empty fields). The run keeps the whole
result: the trace, the board's cards and the guard's facts read that, so every value the model
is sent is also a value the guard accepts.

`confirm` marks the write tools the engine must get the user's approval for before calling
`execute`; `ends_turn` marks ask_user, after which the run waits for the user.
"""

import asyncio
import json
from dataclasses import replace
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.agent.context import ROLES, RunContext
from travelmind.agent.provider import Message, ToolCall, ToolResult, ToolSpec
from travelmind.agent.tools import places, planning, travel, weather, workspace
from travelmind.agent.tools.base import Tool, ToolError, TypedTool, clean_text
from travelmind.db import release_connection

__all__ = [
    "TOOLS",
    "Tool",
    "ToolError",
    "execute",
    "for_model",
    "get_tool",
    "specs_for",
    "tools_for",
]

log = structlog.get_logger()

EVERYONE = frozenset(ROLES)
AGENCY = frozenset({"agency"})
FAILED = ToolError("failed", "This tool failed unexpectedly.")

TOOLS: tuple[Tool, ...] = (
    TypedTool(
        "lookup_airport",
        "Find airports by city, airport name or code. Returns up to 5 matches with IATA codes.",
        travel.LookupAirportArgs,
        travel.lookup_airport,
        roles=EVERYONE,
    ),
    TypedTool(
        "search_flights",
        "Search live flight offers between two airports (IATA codes) on given dates. Returns the "
        "6 cheapest with offer_id, flight numbers, times and prices.",
        travel.SearchFlightsArgs,
        travel.search_flights,
        roles=EVERYONE,
    ),
    TypedTool(
        "search_hotels",
        "Search hotel rates near a destination airport for check-in and check-out dates. "
        "Returns the 6 cheapest with hotel_id, stay total and price per night.",
        travel.SearchHotelsArgs,
        travel.search_hotels,
        roles=EVERYONE,
    ),
    TypedTool(
        "price_check",
        "Confirm an offer's current price with its supplier (offer_id from search_flights).",
        travel.PriceCheckArgs,
        travel.price_check,
        roles=EVERYONE,
    ),
    TypedTool(
        "fare_insight",
        "Typical per-traveller fares for a route and booking window, from fare history.",
        travel.FareInsightArgs,
        travel.fare_insight,
        roles=EVERYONE,
    ),
    TypedTool(
        "weather_forecast",
        "Daily weather for a place or airport between two dates: the forecast up to 14 days "
        "ahead, typical conditions further out (labelled forecast or typical).",
        weather.WeatherArgs,
        weather.weather_forecast,
        roles=EVERYONE,
    ),
    TypedTool(
        "find_places",
        "Places to visit near a destination (sights, museums, food, nature, shopping, "
        "nightlife, family), with place_id, kind, coordinates and distance.",
        places.FindPlacesArgs,
        places.find_places,
        roles=EVERYONE,
    ),
    TypedTool(
        "build_itinerary",
        "Arrange a day-by-day plan from ids earlier results returned (offer_id, hotel_id, "
        "place_id). Unknown ids are refused.",
        planning.ItineraryArgs,
        planning.build_itinerary,
        roles=EVERYONE,
    ),
    TypedTool(
        "estimate_budget",
        "Add up the prices of items earlier results returned (by id), per category and currency.",
        planning.BudgetArgs,
        planning.estimate_budget,
        roles=EVERYONE,
    ),
    TypedTool(
        "ask_user",
        "Ask the user one short question when something needed is missing, then wait.",
        planning.AskUserArgs,
        planning.ask_user,
        roles=EVERYONE,
        ends_turn=True,
    ),
    TypedTool(
        "find_client",
        "Find the agency's clients by name, email or company.",
        workspace.FindClientArgs,
        workspace.find_client,
        roles=AGENCY,
    ),
    TypedTool(
        "create_enquiry",
        "Create an enquiry (a trip request) in the agency's pipeline. Needs the user's "
        "confirmation.",
        workspace.CreateEnquiryArgs,
        workspace.create_enquiry_tool,
        roles=AGENCY,
        confirm=True,
    ),
    TypedTool(
        "draft_quote",
        "Draft a quote for an enquiry from up to 3 offer_ids, with a markup; priced by the "
        "server. Needs the user's confirmation.",
        workspace.DraftQuoteArgs,
        workspace.draft_quote,
        roles=AGENCY,
        confirm=True,
    ),
)


# What a result keeps only for the run (the trace, the board, the guard): never for wording.
_NOT_FOR_MODEL = frozenset(
    {
        "provenance",
        "attribution",
        "source",
        "fx_as_of",
        "supplier_total_minor",
        "supplier_total_formatted",
    }
)


def _trimmed(node: Any) -> Any:
    if isinstance(node, list):
        return [_trimmed(item) for item in node]
    if not isinstance(node, dict):
        return node
    converted = node.get("converted") is True
    kept: dict[str, Any] = {}
    for key, value in node.items():
        if value is None or key in _NOT_FOR_MODEL:
            continue
        if key in ("converted", "supplier_total_currency") and not converted:
            continue  # the same as the shown total: nothing to say
        if key == "sources" and isinstance(value, list):
            value = [s for s in value if not (isinstance(s, dict) and s.get("status") == "ok")]
            if not value:
                continue
        kept[key] = _trimmed(value)
    return kept


def for_model(message: Message) -> Message:
    """`message` as the model is sent it: each result's data trimmed (see the module
    docstring); an error is sent whole."""
    if not message.results:
        return message
    results = tuple(
        result if "error" in result.data else replace(result, data=_trimmed(result.data))
        for result in message.results
    )
    return replace(message, results=results)


def tools_for(role: str) -> list[Tool]:
    """The tools a role may use, in registry order. Raises ValueError for an unknown role."""
    if role not in ROLES:
        raise ValueError(f"Unknown agent role {role!r}.")
    return [tool for tool in TOOLS if role in tool.roles]


def specs_for(role: str) -> list[ToolSpec]:
    return [tool.spec for tool in tools_for(role)]


def get_tool(role: str, name: str) -> Tool | None:
    return next((tool for tool in tools_for(role) if tool.spec.name == name), None)


async def _rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception as exc:
        log.warning("agent_tool_rollback_failed", error_type=type(exc).__name__)


async def execute(ctx: RunContext, call: ToolCall) -> ToolResult:
    """Run one call under the run's agency and role; the result is always data."""
    tool: Tool | None = None
    data: dict[str, Any]
    try:
        if ctx.role not in ROLES:
            log.error("agent_tool_bad_role")  # a bug in the engine: roles come from the server
            raise ToolError("not_allowed", "This run can't use tools.")
        tool = get_tool(ctx.role, call.name)
        if tool is None:
            shown = clean_text(call.name, 60) or "that name"
            raise ToolError("unknown_tool", f"No tool called {shown} is available.")
        if ctx.bound_agency != ctx.agency_id:
            raise ToolError("not_allowed", "This run can only use its own agency's data.")
        output = await tool.run(ctx, dict(call.args))
        data = json.loads(json.dumps(output))  # JSON-safe, or a bug caught below
        await release_connection(ctx.db)
    except ToolError as exc:
        await _rollback(ctx.db)
        data = exc.as_data()
    except Exception:
        log.exception("agent_tool_failed", tool=tool.spec.name if tool else None)
        await _rollback(ctx.db)
        data = FAILED.as_data()
    except BaseException:  # cancelled (or the process is stopping): undo, then let it through
        await asyncio.shield(_rollback(ctx.db))
        raise
    return ToolResult(call_id=call.id, name=call.name, data=data)
