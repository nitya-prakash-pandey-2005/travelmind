from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from travelmind.offers.display import display_money, rank_by_display
from travelmind.offers.fx import FxRates
from travelmind.offers.money import Money

RATES = FxRates(
    as_of=date(2026, 9, 28), rates={"EUR": Decimal(1), "USD": Decimal("1.085"), "INR": Decimal(90)}
)


def inr(minor: int) -> Money:
    return Money(amount_minor=minor, currency="INR")


def test_display_money_keeps_native_amounts_and_converts_the_rest():
    assert display_money(inr(500000), "INR", None) == inr(500000)
    assert display_money(inr(500000), "INR", RATES) == inr(500000)
    usd = Money(amount_minor=1085, currency="USD")  # $10.85 = €10 = ₹900
    assert display_money(usd, "INR", RATES) == inr(90000)
    assert display_money(usd, "INR", None) is None
    assert display_money(Money(amount_minor=100, currency="GBP"), "INR", RATES) is None


@dataclass
class Priced:
    name: str
    total: Money
    extra: int = 0


def test_rank_by_display_puts_unconvertible_prices_last_grouped_by_currency():
    items = [
        Priced("gbp-2", Money(amount_minor=200, currency="GBP")),
        Priced("inr-high", inr(90000)),
        Priced("gbp-1", Money(amount_minor=100, currency="GBP")),
        Priced("usd", Money(amount_minor=1000, currency="USD")),  # ≈ ₹829.49
        Priced("inr-low", inr(80000)),
        Priced("aud", Money(amount_minor=50, currency="AUD")),
    ]
    ranked = rank_by_display(items, lambda i: display_money(i.total, "INR", RATES))
    assert [i.name for i in ranked] == ["inr-low", "usd", "inr-high", "aud", "gbp-1", "gbp-2"]


def test_rank_by_display_breaks_price_ties_with_the_tiebreak():
    items = [Priced("slow", inr(100), extra=9), Priced("fast", inr(100), extra=1)]
    ranked = rank_by_display(items, lambda i: i.total, tiebreak=lambda i: (i.extra,))
    assert [i.name for i in ranked] == ["fast", "slow"]
