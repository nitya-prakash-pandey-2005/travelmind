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
connection) when it succeeds, rolled back when it fails.

`confirm` marks the write tools the engine must get the user's approval for before calling
`execute`; `ends_turn` marks ask_user, after which the run waits for the user.
"""

import json
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.agent.context import ROLES, RunContext
from travelmind.agent.provider import ToolCall, ToolResult, ToolSpec
from travelmind.agent.tools import places, planning, travel, weather, workspace
from travelmind.agent.tools.base import Tool, ToolError, TypedTool, clean_text
from travelmind.db import release_connection

__all__ = ["TOOLS", "Tool", "ToolError", "execute", "get_tool", "specs_for", "tools_for"]

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
        "Daily weather for a place or airport between two dates: the forecast within 16 days, "
        "typical conditions further out (labelled forecast or typical).",
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
    tool = get_tool(ctx.role, call.name)
    data: dict[str, Any]
    try:
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
    return ToolResult(call_id=call.id, name=call.name, data=data)
