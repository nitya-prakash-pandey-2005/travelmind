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


# --- review probes: extraction gaps ----------------------------------------------------------


@pytest.mark.parametrize(
    ("prose", "found"),
    [
        ("About Rupees 9,999 all in.", [("money", "Rupees 9,999")]),
        ("About 9,999 rupees all in.", [("money", "9,999 rupees")]),
        ("That's 500 dollars.", [("money", "500 dollars")]),
        ("Roughly 200 dirhams.", [("money", "200 dirhams")]),
        ("Around 90 euros, or 80 pounds.", [("money", "90 euros"), ("money", "80 pounds")]),
        ("It is rs 9999.", [("money", "rs 9999")]),
        ("It is inr 9,999.", [("money", "inr 9,999")]),
        ("It is ₹ 9,999.", [("money", "₹ 9,999")]),
        ("It is $ 30.", [("money", "$ 30")]),
    ],
)
def test_currency_words_lower_case_codes_and_spaced_symbols_are_money(prose, found):
    assert kinds(prose) == found


def test_currency_words_and_lower_case_codes_still_match_the_results():
    assert kinds("It is rs 12345, INR 12,345 or 12,345 rupees.") == []
    assert kinds("It is ₹ 12,345 for the pair.") == []


@pytest.mark.parametrize(
    ("prose", "found"),
    [
        ("Fares run ₹12,345–15,000.", [("money", "15,000")]),
        ("Fares run ₹12,345 - 15,000.", [("money", "15,000")]),
        ("Fares run ₹12,345 to 15,000.", [("money", "15,000")]),
        ("Fares run between ₹12,345 and 15,000.", [("money", "15,000")]),
        ("Fares run ₹1–1.5 lakh.", [("money", "₹1"), ("money", "1.5 lakh")]),
    ],
)
def test_a_range_carries_its_currency_to_the_second_amount(prose, found):
    assert kinds(prose) == found


def test_a_range_tail_is_not_a_count_and_and_needs_between():
    assert kinds("₹12,345 to 2 adults, and ₹12,345 and 4 nights.") == []
    lakh = facts_of([flights_result(total_minor=15000000, total_formatted="₹1,50,000")])
    assert kinds("Between ₹1.5 lakh and 1.5 lakh.", lakh) == []


@pytest.mark.parametrize(
    ("prose", "found"),
    [
        ("It costs 9,999 in all.", [("money", "9,999")]),
        ("It costs 2,16,804 in all.", [("money", "2,16,804")]),
        ("It costs 12,345 in all.", []),  # matches ₹12,345: the currency is unknown
    ],
)
def test_bare_grouped_numbers_are_money_in_any_currency(prose, found):
    assert kinds(prose) == found


def test_hyphenated_flight_numbers_are_flights():
    assert kinds("Take AI-999 or 6E-2134.") == [("flight", "AI-999"), ("flight", "6E-2134")]
    assert kinds("Take AI-101.") == []


@pytest.mark.parametrize(
    ("prose", "found"),
    [
        ("Leave 12.12.2026.", []),
        ("Leave 13.12.2026.", [("date", "13.12.2026")]),
        ("Leave 13-12-2026.", [("date", "13-12-2026")]),
        ("Leave 2026/12/12.", []),
        ("Leave 2026/12/13.", [("date", "2026/12/13")]),
    ],
)
def test_dotted_dashed_and_year_first_dates_are_checked(prose, found):
    assert kinds(prose) == found


# --- per person vs total ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("prose", "found"),
    [
        ("₹6,172 per person.", []),
        ("₹6,172 pp.", []),
        ("₹6,172.50 each.", []),
        ("₹6,172 per traveller.", []),
        ("₹12,345 per person.", [("money", "₹12,345")]),  # that is the total
        ("₹12,345 in total.", []),
        ("Total ₹12,345.", []),
        ("₹6,172 in total.", [("money", "₹6,172")]),  # that is one traveller's share
        ("A total of ₹6,172.", [("money", "₹6,172")]),
        ("₹6,172 or ₹12,345.", []),  # unqualified: either
    ],
)
def test_a_per_person_amount_must_be_a_per_traveller_one_and_a_total_a_total(prose, found):
    assert kinds(prose) == found


def test_an_amount_the_user_typed_matches_either_way():
    user = stated_facts(["Budget ₹40,000 per person"], today=date(2026, 10, 4), currency="INR")
    assert kinds("Your ₹40,000 per person, ₹40,000 in total.", FACTS, user) == []


# --- false positives ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "prose",
    [
        "Support is open 24/7.",
        "Rated 4/5 by guests.",
        "It scores 4.2/5.",
        "Guests give it 4/5 stars.",
        "Plan a 1/2 day tour.",
        "Allow 3/4 of an hour.",
    ],
)
def test_fractions_and_ratings_are_not_dates(prose):
    assert kinds(prose) == []


def test_a_day_month_date_needs_a_date_context():
    assert kinds("Leave on 13/12.") == [("date", "13/12")]
    assert kinds("Pick 13/12 of the seats.") == []  # no date context: not read as a date
    assert kinds("Return on 31/13.") == []  # no month 13


@pytest.mark.parametrize(
    "prose",
    [
        "An A320 or an A321neo, a B787 or an E190; an ATR 72 on the short hop.",
        "The A220 is quiet.",
        "UV 9 at noon, PM2.5 is fine.",
        "Board at Gate B12 or gate A7.",
    ],
)
def test_aircraft_uv_pm_and_gates_are_not_flights(prose):
    assert kinds(prose) == []


def test_common_words_that_spell_codes_are_not_checked():
    def everything(code: str) -> bool:
        return True

    prose = (
        "Times in IST, prices with GST; your PNR and OTP by text. No EMI, ATM nearby, gate TBA, "
        "see the FAQ. USA visa, CEO and VIP lounges."
    )
    assert find_violations(prose, FACTS, EMPTY, is_airport=everything) == []
    assert kinds("The room has AC 2 units, a TV 55 inch, ID 1234 needed.") == []


def test_a_common_word_code_in_the_results_is_checked_like_any_other():
    istanbul = flights_result()
    istanbul.data["trip"]["destination"] = "IST"

    def everything(code: str) -> bool:
        return True

    facts = facts_of([istanbul])
    assert find_violations("DEL → IST", facts, EMPTY, is_airport=everything) == []
    flights = facts_of([flights_result(flight_numbers=["AC 101"])])
    assert kinds("AC 101 or AC 999.", flights) == [("flight", "AC 999")]


# --- itinerary days ---------------------------------------------------------------------------


def test_a_day_inside_the_searched_trip_is_grounded_in_an_itinerary_only():
    def itinerary(prose: str) -> list[tuple[str, str]]:
        found = find_violations(prose, FACTS, EMPTY, is_airport=is_airport, within_trip=True)
        return [(v.kind, v.text) for v in found]

    assert itinerary("Day 3 is 14 Dec 2026.") == []
    assert itinerary("Day 9 is 20 Dec 2026.") == [("date", "20 Dec 2026")]
    assert kinds("Leave on 14 Dec 2026.") == [("date", "14 Dec 2026")]  # prose: a returned date


def test_the_itinerary_text_on_the_board_is_checked_and_dropped_on_fallback():
    from travelmind.agent.plan import itinerary_text

    days = [
        {"day": 1, "date_display": "12 Dec 2026", "title": "Arrive", "notes": "Fly AI 999",
         "items": [{"id": "F1"}]},
        {"day": 2, "date_display": None, "title": None, "notes": "₹3,000 dinner", "items": []},
    ]  # fmt: skip
    text = itinerary_text(days)
    assert "Fly AI 999" in text and "₹3,000" in text and "12 Dec 2026" in text and "Arrive" in text
    itinerary = ToolResult("c2", "build_itinerary", {"days": days})
    result = build_result(RunMemory(), [itinerary], None, summary="", fallback=True)
    assert [(d["title"], d["notes"]) for d in result.itinerary] == [(None, None), (None, None)]
    assert result.itinerary[0]["date_display"] == "12 Dec 2026"
    assert result.itinerary[0]["items"] == [{"id": "F1"}]


@pytest.mark.parametrize(
    "text",
    [
        "₹" + " " * 20_000 + "x",
        "rupees" + " " * 20_000 + "x",
        "₹1" + " -" * 10_000,
        "₹1 to" * 4_000,
        "1/" * 10_000,
        "on 1/2 " * 3_000,
        "AI-" * 7_000,
        "1,000," * 4_000,
        "12.12." * 4_000,
        "between ₹1 and " * 2_000,
    ],
    ids=lambda text: repr(text[:12]),
)
def test_the_guard_is_fast_on_long_adversarial_text(text):
    import time

    started = time.perf_counter()
    find_violations(text, FACTS, EMPTY, is_airport=is_airport)
    assert time.perf_counter() - started < 1.0
