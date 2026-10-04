"""Pure planning tools over the run memory: build_itinerary, estimate_budget and ask_user.

They make no calls and read no tables. build_itinerary and estimate_budget accept only ids
earlier tools returned in this run (the run memory), and estimate_budget adds up the prices
stored there: the model can arrange and total what the tools found, never introduce an item or
a price. ask_user hands the question back; the engine then waits for the user's reply.
"""

import datetime as dt
from collections import defaultdict
from typing import Annotated, Any

from pydantic import Field, StringConstraints, model_validator

from travelmind.agent.context import RunContext, SeenItem
from travelmind.agent.tools.base import Args, ToolError, clean_text, date_fields, format_money
from travelmind.agent.tools.travel import unknown_ids
from travelmind.offers.money import Money

MAX_DAYS = 31
MAX_ITEMS_PER_DAY = 12
MAX_BUDGET_ITEMS = 30
CATEGORIES = {"flight": "flights", "hotel": "hotels", "place": "activities"}
ItemId = Annotated[str, StringConstraints(min_length=1, max_length=40)]


def _resolve(ctx: RunContext, refs: list[str]) -> list[SeenItem]:
    items = [ctx.memory.get(ref) for ref in refs]
    missing = [ref for ref, item in zip(refs, items, strict=True) if item is None]
    if missing:
        raise unknown_ids(missing)
    return [item for item in items if item is not None]


# --- build_itinerary ---------------------------------------------------------------------


class DayIn(Args):
    date: dt.date | None = Field(None, description="YYYY-MM-DD, if the day has one.")
    title: str | None = Field(None, max_length=80)
    items: list[ItemId] = Field(
        default_factory=list,
        max_length=MAX_ITEMS_PER_DAY,
        description="Ids from earlier results: offer_id (F1), hotel_id (H1), place_id (P1).",
    )
    notes: str | None = Field(None, max_length=300)


class ItineraryArgs(Args):
    days: list[DayIn] = Field(min_length=1, max_length=MAX_DAYS)

    @model_validator(mode="after")
    def _in_order(self) -> "ItineraryArgs":
        dates = [d.date for d in self.days if d.date is not None]
        if any(later <= earlier for earlier, later in zip(dates, dates[1:], strict=False)):
            raise ValueError("Days must be in date order, one entry per date.")
        return self


async def build_itinerary(ctx: RunContext, args: ItineraryArgs) -> dict[str, Any]:
    _resolve(ctx, [ref for day in args.days for ref in day.items])  # every unknown id at once
    days = []
    for number, day in enumerate(args.days, start=1):
        items = _resolve(ctx, day.items)
        days.append(
            {
                "day": number,
                **date_fields("date", day.date),
                "title": clean_text(day.title, 80),
                "items": [{"id": i.ref, "kind": i.kind, "label": i.label} for i in items],
                "notes": clean_text(day.notes, 300),
            }
        )
    return {"days": days, "item_count": sum(len(d["items"]) for d in days)}


# --- estimate_budget ---------------------------------------------------------------------


class BudgetArgs(Args):
    items: list[ItemId] = Field(
        min_length=1,
        max_length=MAX_BUDGET_ITEMS,
        description="Ids from earlier results (F1, H1, ...). Prices come from those results.",
    )


def _total(currency: str, minor: int) -> dict[str, Any]:
    money = Money(amount_minor=minor, currency=currency)
    return {"currency": currency, "total_minor": minor, "total_formatted": format_money(money)}


async def estimate_budget(ctx: RunContext, args: BudgetArgs) -> dict[str, Any]:
    items = _resolve(ctx, list(dict.fromkeys(ref.strip().upper() for ref in args.items)))
    groups: dict[tuple[str, str], list[SeenItem]] = defaultdict(list)
    totals: dict[str, int] = defaultdict(int)
    unpriced = []
    for item in items:
        if item.price is None:
            unpriced.append(item.ref)
            continue
        groups[(CATEGORIES[item.kind], item.price.currency)].append(item)
        totals[item.price.currency] += item.price.amount_minor
    order = list(CATEGORIES.values())
    categories = [
        {"category": category, "items": [i.ref for i in group]}
        | _total(currency, sum(i.price.amount_minor for i in group if i.price))
        for (category, currency), group in sorted(
            groups.items(), key=lambda g: (order.index(g[0][0]), g[0][1])
        )
    ]
    by_currency = [_total(currency, minor) for currency, minor in sorted(totals.items())]
    single = by_currency[0] if len(by_currency) == 1 else None
    note = None
    if len(by_currency) > 1:
        codes = ", ".join(t["currency"] for t in by_currency)
        note = f"Prices are in different currencies ({codes}), so there is no single total."
    return {
        "currency": single["currency"] if single else None,
        "total_minor": single["total_minor"] if single else None,
        "total_formatted": single["total_formatted"] if single else None,
        "categories": categories,
        "totals_by_currency": by_currency,
        "unpriced": unpriced,
        "note": note,
    }


# --- ask_user ----------------------------------------------------------------------------

FieldName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]


class AskUserArgs(Args):
    question: str = Field(min_length=1, max_length=500, description="One short question.")
    fields: list[FieldName] = Field(
        default_factory=list, max_length=10, description="What the answer fills, e.g. adults."
    )


async def ask_user(ctx: RunContext, args: AskUserArgs) -> dict[str, Any]:
    question = clean_text(args.question, 500)
    if question is None:
        raise ToolError("invalid_arguments", "question: give a question to ask.")
    return {"question": question, "fields": list(args.fields)}
