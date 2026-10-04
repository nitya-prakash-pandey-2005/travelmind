"""The rule-based demo planner: pure extraction from plain text, and the tool calls it scripts."""

from datetime import date

import pytest

from travelmind.agent.fake import FakeProvider
from travelmind.agent.planner import (
    TripRequest,
    extract_cabin,
    extract_dates,
    extract_route,
    extract_scope,
    extract_travellers,
    extract_trip,
    missing_fields,
    plan_turn,
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
