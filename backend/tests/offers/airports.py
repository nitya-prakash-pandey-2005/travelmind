from travelmind.reference.search import AirportRecord


def _airport(code: str, city: str, country: str, lat: float, lon: float) -> AirportRecord:
    return AirportRecord(
        code,
        f"{city} International Airport",
        city,
        country,
        country,
        "large_airport",
        True,
        lat,
        lon,
        None,
    )


AIRPORTS = {
    a.iata_code: a
    for a in (
        _airport("DEL", "New Delhi", "IN", 28.5665, 77.103104),
        _airport("BOM", "Mumbai", "IN", 19.0887, 72.8679),
        _airport("LHR", "London", "GB", 51.4706, -0.461941),
        _airport("SYD", "Sydney", "AU", -33.9461, 151.177),
        _airport("DXB", "Dubai", "AE", 25.2528, 55.3644),
        _airport("DOH", "Doha", "QA", 25.2731, 51.6081),
        _airport("IST", "Istanbul", "TR", 41.2753, 28.7519),
        _airport("JFK", "New York", "US", 40.6398, -73.7789),
        _airport("GRU", "Sao Paulo", "BR", -23.4356, -46.4731),
        _airport("GIG", "Rio de Janeiro", "BR", -22.8099, -43.2505),
    )
}


def lookup(code: str) -> AirportRecord | None:
    return AIRPORTS.get(code.upper())
