"""facts(): the values a run's tool results vouch for (what the grounding guard checks prose
against), never text the model wrote itself."""

from datetime import date

from travelmind.agent.facts import EMPTY, MODEL_AUTHORED_PATHS, GroundFacts, facts, facts_of
from travelmind.agent.provider import ToolResult


def result(name: str, data: dict) -> ToolResult:
    return ToolResult(call_id="c1", name=name, data=data)


OFFER = {
    "offer_id": "F1",
    "carrier": "AI",
    "carrier_name": "Air India",
    "flight_numbers": ["AI 101", "AI 2"],
    "slices": [
        {
            "origin": "DEL",
            "destination": "BOM",
            "departs_at": "2026-12-03T07:00",
            "departs_display": "3 Dec 2026, 07:00",
            "arrives_at": "2026-12-03T09:10",
            "arrives_display": "3 Dec 2026, 09:10",
            "stops": 0,
            "duration_minutes": 130,
            "flight_numbers": ["AI 101"],
        }
    ],
    "total_minor": 249_000,
    "total_currency": "INR",
    "total_formatted": "≈ ₹2,490",
    "converted": True,
    "fx_as_of": "2026-10-02",
    "supplier_total_minor": 3_000,
    "supplier_total_currency": "USD",
    "supplier_total_formatted": "$30",
    "per_traveller_minor": 124_500,
    "per_traveller_formatted": "≈ ₹1,245",
}
SEARCH = {
    "trip": {
        "origin": "DEL",
        "origin_city": "New Delhi",
        "destination": "BOM",
        "destination_city": "Mumbai",
        "depart_date": "2026-12-03",
        "depart_date_display": "3 Dec 2026",
        "return_date": None,
        "return_date_display": None,
        "adults": 2,
        "children_ages": [],
        "cabin": "economy",
    },
    "currency": "INR",
    "offer_count": 1,
    "offers": [OFFER],
    "sources": [{"supplier": "sandbox", "status": "ok", "offer_count": 1}],
}


def test_flight_results_give_prices_both_ways_flight_numbers_dates_and_codes():
    found = facts(result("search_flights", SEARCH))
    # The display amount and the supplier's own amount are both facts.
    assert {("INR", 249_000), ("USD", 3_000), ("INR", 124_500)} <= found.amounts
    assert {"≈ ₹2,490", "₹2,490", "$30", "≈ ₹1,245", "₹1,245"} <= found.money_text
    assert found.flight_numbers == {"AI101", "AI2"}
    assert {date(2026, 12, 3), date(2026, 10, 2)} <= found.dates
    assert found.iata_codes == {"DEL", "BOM"}
    assert {"New Delhi", "Mumbai"} <= found.names


def test_hotel_and_place_names_are_facts():
    hotels = {
        "trip": {"destination": "BOM", "check_in": "2026-12-03", "check_out": "2026-12-05"},
        "currency": "INR",
        "hotels": [
            {
                "hotel_id": "H1",
                "name": "Airport Lodge Andheri",
                "total_minor": 610_000,
                "total_currency": "INR",
                "total_formatted": "₹6,100",
                "per_night_minor": 305_000,
                "per_night_formatted": "₹3,050",
            }
        ],
    }
    places = {
        "destination": {"name": "Mumbai", "latitude": 19.0, "longitude": 72.8},
        "places": [{"place_id": "P1", "name": "Jehangir Art Gallery", "kind": "gallery"}],
    }
    found = facts_of([result("search_hotels", hotels), result("find_places", places)])
    assert {("INR", 610_000), ("INR", 305_000)} <= found.amounts
    assert {date(2026, 12, 3), date(2026, 12, 5)} <= found.dates
    assert {"Airport Lodge Andheri", "Jehangir Art Gallery", "Mumbai"} <= found.names


def test_a_price_written_into_itinerary_notes_is_not_a_fact():
    itinerary = {
        "days": [
            {
                "day": 1,
                "date": "2026-12-24",
                "date_display": "24 Dec 2026",
                "title": "Fly 6E 123 for ₹99,999",
                "items": [{"id": "F1", "kind": "flight", "label": "AI 101 DEL → BOM"}],
                "notes": "Budget ₹99,999 (INR 9999900) on 25 Dec, then GOA",
            }
        ],
        "item_count": 1,
    }
    found = facts(result("build_itinerary", itinerary))
    assert ("INR", 9_999_900) not in found.amounts
    assert "₹99,999" not in found.money_text
    assert "6E123" not in found.flight_numbers
    assert date(2026, 12, 24) not in found.dates and date(2026, 12, 25) not in found.dates
    assert "GOA" not in found.iata_codes
    assert {"days[].title", "days[].notes", "days[].date"} <= MODEL_AUTHORED_PATHS[
        "build_itinerary"
    ]


def test_questions_and_errors_carry_no_facts():
    asked = facts(result("ask_user", {"question": "Is ₹50,000 on 3 Dec OK?", "fields": []}))
    failed = facts(
        result(
            "price_check",
            {"error": {"code": "unknown_id", "message": "No tool in this run returned AI 101."}},
        )
    )
    assert asked == EMPTY and failed == EMPTY


def test_budget_totals_and_quotes_are_facts():
    budget = {
        "currency": "INR",
        "total_minor": 859_000,
        "total_formatted": "≈ ₹8,590",
        "converted": True,
        "categories": [
            {
                "category": "flights",
                "items": ["F1"],
                "currency": "INR",
                "total_minor": 249_000,
                "total_formatted": "≈ ₹2,490",
            }
        ],
        "totals_by_currency": [],
        "unpriced": [],
        "note": None,
    }
    quote = {
        "currency": "INR",
        "options": [{"offer_id": "F1", "markup_minor": 100, "sell_minor": 249_100}],
        "min_sell_minor": 249_100,
        "min_sell_formatted": "₹2,491",
    }
    found = facts(result("estimate_budget", budget)) | facts(result("draft_quote", quote))
    assert isinstance(found, GroundFacts)
    assert {("INR", 859_000), ("INR", 249_000), ("INR", 249_100)} <= found.amounts
    assert {"₹8,590", "≈ ₹8,590", "₹2,491"} <= found.money_text
