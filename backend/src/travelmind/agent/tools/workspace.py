"""Agency-only tools over the workspace: find_client, create_enquiry and draft_quote.

They call the workspace services under the run's agency (RLS), exactly as the app's screens do.
The two write tools have `confirm=True`: the engine asks the user before running them; called,
they just execute, commit, and bump the agency's read cache so the app shows the change.

draft_quote takes offer ids from this run's flight searches (F1, ...), and the quote is priced
by the server from the offers the agency was shown (the per-agency offer cache), as when an
agent builds a quote by hand: the model never supplies a price. Before calling the service it
checks what the run memory knows, so the refusal names the short ids: every offer must be
billed in the quote's currency (the agency's) and not have expired. A refusal from the service
itself is passed on with any supplier offer id in it replaced by its short id (supplier ids
never reach the model).

Another agency's records are `not_found`: an enquiry (RLS hides it) and a client_id given to
create_enquiry alike.
"""

from datetime import UTC, date
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field

from travelmind.agent.context import RunContext, SeenItem
from travelmind.agent.tools.base import (
    Args,
    ToolError,
    clean_text,
    date_fields,
    format_money,
    validate,
)
from travelmind.agent.tools.travel import ChildAge, check_codes, seen, unknown_ids
from travelmind.offers.models import MAX_PASSENGERS, Cabin, IataCode
from travelmind.offers.money import CurrencyCode, Money
from travelmind.readcache import invalidate_agency
from travelmind.workspace._common import WorkspaceError
from travelmind.workspace.clients import list_clients
from travelmind.workspace.counters import format_number
from travelmind.workspace.enquiries import (
    CLIENT_NOT_FOUND_MESSAGE,
    EnquiryCreate,
    create_enquiry,
)
from travelmind.workspace.quotes import (
    MAX_FIXED_MINOR,
    MAX_OPTIONS,
    QuoteCreate,
    QuoteVersionCreate,
    add_version,
    create_quote,
    load_quote,
)

MAX_CLIENTS = 5
QUOTE_REFUSED = "The quote couldn't be drafted from {refs}. Search again and choose other offers."
ENQUIRY_SOURCE = "copilot"  # the enquiry source the schema has for assisted entry
_CODES = {404: "not_found", 409: "conflict"}


def workspace_error(exc: WorkspaceError) -> ToolError:
    if exc.message == CLIENT_NOT_FOUND_MESSAGE:  # another agency's client is just not found
        return ToolError("not_found", exc.message)
    return ToolError(_CODES.get(exc.status_code, "invalid_arguments"), exc.message)


async def _committed(ctx: RunContext) -> None:
    await ctx.db.commit()
    await invalidate_agency(ctx.redis, ctx.agency_id)


# --- find_client -------------------------------------------------------------------------


class FindClientArgs(Args):
    query: str = Field(min_length=1, max_length=100, description="Name, email or company.")


async def find_client(ctx: RunContext, args: FindClientArgs) -> dict[str, Any]:
    found = await list_clients(ctx.db, agency_id=ctx.agency_id, q=args.query, limit=MAX_CLIENTS)
    return {
        "clients": [
            {
                "client_id": str(c.id),
                "name": clean_text(c.name, 80),
                "kind": c.kind,
                "company_name": clean_text(c.company_name, 80),
                "email": clean_text(c.email, 120),
                "home_airport": c.home_airport,
                "enquiry_count": c.enquiry_count,
                "quote_count": c.quote_count,
            }
            for c in found.items
        ],
        "total": found.total,
    }


# --- create_enquiry ----------------------------------------------------------------------


class CreateEnquiryArgs(Args):
    client_id: UUID | None = Field(None, description="A client_id from find_client.")
    origin: IataCode | None = None
    destination: IataCode | None = None
    depart_date: date | None = Field(None, description="YYYY-MM-DD.")
    return_date: date | None = Field(None, description="YYYY-MM-DD.")
    adults: int = Field(1, ge=1, le=MAX_PASSENGERS)
    children_ages: list[ChildAge] = Field(default_factory=list, max_length=8)
    cabin: Cabin = "economy"
    budget_minor: int | None = Field(None, gt=0, description="Budget in minor units.")
    budget_currency: CurrencyCode | None = None
    notes: str | None = Field(None, max_length=2000)


async def create_enquiry_tool(ctx: RunContext, args: CreateEnquiryArgs) -> dict[str, Any]:
    await check_codes(ctx, args.origin, args.destination)  # "GOA" only for a looked-up Genoa
    data = validate(EnquiryCreate, args.model_dump() | {"source": ENQUIRY_SOURCE})
    try:
        enquiry = await create_enquiry(ctx.db, ctx.agency_id, ctx.user_id, data)
    except WorkspaceError as exc:
        raise workspace_error(exc) from None
    result = {
        "enquiry_id": str(enquiry.id),
        "number": format_number("enquiry", enquiry.number),
        "status": enquiry.status,
        "client_id": str(enquiry.client_id) if enquiry.client_id else None,
        "trip": {
            "origin": enquiry.origin,
            "destination": enquiry.destination,
            **date_fields("depart_date", enquiry.depart_date),
            **date_fields("return_date", enquiry.return_date),
            "adults": enquiry.adults,
            "children_ages": list(enquiry.children_ages or []),
            "cabin": enquiry.cabin,
        },
    }
    await _committed(ctx)
    return result


# --- draft_quote -------------------------------------------------------------------------

OfferRef = Annotated[str, Field(min_length=1, max_length=1000)]


class DraftQuoteArgs(Args):
    enquiry_id: UUID = Field(description="The enquiry_id from create_enquiry.")
    offer_ids: list[OfferRef] = Field(
        min_length=1, max_length=MAX_OPTIONS, description="Up to 3 offer_ids, such as F1."
    )
    markup_kind: Literal["percent", "fixed"] = "percent"
    markup_value: int = Field(
        0,
        ge=0,
        le=MAX_FIXED_MINOR,
        description="percent: basis points (1000 = 10%); fixed: minor units per option.",
    )


def _listed(refs: list[str]) -> str:
    return refs[0] if len(refs) == 1 else ", ".join(refs[:-1]) + f" and {refs[-1]}"


def check_quotable(ctx: RunContext, items: list[SeenItem], currency: str) -> None:
    """Refuse, naming the short ids, offers billed in another currency than the quote's or
    past their expiry: what the quote service would refuse with the supplier's offer ids."""
    for billed in sorted({i.supplier_price.currency for i in items if i.supplier_price}):
        if billed == currency:
            continue
        refs = [i.ref for i in items if i.supplier_price and i.supplier_price.currency == billed]
        hint = ", or search a route from India" if currency == "INR" else ""
        raise ToolError(
            "invalid_arguments",
            f"{_listed(refs)} {'is' if len(refs) == 1 else 'are'} priced in {billed} and can't"
            f" be added to a quote in {currency}. Choose offers in {currency}{hint}.",
        )
    now = ctx.now()
    expired = [
        i.ref
        for i in items
        if i.expires_at is not None
        and (i.expires_at if i.expires_at.tzinfo else i.expires_at.replace(tzinfo=UTC)) <= now
    ]
    if expired:
        raise ToolError(
            "invalid_arguments",
            f"{_listed(expired)} {'has' if len(expired) == 1 else 'have'} expired."
            " Search again for current offers.",
        )


def scrubbed(exc: WorkspaceError, items: list[SeenItem]) -> ToolError:
    """The service's refusal with each supplier offer id replaced by its short id; if one
    still showed (it shouldn't), our own message instead."""
    error = workspace_error(exc)
    message = error.message
    for item in sorted(items, key=lambda i: len(i.source_id), reverse=True):
        message = message.replace(item.source_id, item.ref)
    if any(item.source_id in message for item in items):
        message = QUOTE_REFUSED.format(refs=_listed([i.ref for i in items]))
    return ToolError(error.code, message)


async def draft_quote(ctx: RunContext, args: DraftQuoteArgs) -> dict[str, Any]:
    refs = [ref.strip().upper() for ref in args.offer_ids]
    missing = [r for r in refs if (i := ctx.memory.get(r)) is None or i.kind != "flight"]
    if missing:
        raise unknown_ids(missing)
    if len(set(refs)) != len(refs):
        raise ToolError("invalid_arguments", "offer_ids: give each offer once.")
    items = [seen(ctx, ref, "flight") for ref in refs]
    check_quotable(ctx, items, ctx.currency)  # the quote takes the agency's currency
    try:
        quote = await create_quote(
            ctx.db,
            ctx.agency_id,
            ctx.user_id,
            validate(
                QuoteCreate,
                {
                    "enquiry_id": args.enquiry_id,
                    "markup_kind": args.markup_kind,
                    "markup_value": args.markup_value,
                },
            ),
        )
        locked = await load_quote(ctx.db, quote.id, for_update=True)
        version = await add_version(
            ctx.db,
            ctx.redis,
            locked,
            QuoteVersionCreate(offer_ids=[item.source_id for item in items]),
            ctx.user_id,
        )
    except WorkspaceError as exc:
        raise scrubbed(exc, items) from None

    def sell(minor: int) -> str:
        return format_money(Money(amount_minor=minor, currency=locked.currency))

    options = [
        {
            "offer_id": item.ref,
            "markup_minor": option["markup_minor"],
            "sell_minor": option["sell"]["amount_minor"],
            "sell_formatted": sell(option["sell"]["amount_minor"]),
        }
        for item, option in zip(items, version.options, strict=True)
    ]
    cheapest = version.totals["min_sell_minor"]
    result = {
        "quote_id": str(locked.id),
        "number": format_number("quote", locked.number),
        "status": locked.status,
        "version": version.version,
        "currency": locked.currency,
        "markup_kind": locked.markup_kind,
        "markup_value": locked.markup_value,
        "options": options,
        "min_sell_minor": cheapest,
        "min_sell_formatted": sell(cheapest),
    }
    await _committed(ctx)
    return result
