"""The grounding guard: every amount, flight number, date and airport code in the answer must be
in this run's tool results (or typed by the user), and the plan the board shows comes from the
results, never from the model's own numbers."""

from datetime import date

import pytest

from travelmind.agent.context import RunMemory
from travelmind.agent.facts import EMPTY, facts_of
from travelmind.agent.grounding import find_violations, reprompt_text, stated_facts
from travelmind.agent.plan import build_result, fallback_summary, split_answer
from travelmind.agent.provider import ToolResult
from travelmind.offers.money import Money

AIRPORTS = {"DEL", "BOM", "DXB", "GOI", "GOA", "THE", "AND"}


def is_airport(code: str) -> bool:
    return code in AIRPORTS


def flights_result(**changes) -> ToolResult:
    offer = {
        "offer_id": "F1",
        "carrier": "AI",
        "flight_numbers": ["AI 101"],
        "slices": [
            {
                "origin": "DEL",
                "destination": "BOM",
                "departs_at": "2026-12-12T07:00",
                "departs_display": "12 Dec 2026, 07:00",
            }
        ],
        "total_minor": 1234500,
        "total_currency": "INR",
        "total_formatted": "₹12,345",
        "per_traveller_minor": 617250,
        "per_traveller_formatted": "₹6,172.50",
    } | changes
    data = {
        "trip": {
            "origin": "DEL",
            "origin_city": "Delhi",
            "destination": "BOM",
            "destination_city": "Mumbai",
            "depart_date": "2026-12-12",
            "depart_date_display": "12 Dec 2026",
            "return_date": "2026-12-16",
            "return_date_display": "16 Dec 2026",
            "adults": 2,
            "children_ages": [],
            "cabin": "economy",
        },
        "currency": "INR",
        "offer_count": 1,
        "offers": [offer],
    }
    return ToolResult(call_id="c1", name="search_flights", data=data)


FACTS = facts_of([flights_result()])


def kinds(prose: str, facts=FACTS, user=EMPTY) -> list[tuple[str, str]]:
    return [(v.kind, v.text) for v in find_violations(prose, facts, user, is_airport=is_airport)]


def test_guard_catches_invented_price():
    assert kinds("The cheapest fare is ₹9,999 in total.") == [("money", "₹9,999")]
    assert kinds("The cheapest fare is INR 9999.") == [("money", "INR 9999")]
    assert kinds("The cheapest fare is ₹12,345 in total.") == []
    assert kinds("That is Rs. 12345, or ₹6,172.50 each.") == []


def test_guard_catches_invented_flight():
    assert kinds("Take AI 999 in the morning.") == [("flight", "AI 999")]
    assert kinds("Take AI 101 (also written AI101).") == []
    assert kinds("6E 2134 is another option.") == [("flight", "6E 2134")]


def test_guard_checks_dates_by_calendar_day():
    assert kinds("Leave on 12 Dec, back on Dec 16, 2026 (2026-12-16, 16/12).") == []
    assert kinds("Leave on 13 Dec.") == [("date", "13 Dec")]
    assert kinds("Leave on 2026-12-13.") == [("date", "2026-12-13")]
    assert kinds("Leave on 12 Dec 2027.") == [("date", "12 Dec 2027")]
    assert kinds("From 12–16 Dec.") == []
    assert kinds("From 12–17 Dec.") == [("date", "12–17 Dec")]


def test_guard_checks_only_known_airport_codes():
    assert kinds("DEL → BOM, then on to DXB.") == [("code", "DXB")]
    # Currency codes and capital words that aren't airports are not codes.
    assert kinds("Prices in INR; USD shown where converted. NOTE: PDF ready.") == []


def test_guard_reads_unit_tricks():
    assert kinds("About ₹12k for the pair.") == [("money", "₹12k")]
    assert kinds("Under 13k all in.") == [("money", "13k")]
    priced = facts_of([flights_result(total_minor=1200000, total_formatted="₹12,000")])
    assert kinds("About ₹12k for the pair.", priced) == []
    lakh = facts_of([flights_result(total_minor=15000000, total_formatted="₹1,50,000")])
    assert kinds("Around ₹1.5 lakh.", lakh) == []
    assert kinds("Around ₹1.6 lakh.", lakh) == [("money", "₹1.6 lakh")]


def test_money_compares_at_whole_unit_precision():
    usd = facts_of([flights_result(total_minor=123450, total_currency="USD")])
    assert kinds("It is $1,234.50.", usd) == []
    assert kinds("It is $1,234.", usd) == []
    assert kinds("It is $1,235.", usd) == []  # rounded half up
    assert kinds("It is $1,236.", usd) == [("money", "$1,236")]
    assert kinds("It is €1,234.", usd) == [("money", "€1,234")]  # another currency


def test_a_converted_price_may_be_quoted_as_the_approximate_value():
    converted = flights_result(
        total_minor=833100,
        total_formatted="≈ ₹8,331",
        supplier_total_minor=10000,
        supplier_total_currency="USD",
        supplier_total_formatted="$100",
    )
    facts = facts_of([converted])
    assert kinds("About ≈ ₹8,331 (≈₹8,331, or $100 billed).", facts) == []
    assert kinds("₹8,331 in total.", facts) == []


def test_values_the_user_typed_are_grounded():
    user = stated_facts(
        ["Budget ₹2 lakh, 12-16 Dec, DEL to DXB on EK 511, around 50k"],
        today=date(2026, 10, 4),
        currency="INR",
    )
    prose = "Within your ₹2 lakh budget, 12 Dec to 16 Dec 2026, DEL → DXB, EK 511, ₹50k."
    assert kinds(prose, FACTS, user) == []
    assert kinds(prose, FACTS) != []


def test_relative_dates_the_user_typed_are_grounded():
    user = stated_facts(["next Friday please"], today=date(2026, 10, 4), currency="INR")
    assert kinds("Leaving 2026-10-09.", EMPTY, user) == []


def test_text_the_model_wrote_into_an_itinerary_grounds_nothing():
    itinerary = ToolResult(
        call_id="c2",
        name="build_itinerary",
        data={"days": [{"day": 1, "date": "2026-12-25", "notes": "Budget ₹99,999 with AI 555"}]},
    )
    facts = facts_of([flights_result(), itinerary])
    assert kinds("Budget ₹99,999 with AI 555 on 25 Dec.", facts) == [
        ("money", "₹99,999"),
        ("flight", "AI 555"),
        ("date", "25 Dec"),
    ]


def test_ids_and_lookalikes_are_not_flight_numbers():
    assert kinds("Pick F12, H3 or P10. CO2 is 120 kg. Terminal T2.") == []


def test_may_is_a_month_only_when_written_as_one():
    assert kinds("Prices may 3 times change.") == []
    assert kinds("Leave on May 3.") == [("date", "May 3")]


def test_reprompt_lists_the_values():
    text = reprompt_text(find_violations("₹9,999 on AI 999", FACTS, EMPTY, is_airport=is_airport))
    assert "₹9,999" in text and "AI 999" in text
    assert "Use only values from the results" in text


# --- the answer and the plan ----------------------------------------------------------------


def test_split_answer_reads_the_fenced_json_block():
    prose, plan = split_answer(
        'Here is the plan.\n\n```json\n{"summary": "Two options.", "flights": ["F1"],'
        ' "hotels": [], "next_steps": ["Pick one"]}\n```'
    )
    assert prose == "Here is the plan."
    assert plan is not None and plan.flights == ["F1"] and plan.next_steps == ["Pick one"]


def test_split_answer_reads_a_trailing_object_and_tolerates_none():
    prose, plan = split_answer('Plan ready. {"flights": ["F2"]}')
    assert prose == "Plan ready." and plan is not None and plan.flights == ["F2"]
    prose, plan = split_answer("No JSON here.")
    assert prose == "No JSON here." and plan is None
    prose, plan = split_answer("Broken ```json\n{oops\n```")
    assert plan is None


def _memory_with_offer() -> RunMemory:
    memory = RunMemory()
    memory.remember(
        "flight",
        "sandbox-offer-very-long-supplier-id",
        label="AI 101 DEL → BOM",
        price=Money(amount_minor=1234500, currency="INR"),
        card=flights_result().data["offers"][0],
    )
    return memory


def test_the_plan_takes_its_cards_from_the_run_not_the_model():
    memory = _memory_with_offer()
    _, plan = split_answer('```json\n{"flights": ["F1", "F9"], "hotels": ["H1"]}\n```')
    result = build_result(memory, [flights_result()], plan, summary="Plan.", fallback=False)
    assert [card["offer_id"] for card in result.flights] == ["F1"]  # F9 was never returned
    assert result.flights[0]["total_formatted"] == "₹12,345"
    assert result.hotels == []
    assert result.trip is not None and result.trip["origin"] == "DEL"
    assert "sandbox-offer" not in result.model_dump_json()


def test_without_a_plan_block_the_latest_searches_fill_the_board():
    result = build_result(
        _memory_with_offer(), [flights_result()], None, summary="Plan.", fallback=False
    )
    assert [card["offer_id"] for card in result.flights] == ["F1"]


@pytest.mark.parametrize("with_offer", [True, False])
def test_the_fallback_summary_passes_the_guard(with_offer):
    memory = _memory_with_offer() if with_offer else RunMemory()
    results = [flights_result()] if with_offer else []
    result = build_result(memory, results, None, summary="", fallback=True)
    summary = fallback_summary(result)
    assert summary
    assert find_violations(summary, facts_of(results), EMPTY, is_airport=is_airport) == []
    if with_offer:
        assert "AI 101" in summary and "₹12,345" in summary
