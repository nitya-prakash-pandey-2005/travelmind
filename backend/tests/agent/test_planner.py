"""The rule-based demo planner: pure extraction from plain text, and the tool calls it scripts."""

import re
import time
from datetime import date

import pytest

from travelmind.agent import planner
from travelmind.agent.fake import FakeProvider
from travelmind.agent.planner import (
    MAX_MESSAGE_CHARS,
    TripRequest,
    _bare_place,
    extract_cabin,
    extract_dates,
    extract_route,
    extract_scope,
    extract_travellers,
    extract_trip,
    missing_fields,
    plan_turn,
    read_dates,
)
from travelmind.agent.provider import Message, ToolCall, ToolResult

TODAY = date(2026, 10, 4)  # a Sunday


@pytest.mark.parametrize(
    ("text", "route"),
    [
        ("Mumbai to Dubai for 4 adults, 12–16 Dec, mid-range hotel", ("Mumbai", "Dubai")),
        ("Plan a trip from New Delhi to London on 12 Dec", ("New Delhi", "London")),
        ("DEL-DXB 12/12 2 adults", ("DEL", "DXB")),
        ("BOM → GOI tomorrow", ("BOM", "GOI")),
        ("BOM -> GOI tomorrow", ("BOM", "GOI")),
        ("plan a trip mumbai to goa next friday", ("mumbai", "goa")),
        ("Flights to Dubai from Mumbai on 12 Dec", ("Mumbai", "Dubai")),
        ("I want to go to Goa", (None, "Goa")),
        ("fly out of Delhi please", (None, None)),
        ("from Delhi", ("Delhi", None)),
        ("Delhi to New York in December", ("Delhi", "New York")),
        ("Sao Paulo to Rome, 2 adults", ("Sao Paulo", "Rome")),
        ("nothing useful here", (None, None)),
    ],
)
def test_extract_route(text, route):
    assert extract_route(text) == route


@pytest.mark.parametrize(
    ("text", "dates"),
    [
        ("12–16 Dec", (date(2026, 12, 12), date(2026, 12, 16))),
        ("12-16 December", (date(2026, 12, 12), date(2026, 12, 16))),
        ("Dec 12-16", (date(2026, 12, 12), date(2026, 12, 16))),
        ("12 Dec to 16 Dec", (date(2026, 12, 12), date(2026, 12, 16))),
        ("from 12th Dec until 16th Dec", (date(2026, 12, 12), date(2026, 12, 16))),
        ("28 Dec – 3 Jan", (date(2026, 12, 28), date(2027, 1, 3))),
        ("2026-12-12 to 2026-12-16", (date(2026, 12, 12), date(2026, 12, 16))),
        ("12/12/2026", (date(2026, 12, 12), None)),
        ("leaving 05/11, back 09/11", (date(2026, 11, 5), date(2026, 11, 9))),
        ("on 5th March", (date(2027, 3, 5), None)),
        ("on March 5, 2027", (date(2027, 3, 5), None)),
        ("12 Dec for 4 nights", (date(2026, 12, 12), date(2026, 12, 16))),
        ("12 Dec for a week", (date(2026, 12, 12), date(2026, 12, 19))),
        ("tomorrow", (date(2026, 10, 5), None)),
        ("day after tomorrow", (date(2026, 10, 6), None)),
        ("next Friday", (date(2026, 10, 9), None)),
        ("next Sunday", (date(2026, 10, 11), None)),
        ("a 31 Feb trip", (None, None)),
        ("no dates here", (None, None)),
    ],
)
def test_extract_dates(text, dates):
    assert extract_dates(text, TODAY) == dates


@pytest.mark.parametrize(
    ("text", "travellers"),
    [
        ("4 adults", (4, 0, ())),
        ("2 adults and 2 kids aged 5 and 8", (2, 2, (5, 8))),
        ("two adults, one child (age 6)", (2, 1, (6,))),
        ("2 adults with a 4-year-old", (2, 1, (4,))),
        ("a couple", (2, 0, ())),
        ("solo trip", (1, 0, ())),
        ("3 people", (3, 0, ())),
        ("family of 4 with 2 kids aged 3 and 6", (2, 2, (3, 6))),
        ("family of 4", (None, 0, ())),
        ("1 adult, 2 children", (1, 2, ())),
        ("nothing here", (None, 0, ())),
    ],
)
def test_extract_travellers(text, travellers):
    assert extract_travellers(text) == travellers


@pytest.mark.parametrize(
    ("text", "cabin"),
    [
        ("business class please", "business"),
        ("premium economy", "premium_economy"),
        ("first class", "first"),
        ("cheapest economy", "economy"),
        ("Mumbai to Dubai", None),
    ],
)
def test_extract_cabin(text, cabin):
    assert extract_cabin(text) == cabin


@pytest.mark.parametrize(
    ("text", "scope"),
    [
        ("Mumbai to Dubai, flights only", (True, False)),
        ("just the flights", (True, False)),
        ("just a hotel in Goa", (False, True)),
        ("hotel only, no flights", (False, True)),
        ("Mumbai to Dubai with a hotel", (True, True)),
    ],
)
def test_extract_scope(text, scope):
    assert extract_scope(text) == scope


def test_missing_fields():
    assert missing_fields(extract_trip("Trip to Dubai", TODAY)) == [
        "origin",
        "depart_date",
        "adults",
    ]
    complete = extract_trip("DEL to DXB 12-16 Dec, 2 adults", TODAY)
    assert missing_fields(complete) == []
    hotel_only = extract_trip("just a hotel in Goa 12-16 Dec for 2 adults", TODAY)
    assert hotel_only.flights is False and missing_fields(hotel_only) == []
    kids = extract_trip("DEL to DXB 12-16 Dec, 2 adults and 1 child", TODAY)
    assert missing_fields(kids) == ["children_ages"]
    hotel_no_return = extract_trip("DEL to DXB on 12 Dec, 2 adults, and a hotel", TODAY)
    assert missing_fields(hotel_no_return) == ["return_date"]


def test_extract_trip_reads_everything():
    trip = extract_trip(
        "Mumbai to Dubai for 4 adults, 12–16 Dec, mid-range hotel, business class", TODAY
    )
    assert trip == TripRequest(
        origin="Mumbai",
        destination="Dubai",
        depart_date=date(2026, 12, 12),
        return_date=date(2026, 12, 16),
        adults=4,
        cabin="business",
        hotel_mentioned=True,
    )


# --- scripted conversation ---------------------------------------------------------------


def _user(text: str) -> Message:
    return Message(role="user", text=text)


def _answer(turn, data_by_name):  # type: ignore[no-untyped-def]
    """The model message for `turn`'s calls, then a tool message answering each of them."""
    results = tuple(ToolResult(call_id=c.id, name=c.name, data=data_by_name(c)) for c in turn.calls)
    return [
        Message(role="model", text=turn.text, calls=turn.calls),
        Message("tool", results=results),
    ]


def _airport(call: ToolCall) -> dict:
    codes = {"Mumbai": "BOM", "Dubai": "DXB"}
    code = codes.get(call.args["query"])
    return {"matches": [{"code": code, "name": f"{code} airport"}] if code else []}


SEARCH_RESULTS = {
    "search_flights": {
        "offers": [
            {"offer_id": "o1", "flight_numbers": ["EK 501"], "total_formatted": "₹1,23,456"},
            {"offer_id": "o2", "flight_numbers": ["6E 61"], "total_formatted": "₹1,30,000"},
        ]
    },
    "search_hotels": {
        "hotels": [{"hotel_id": "h1", "name": "Rove Downtown", "total_formatted": "₹45,000"}]
    },
    "weather_forecast": {"label": "typical", "days": [{"date": "2026-12-12"}] * 5},
}


def test_the_planner_looks_up_places_then_searches_then_answers():
    messages = [_user("Mumbai to Dubai for 4 adults, 12–16 Dec, mid-range hotel")]
    first = plan_turn(messages, TODAY)
    assert first.text is None
    assert [(c.name, c.args) for c in first.calls] == [
        ("lookup_airport", {"query": "Mumbai"}),
        ("lookup_airport", {"query": "Dubai"}),
    ]
    assert len({c.id for c in first.calls}) == 2

    messages += _answer(first, _airport)
    second = plan_turn(messages, TODAY)
    assert [(c.name, c.args) for c in second.calls] == [
        (
            "search_flights",
            {
                "origin": "BOM",
                "destination": "DXB",
                "depart_date": "2026-12-12",
                "return_date": "2026-12-16",
                "adults": 4,
                "cabin": "economy",
            },
        ),
        (
            "search_hotels",
            {
                "destination": "DXB",
                "check_in": "2026-12-12",
                "check_out": "2026-12-16",
                "adults": 4,
                "rooms": 2,
            },
        ),
        (
            "weather_forecast",
            {"place_or_airport": "DXB", "start": "2026-12-12", "end": "2026-12-16"},
        ),
    ]
    assert not {c.id for c in second.calls} & {c.id for c in first.calls}

    messages += _answer(second, lambda c: SEARCH_RESULTS[c.name])
    final = plan_turn(messages, TODAY)
    assert final.calls == ()
    assert final.text is not None
    for value in ("BOM", "DXB", "EK 501", "₹1,23,456", "Rove Downtown", "₹45,000"):
        assert value in final.text


def test_codes_typed_by_the_user_skip_the_lookup():
    turn = plan_turn([_user("DEL to DXB 12-16 Dec, 2 adults and 1 child aged 7")], TODAY)
    flights = turn.calls[0]
    assert flights.name == "search_flights"
    assert flights.args["origin"] == "DEL" and flights.args["children_ages"] == [7]
    # a hotel was not asked for: only flights and weather
    assert [c.name for c in turn.calls] == ["search_flights", "weather_forecast"]


def test_goa_typed_in_capitals_is_looked_up_as_the_city_not_used_as_a_code():
    turn = plan_turn([_user("DEL to GOA 12-16 Dec, 2 adults")], TODAY)
    assert [(c.name, c.args) for c in turn.calls] == [("lookup_airport", {"query": "GOA"})]


def test_flights_only_skips_hotels():
    turn = plan_turn([_user("DEL to DXB 12-16 Dec, 2 adults, flights only, hotel")], TODAY)
    assert "search_hotels" not in [c.name for c in turn.calls]


def test_hotel_only_needs_no_origin():
    turn = plan_turn([_user("just a hotel in DXB 12-16 Dec for 3 adults")], TODAY)
    assert [c.name for c in turn.calls] == ["search_hotels", "weather_forecast"]
    assert turn.calls[0].args["rooms"] == 2


def test_missing_details_are_asked_for_then_merged_from_the_reply():
    messages = [_user("Trip to Dubai")]
    ask = plan_turn(messages, TODAY)
    [call] = ask.calls
    assert call.name == "ask_user"
    assert call.args["fields"] == ["origin", "depart_date", "adults"]
    assert call.args["question"]
    messages += [Message(role="model", calls=ask.calls), _user("From Mumbai, 12-16 Dec, 2 adults")]
    lookups = plan_turn(messages, TODAY)
    assert [c.args["query"] for c in lookups.calls] == ["Mumbai", "Dubai"]


def test_a_bare_reply_fills_the_one_place_asked_for():
    messages = [_user("Trip to Dubai 12-16 Dec for 2 adults")]
    ask = plan_turn(messages, TODAY)
    assert ask.calls[0].args["fields"] == ["origin"]
    messages += [
        Message(role="model", calls=ask.calls),
        Message(
            role="tool",
            results=(ToolResult(call_id=ask.calls[0].id, name="ask_user", data={"asked": True}),),
        ),
        _user("Mumbai"),
    ]
    lookups = plan_turn(messages, TODAY)
    assert [c.args["query"] for c in lookups.calls] == ["Mumbai", "Dubai"]


def test_an_unknown_place_is_asked_about():
    messages = [_user("Atlantis to Dubai 12-16 Dec, 2 adults")]
    lookups = plan_turn(messages, TODAY)
    messages += _answer(
        lookups, lambda c: {"matches": []} if c.args["query"] == "Atlantis" else _airport(c)
    )
    ask = plan_turn(messages, TODAY)
    [call] = ask.calls
    assert call.name == "ask_user" and call.args["fields"] == ["origin"]
    assert "Atlantis" in call.args["question"]


async def test_fake_provider_planner_drives_the_same_turns():
    planner = FakeProvider.planner(today=lambda: TODAY)
    generation = await planner.generate(
        system="sys",
        messages=[_user("DEL to DXB 12-16 Dec, 2 adults")],
        tools=[],
        timeout_s=5,
    )
    assert [c.name for c in generation.calls] == ["search_flights", "weather_forecast"]


# --- decimals are not dates ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "dates"),
    [
        ("next Friday for 3 nights, 4.5 star hotel", (date(2026, 10, 9), date(2026, 10, 12))),
        ("12/10 to Goa for 2 adults, budget 1.5 lakh", (date(2026, 10, 12), None)),
        ("12/10, a 3.5 star stay, 2.5k per night", (date(2026, 10, 12), None)),
        ("25.12.2026", (date(2026, 12, 25), None)),
        ("leaving 5.11.26", (date(2026, 11, 5), None)),
    ],
)
def test_decimals_are_not_read_as_dates(text, dates):
    assert extract_dates(text, TODAY) == dates


# --- dates the planner must ask about ------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "2025-12-12 to 2025-12-16",
        "12/12/2025",
        "on 5 March 2026",
        "12 Dec 2025 for 4 nights",
    ],
)
def test_an_explicit_past_date_is_an_issue_not_a_date(text):
    assert read_dates(text, TODAY) == (None, None, "past")
    assert extract_dates(text, TODAY) == (None, None)


@pytest.mark.parametrize(
    "text",
    [
        "16 Dec to 12 Dec",
        "Dec 16 - Dec 12",
        "16-12 Dec",
        "Dec 16-12",
        "16 Dec 2026 to 12 Dec 2026",
        "leaving 15 Mar, back 10 Feb",
    ],
)
def test_a_reversed_range_is_an_issue_not_next_year(text):
    assert read_dates(text, TODAY) == (None, None, "reversed")
    assert extract_dates(text, TODAY) == (None, None)


@pytest.mark.parametrize(
    ("text", "dates"),
    [
        ("28 Dec – 3 Jan", (date(2026, 12, 28), date(2027, 1, 3))),
        ("12-12 Dec", (date(2026, 12, 12), date(2026, 12, 12))),
        ("today", (TODAY, None)),
        ("on 5th March", (date(2027, 3, 5), None)),  # no year: the next 5 March
    ],
)
def test_dates_that_need_no_question(text, dates):
    assert read_dates(text, TODAY) == (*dates, None)


def test_a_past_date_is_asked_about():
    [call] = plan_turn([_user("DEL to DXB 2025-12-12 to 2025-12-16, 2 adults")], TODAY).calls
    assert call.name == "ask_user" and call.args["fields"] == ["depart_date"]
    assert "already passed" in call.args["question"]


def test_a_reversed_range_is_asked_about():
    [call] = plan_turn([_user("DEL to DXB 16 Dec to 12 Dec, 2 adults")], TODAY).calls
    assert call.name == "ask_user" and call.args["fields"] == ["depart_date"]
    assert "before the departure" in call.args["question"]


def test_a_corrected_date_clears_the_issue():
    messages = [_user("DEL to DXB 16 Dec to 12 Dec, 2 adults")]
    ask = plan_turn(messages, TODAY)
    messages += [Message(role="model", calls=ask.calls), _user("12 Dec to 16 Dec")]
    turn = plan_turn(messages, TODAY)
    assert turn.calls[0].name == "search_flights"
    assert turn.calls[0].args["depart_date"] == "2026-12-12"


def test_a_later_past_date_replaces_good_dates_with_a_question():
    messages = [_user("DEL to DXB 12-16 Dec, 2 adults, flights only")]
    first = plan_turn(messages, TODAY)
    messages += [Message(role="model", calls=first.calls), _user("actually 2025-12-12")]
    [call] = plan_turn(messages, TODAY).calls
    assert call.name == "ask_user" and "already passed" in call.args["question"]


def test_a_return_date_reply_before_the_departure_is_asked_about():
    messages = [_user("DEL to DXB on 16 Dec, 2 adults, and a hotel")]
    ask = plan_turn(messages, TODAY)
    assert ask.calls[0].args["fields"] == ["return_date"]
    messages += [Message(role="model", calls=ask.calls), _user("12 Dec")]
    [call] = plan_turn(messages, TODAY).calls
    assert call.name == "ask_user" and "before the departure" in call.args["question"]


# --- bounded work on long input --------------------------------------------------------------

ADVERSARIAL = {
    "spaces": " " * 20_000 + "x",
    "digit then spaces": "1" + " " * 20_000 + "x",
    "year then spaces": "1 years" + " " * 20_000 + "x",
    "dash then spaces": "4 -" + " " * 20_000 + "x",
    "code then spaces": "DEL" + " " * 20_000 + "x",
    "aged then spaces": "aged 1" + " " * 20_000 + "x",
    "only then spaces": "only" + " " * 20_000 + "x",
    "next then spaces": "next" + " " * 20_000 + "x",
    "month then spaces": "dec" + " " * 20_000 + "x",
    "digits and spaces": "1 " * 10_000,
    "apostrophes": "a" + "'" * 20_000,
    "underscores": "a" + "_" * 20_000,
    "hyphens": "a-" * 10_000 + "-",
    "digits": "1" * 20_000,
    "arrows": "->" * 10_000,
    "to words": " to" * 7_000,
    "from words": "from " * 5_000,
    "in words": " in" * 7_000,
    "mixed": ("12 Dec to 4.5 star 2 adults aged 3, " + " " * 50) * 240,
}


@pytest.mark.parametrize("name", list(ADVERSARIAL))
def test_extraction_is_linear_on_long_adversarial_input(name):
    text = ADVERSARIAL[name]
    assert len(text) >= 20_000
    started = time.perf_counter()
    extract_trip(text, TODAY)
    _bare_place(text)
    assert time.perf_counter() - started < 0.1


PATTERNS = {
    name: value for name, value in vars(planner).items() if isinstance(value, re.Pattern)
} | {f"_CABINS[{i}]": pattern for i, (pattern, _) in enumerate(planner._CABINS)}


@pytest.mark.parametrize("pattern", list(PATTERNS))
def test_every_pattern_is_linear_on_long_adversarial_input(pattern):
    compiled = PATTERNS[pattern]
    for name, text in ADVERSARIAL.items():
        started = time.perf_counter()
        for _ in compiled.finditer(text):
            pass
        assert time.perf_counter() - started < 0.1, name


def test_the_planner_reads_at_most_max_message_chars_of_a_message():
    assert MAX_MESSAGE_CHARS == 2000
    padded = "DEL to DXB, 2 adults, flights only" + " " * MAX_MESSAGE_CHARS + "12 Dec"
    [call] = plan_turn([_user(padded)], TODAY).calls
    assert call.name == "ask_user" and call.args["fields"] == ["depart_date"]
    started = time.perf_counter()
    plan_turn([_user("1" + " " * 200_000)], TODAY)
    assert time.perf_counter() - started < 0.1


# --- plain dates, and the writes a request asks for -----------------------------------------

FRONTEND_ENQUIRY = (
    "Create an enquiry for this trip: DEL to DXB, 20 Nov 2026 to 24 Nov 2026, 2 adults, economy."
)
TRIP_BLOCK = {
    "origin": "DEL",
    "destination": "DXB",
    "depart_date": "2026-11-20",
    "depart_date_display": "20 Nov 2026",
    "return_date": "2026-11-24",
    "return_date_display": "24 Nov 2026",
}
ENQUIRY_ID = "6f1c2c1e-1111-4222-8333-944445555666"


def _offer(ref: str, total: str, currency: str = "INR") -> dict:
    return {
        "offer_id": ref,
        "flight_numbers": [f"AI {ref[1:]}01"],
        "total_formatted": total,
        "supplier_total_currency": currency,
        "converted": currency != "INR",
    }


def _results(call: ToolCall) -> dict:
    if call.name == "search_flights":
        offers = [
            _offer("F1", "₹40,000"),
            _offer("F2", "≈ ₹41,000", "USD"),
            _offer("F3", "₹42,000"),
            _offer("F4", "₹43,000"),
            _offer("F5", "₹44,000"),
        ]
        return {"trip": TRIP_BLOCK, "currency": "INR", "offers": offers}
    if call.name == "weather_forecast":
        return {"label": "typical", "days": [{"date": "2026-11-20"}] * 5}
    if call.name == "create_enquiry":
        return {"enquiry_id": ENQUIRY_ID, "number": "E-0007", "status": "new", "trip": TRIP_BLOCK}
    if call.name == "draft_quote":
        return {
            "number": "Q-0003",
            "currency": "INR",
            "options": [],
            "min_sell_formatted": "₹44,000",
        }
    raise AssertionError(call.name)


def _drive(text: str, decide=_results, *, turns: int = 6):  # type: ignore[no-untyped-def]
    """Run the planner over `text`, answering each turn's calls with `decide`, until it answers.
    Returns (every call made, the answer)."""
    messages = [_user(text)]
    made: list[ToolCall] = []
    for _ in range(turns):
        turn = plan_turn(messages, TODAY)
        if not turn.calls:
            return made, turn.text or ""
        made += turn.calls
        messages += _answer(turn, decide)
    raise AssertionError("the planner did not answer")


def test_the_summary_speaks_dates_as_the_tools_display_them():
    made, text = _drive("DEL to DXB 20-24 Nov 2026, 2 adults")
    assert [c.name for c in made] == ["search_flights", "weather_forecast"]
    assert "20 Nov 2026 to 24 Nov 2026" in text
    assert "2026-11-20" not in text and "2026-11-24" not in text


def test_a_hotel_only_summary_uses_the_stay_dates_as_displayed():
    def stay(call: ToolCall) -> dict:
        if call.name == "search_hotels":
            trip = {"check_in_display": "12 Dec 2026", "check_out_display": "16 Dec 2026"}
            return {
                "trip": trip,
                "hotels": [{"name": "Rove Downtown", "total_formatted": "₹45,000"}],
            }
        return {"label": "typical", "days": []}

    _, text = _drive("just a hotel in DXB 12-16 Dec for 2 adults", stay)
    assert "12 Dec 2026 to 16 Dec 2026" in text and "2026-12" not in text


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        (FRONTEND_ENQUIRY, planner.Intent(enquiry=True)),
        ("Draft a quote for this trip: DEL to DXB, 20 Nov 2026", planner.Intent(quote=True)),
        ("please create a new enquiry and draft a quote", planner.Intent(enquiry=True, quote=True)),
        (
            "Draft a quote on E-0012 for DEL to DXB",
            planner.Intent(quote=True, enquiry_ref="E-0012"),
        ),
        ("prepare the quote for enquiry e-12", planner.Intent(quote=True, enquiry_ref="E-0012")),
        ("Book it now and pay with my card", planner.Intent(booking=True)),
        ("DEL to DXB 20-24 Nov, 2 adults", planner.Intent()),
        ("what does an enquiry cost?", planner.Intent()),
    ],
)
def test_extract_intent(text, intent):
    assert planner.extract_intent(text) == intent


def test_the_frontend_enquiry_request_reads_as_a_flight_trip():
    trip = extract_trip(FRONTEND_ENQUIRY, TODAY)
    assert (trip.origin, trip.destination) == ("DEL", "DXB")
    assert (trip.depart_date, trip.return_date) == (date(2026, 11, 20), date(2026, 11, 24))
    assert (trip.adults, trip.cabin, trip.flights) == (2, "economy", True)


def test_a_stay_near_a_place_needs_no_origin():
    trip = extract_trip("Create an enquiry for this trip: a stay near DXB, 12 Dec 2026", TODAY)
    assert trip.destination == "DXB" and trip.flights is False and trip.hotels is True


def test_an_enquiry_request_plans_then_asks_to_create_the_enquiry_then_cites_it():
    made, text = _drive(FRONTEND_ENQUIRY)
    assert [c.name for c in made] == ["search_flights", "weather_forecast", "create_enquiry"]
    assert made[-1].args == {
        "origin": "DEL",
        "destination": "DXB",
        "depart_date": "2026-11-20",
        "return_date": "2026-11-24",
        "adults": 2,
        "cabin": "economy",
    }
    assert "E-0007" in text and "20 Nov 2026 to 24 Nov 2026" in text
    assert "draft_quote" not in [c.name for c in made]


def test_a_declined_enquiry_is_reported_and_nothing_follows():
    def declined(call: ToolCall) -> dict:
        if call.name == "create_enquiry":
            return {"status": "declined", "message": "The user declined this action."}
        return _results(call)

    made, text = _drive(FRONTEND_ENQUIRY.replace("an enquiry", "an enquiry and a quote"), declined)
    assert [c.name for c in made][-1] == "create_enquiry"
    assert "not created" in text and "E-0007" not in text


def test_a_quote_request_creates_the_enquiry_then_drafts_the_quote():
    made, text = _drive(
        "Draft a quote for this trip: DEL to DXB, 20 Nov 2026 to 24 Nov 2026, 2 adults."
    )
    names = [c.name for c in made]
    assert names == ["search_flights", "weather_forecast", "create_enquiry", "draft_quote"]
    assert made[-1].args == {
        "enquiry_id": ENQUIRY_ID,
        "offer_ids": ["F1", "F3", "F4"],  # F2 is billed in USD: not quotable in INR
        "markup_kind": "percent",
        "markup_value": 1000,
    }
    assert "Q-0003" in text and "E-0007" in text and "₹44,000" in text


def test_a_quote_on_a_named_enquiry_creates_no_enquiry():
    made, text = _drive("Draft a quote on E-0012 for DEL to DXB, 20-24 Nov 2026, 2 adults")
    assert [c.name for c in made] == ["search_flights", "weather_forecast", "draft_quote"]
    assert made[-1].args["enquiry_id"] == "E-0012"
    assert "Q-0003" in text


def test_no_quote_is_drafted_without_offers_in_the_agency_currency():
    def dollars(call: ToolCall) -> dict:
        data = _results(call)
        if call.name == "search_flights":
            data = data | {"offers": [_offer("F1", "≈ ₹40,000", "USD")]}
        return data

    made, text = _drive("Draft a quote on E-0012 for DEL to DXB, 20-24 Nov 2026, 2 adults", dollars)
    assert "draft_quote" not in [c.name for c in made]
    assert "INR" in text and "no quote" in text.lower()


def test_a_request_to_book_and_pay_gets_a_hand_off():
    made, text = _drive("Book DEL to DXB 20-24 Nov 2026 for 2 adults now and pay with my card")
    assert {c.name for c in made} <= {"search_flights", "weather_forecast"}
    assert "can't book" in text
