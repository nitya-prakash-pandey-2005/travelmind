"""Prices in the agency's display currency, and cheapest-first ordering by them.

Shared by flight and hotel search.
"""

from collections.abc import Callable, Iterable
from typing import Protocol

from travelmind.offers.fx import FxRates
from travelmind.offers.money import Money


class Priced(Protocol):
    @property
    def total(self) -> Money: ...


def display_money(total: Money, currency: str, fx: FxRates | None) -> Money | None:
    """`total` in `currency`: as is when already in it, else converted (None without a rate)."""
    if total.currency == currency:
        return total
    return fx.convert(total, currency) if fx else None


def rank_by_display[P: Priced](
    items: Iterable[P],
    display: Callable[[P], Money | None],
    *,
    tiebreak: Callable[[P], tuple[int, ...]] = lambda _: (),
) -> list[P]:
    """Cheapest first by display price; unconvertible items go last, grouped by currency."""

    def key(item: P) -> tuple[int, str, int, tuple[int, ...]]:
        shown = display(item)
        if shown is not None:
            return (0, "", shown.amount_minor, tiebreak(item))
        return (1, item.total.currency, item.total.amount_minor, tiebreak(item))

    return sorted(items, key=key)
