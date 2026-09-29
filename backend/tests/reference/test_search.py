from travelmind.reference.search import AirportIndex, AirportRecord, fold


def _airport(code, name, city, country="IN", kind="large_airport", scheduled=True, keywords=None):
    return AirportRecord(
        iata_code=code,
        name=name,
        city=city,
        country_code=country,
        country_name={
            "IN": "India",
            "IT": "Italy",
            "BR": "Brazil",
            "GB": "United Kingdom",
            "CN": "China",
        }[country],
        airport_type=kind,
        scheduled_service=scheduled,
        latitude=0.0,
        longitude=0.0,
        keywords=keywords,
    )


INDEX = AirportIndex(
    [
        _airport("DEL", "Indira Gandhi International Airport", "New Delhi", keywords="Palam"),
        _airport(
            "BOM",
            "Chhatrapati Shivaji Maharaj International Airport",
            "Mumbai",
            keywords="Bombay, Sahar",
        ),
        _airport("GOI", "Dabolim Airport", "Vasco da Gama", kind="medium_airport", keywords="Goa"),
        _airport(
            "GOX",
            "Manohar International Airport",
            "Mopa",
            kind="medium_airport",
            keywords="Goa, Mopa",
        ),
        _airport(
            "GOA", "Genoa Cristoforo Colombo Airport", "Genova", country="IT", kind="medium_airport"
        ),
        _airport("GRU", "São Paulo/Guarulhos International Airport", "São Paulo", country="BR"),
        _airport("LHR", "London Heathrow Airport", "London", country="GB"),
        _airport("LGW", "London Gatwick Airport", "London", country="GB"),
        _airport("LTN", "London Luton Airport", "London", country="GB"),
        _airport("STN", "London Stansted Airport", "London", country="GB"),
        # Real OurAirports data lists Congonhas as a large, scheduled airport too.
        _airport("CGH", "Congonhas Airport", "São Paulo", country="BR"),
    ]
)


def codes(query, limit=8):
    return [hit.airport.iata_code for hit in INDEX.search(query, limit)]


def test_fold_strips_accents_case_and_spaces():
    assert fold("  São   PAULO ") == "sao paulo"


def test_exact_iata_code_ranks_first():
    assert codes("bom")[0] == "BOM"
    assert codes("DEL")[0] == "DEL"


def test_old_city_names_resolve():
    assert codes("Bombay")[0] == "BOM"


def test_goa_means_india_before_genoa():
    assert codes("goa")[:3] == ["GOI", "GOX", "GOA"]


def test_typo_still_finds_delhi():
    assert codes("dehli")[0] == "DEL"


def test_accented_city_matches_plain_query():
    assert codes("sao paulo")[0] == "GRU"


def test_city_with_several_airports_returns_all():
    assert set(codes("london")) >= {"LHR", "LGW"}


def test_short_or_empty_queries_return_nothing():
    assert codes("x") == []
    assert codes("   ") == []


def test_limit_is_respected():
    assert len(codes("airport", limit=2)) == 2


def test_get_by_code():
    assert INDEX.get("gru").city == "São Paulo"
    assert INDEX.get("XXX") is None


def test_typo_of_alias_beats_lookalike_city_with_real_data_keywords():
    # Real OurAirports data: DEL's keywords don't mention Delhi, and "dehli" is closer to
    # China's "Delingha" than to "New Delhi" by plain fuzzy score.
    index = AirportIndex(
        [
            _airport(
                "DEL",
                "Indira Gandhi International Airport",
                "New Delhi",
                keywords="Palam Air Force Station",
            ),
            _airport(
                "HXD", "Haixi Delingha Airport", "Delingha", country="CN", kind="medium_airport"
            ),
        ]
    )
    assert [hit.airport.iata_code for hit in index.search("dehli")][0] == "DEL"


def test_full_airport_name_beats_other_airports_in_same_city():
    assert codes("london heathrow")[0] == "LHR"


def test_distinctive_name_word_finds_its_airport():
    assert codes("gatwick")[0] == "LGW"
    assert codes("guarulhos")[0] == "GRU"


def test_city_query_prefers_airport_named_after_the_city_on_ties():
    # GRU and CGH are both large airports in São Paulo; only GRU carries the city in its name.
    assert codes("sao paulo")[:2] == ["GRU", "CGH"]


def test_equal_scores_break_ties_by_airport_type_before_code():
    index = AirportIndex(
        [
            _airport("AAA", "Alpha Heliport", "Zeta", country="GB", kind="heliport"),
            _airport("ZZZ", "Omega Airfield", "Zeta", country="GB", kind="small_airport"),
        ]
    )
    hits = index.search("zeta")
    assert hits[0].score == hits[1].score
    assert [hit.airport.iata_code for hit in hits] == ["ZZZ", "AAA"]


def _record(code, name, city, country, country_name, kind="large_airport"):
    return AirportRecord(code, name, city, country, country_name, kind, True, 0.0, 0.0, None)


PRIMARY_INDEX = AirportIndex(
    [
        _record("LGW", "London Gatwick Airport", "London", "GB", "United Kingdom"),
        _record("LHR", "London Heathrow Airport", "London", "GB", "United Kingdom"),
        _record("LCY", "London City Airport", "London", "GB", "United Kingdom", "medium_airport"),
        _record("ORY", "Paris-Orly Airport", "Paris", "FR", "France"),
        _record("CDG", "Charles de Gaulle International Airport", "Paris", "FR", "France"),
        _record("HND", "Tokyo Haneda International Airport", "Tokyo", "JP", "Japan"),
        _record("NRT", "Narita International Airport", "Narita", "JP", "Japan"),
    ]
)


def _top(query, n):
    return [hit.airport.iata_code for hit in PRIMARY_INDEX.search(query, n)]


def test_multi_airport_cities_list_the_main_airport_first():
    assert _top("london", 3) == ["LHR", "LGW", "LCY"]
    assert _top("paris", 2) == ["CDG", "ORY"]
    assert _top("tokyo", 2) == ["HND", "NRT"]


def test_specific_airport_names_still_win_over_the_city_alias():
    assert _top("london city", 1) == ["LCY"]
    assert _top("orly", 1) == ["ORY"]
