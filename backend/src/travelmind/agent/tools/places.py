"""Places to visit (find_places), and turning a place name or airport code into coordinates.

Geocoding (`resolve`): text in capitals that is an airport code ("GOA", "DEL") is that airport;
a city alias written as a name ("Goa", "goa", "Delhi") is its city's main airport (GOI, DEL:
never the code it spells); anything else is looked up with Nominatim
(`{osm_nominatim_url}/search?format=jsonv2&limit=1`). For `find_places` an airport stands for
its city (a city's sights are around its centre, not its runway): the city, or the alias as
written, is geocoded, falling back to the airport's own coordinates.

Places: OpenStreetMap through Overpass (`osm_overpass_url`, named nodes and ways tagged for the
kind within the kind's radius: RADIUS_M, or TOWN_RADIUS_M for food and nightlife), or
OpenTripMap's radius search when TM_OPENTRIPMAP_KEY is set. Notable places (with a Wikidata or
Wikipedia link) come first, then the nearest: the Overpass query itself asks for the notable
ones first (`out center` caps each part), so a crowded centre can't push them past the cap.
At most OVERPASS_SLOTS Overpass calls run at once in a process.

OpenStreetMap usage policies (Nominatim: operations.osmfoundation.org/policies/nominatim,
Overpass: the public instance's guidelines): an identifiable User-Agent (`external.user_agent`,
with TM_OSM_CONTACT), at most one Nominatim request a second across all processes (a Redis
throttle), results cached (24 h here, misses too), no autocomplete or bulk use (the tool runs
only on a model's request), and attribution ("© OpenStreetMap contributors", ODbL) in every
result. The public instances suit development and light use; heavy production use needs our own
or a paid instance (the URLs are settings).

Names are untrusted (anyone can edit OSM): they are cleaned and cut to MAX_NAME characters and
only ever appear in the tool result's data.
"""

import asyncio
import math
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import Field, SecretStr

from travelmind.agent.context import RunContext
from travelmind.agent.tools.base import Args, ToolError, clean_text
from travelmind.agent.tools.external import (
    DAY_S,
    PRODUCT,
    Throttle,
    cache_key,
    cached,
    fetch_json,
    user_agent,
)
from travelmind.agent.tools.travel import alias_code, written_as_code
from travelmind.db import release_connection
from travelmind.reference.geo import great_circle_km
from travelmind.reference.service import get_airport_index

PlaceKind = Literal["sights", "museums", "food", "nature", "shopping", "nightlife", "family"]

OPENTRIPMAP_URL = "https://api.opentripmap.com/0.1/en/places/radius"
RADIUS_M = 8000
TOWN_RADIUS_M = 3000  # food and nightlife: what is near, not the whole metro area
MAX_NAME = 80
KEPT_PER_SEARCH = 20  # cached per destination and kind; a call returns at most 10
OVERPASS_SERVER_TIMEOUT_S = 10
OVERPASS_MAX_NOTABLE = 60
OVERPASS_MAX_ELEMENTS = 120
OVERPASS_SLOTS = 2  # concurrent Overpass calls per process (the public instance asks for few)
OVERPASS_SLOT_WAIT_S = 5.0
NOTABLE_TAGS = ("wikidata", "wikipedia")
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
OTM_ATTRIBUTION = "OpenTripMap; data © OpenStreetMap contributors and Wikidata"
UNAVAILABLE = "Place search is unavailable right now. Try again shortly."
NOT_FOUND = "Couldn't find that place. Try a city name or an airport code."

# OSM tag filters per kind: (key, values) where values is an anchored regex alternation.
OVERPASS_FILTERS: dict[PlaceKind, tuple[tuple[str, str], ...]] = {
    "sights": (
        ("tourism", "attraction|viewpoint"),
        ("historic", "monument|castle|fort|memorial|ruins|archaeological_site"),
    ),
    "museums": (("tourism", "museum|gallery"),),
    "food": (("amenity", "restaurant|cafe"),),
    "nature": (("leisure", "park|nature_reserve|garden"), ("natural", "beach|peak")),
    "shopping": (("shop", "mall|department_store"), ("amenity", "marketplace")),
    "nightlife": (("amenity", "bar|pub|nightclub"),),
    "family": (("tourism", "zoo|theme_park|aquarium"), ("leisure", "water_park")),
}
OPENTRIPMAP_KINDS: dict[PlaceKind, str] = {
    "sights": "interesting_places",
    "museums": "museums",
    "food": "foods",
    "nature": "natural",
    "shopping": "shops",
    "nightlife": "bars,pubs,nightclubs",
    "family": "amusements",
}


def radius_m(kind: PlaceKind) -> int:
    return TOWN_RADIUS_M if kind in ("food", "nightlife") else RADIUS_M


_overpass_slots: dict[asyncio.AbstractEventLoop, asyncio.Semaphore] = {}


def _overpass_slot() -> asyncio.Semaphore:
    """This event loop's Overpass slots (a semaphore belongs to one loop)."""
    loop = asyncio.get_running_loop()
    for other in [known for known in _overpass_slots if known.is_closed()]:
        del _overpass_slots[other]
    return _overpass_slots.setdefault(loop, asyncio.Semaphore(OVERPASS_SLOTS))


_nominatim_throttle = Throttle(
    "tm:osm:nominatim:turn", interval_s=1.0, wait_s=3.0, busy=UNAVAILABLE
)


@dataclass(frozen=True)
class Location:
    name: str
    latitude: float
    longitude: float
    code: str | None = None  # the airport it was given as (a code or a city alias), if any
    geocoded: bool = False  # found through Nominatim (OpenStreetMap data: credit it)


def _coord(value: float) -> str:
    return repr(round(value, 4))


def _point(lat: object, lon: object) -> tuple[float, float] | None:
    try:
        latitude, longitude = float(lat), float(lon)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return round(latitude, 4), round(longitude, 4)


def parse_nominatim(body: object) -> dict[str, Any]:
    """The first result as {name, latitude, longitude}, or {} when there is none."""
    first = body[0] if isinstance(body, list) and body else None
    if not isinstance(first, dict):
        return {}
    point = _point(first.get("lat"), first.get("lon"))
    display = first.get("display_name")
    name = clean_text(first.get("name"), MAX_NAME) or (
        clean_text(display.split(",")[0], MAX_NAME) if isinstance(display, str) else None
    )
    if point is None or name is None:
        return {}
    return {"name": name, "latitude": point[0], "longitude": point[1]}


async def geocode(ctx: RunContext, query: str) -> Location | None:
    """Nominatim's best match for `query` (cached 24 h, misses too), or None."""
    text = " ".join(query.split())[:200]
    settings = ctx.settings

    async def load() -> dict[str, Any]:
        await _nominatim_throttle.turn(ctx.redis)
        body = await fetch_json(
            "nominatim",
            "GET",
            settings.osm_nominatim_url.rstrip("/") + "/search",
            params={"q": text, "format": "jsonv2", "limit": "1", "accept-language": "en"},
            headers={"User-Agent": user_agent(settings)},
            unavailable=UNAVAILABLE,
            deadline_s=6.0,
        )
        return parse_nominatim(body)

    found = await cached(ctx.redis, cache_key("geo", text.casefold()), DAY_S, load)
    if not found:
        return None
    return Location(found["name"], found["latitude"], found["longitude"], geocoded=True)


async def resolve(ctx: RunContext, place: str, *, city_centre: bool) -> Location:
    """Coordinates for an airport code, a city alias or a place name (see the module
    docstring). With `city_centre`, an airport stands for its city (looked up by name, the
    airport itself when that fails)."""
    text = " ".join(place.split())
    as_code = written_as_code(text)
    airport_code = text if as_code else alias_code(text)
    airport = None
    if airport_code is not None:
        airport = (await get_airport_index(ctx.db)).get(airport_code)
        await release_connection(ctx.db)  # nothing held while the feeds answer
    if airport is not None:
        if as_code:
            name = clean_text(airport.city, MAX_NAME) or clean_text(airport.name, MAX_NAME) or text
            city = airport.city
        else:  # a city alias: the city as written ("Goa"), not the airport's town
            name = clean_text(text.title(), MAX_NAME) or airport.iata_code
            city = text
        if city_centre and city:
            try:
                found = await geocode(ctx, f"{city}, {airport.country_name}")
            except ToolError:
                found = None
            if found is not None:
                return Location(
                    found.name, found.latitude, found.longitude, airport.iata_code, geocoded=True
                )
        return Location(
            name, round(airport.latitude, 4), round(airport.longitude, 4), airport.iata_code
        )
    found = await geocode(ctx, text)
    if found is None:
        raise ToolError("not_found", NOT_FOUND)
    return found


def _ranked(found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Notable first, then nearest; the first of each name only."""
    found.sort(key=lambda p: (not p["notable"], -p.get("rate", 0), p["distance_km"]))
    kept: list[dict[str, Any]] = []
    names: set[str] = set()
    for place in found:
        if place["name"].casefold() not in names:
            names.add(place["name"].casefold())
            kept.append({k: v for k, v in place.items() if k not in ("notable", "rate")})
    return kept[:KEPT_PER_SEARCH]


def _distance(centre: tuple[float, float], point: tuple[float, float]) -> float:
    return round(great_circle_km(centre[0], centre[1], point[0], point[1]), 1)


def overpass_query(kind: PlaceKind, latitude: float, longitude: float) -> str:
    """Named places of the kind around the point: the notable ones (a Wikidata or Wikipedia
    link) first, up to OVERPASS_MAX_NOTABLE, then the others, up to OVERPASS_MAX_ELEMENTS."""
    around = f"(around:{radius_m(kind)},{_coord(latitude)},{_coord(longitude)})"
    filters = [f'nw["{key}"~"^({values})$"]["name"]' for key, values in OVERPASS_FILTERS[kind]]
    notable = "".join(f'{f}["{link}"]{around};' for f in filters for link in NOTABLE_TAGS)
    every = "".join(f"{f}{around};" for f in filters)
    return (
        f"[out:json][timeout:{OVERPASS_SERVER_TIMEOUT_S}];"
        f"({notable})->.notable;"
        f".notable out center {OVERPASS_MAX_NOTABLE};"
        f"({every})->.all;"
        "(.all; - .notable;);"
        f"out center {OVERPASS_MAX_ELEMENTS};"
    )


def parse_overpass(
    body: object, kind: PlaceKind, origin: tuple[float, float]
) -> list[dict[str, Any]]:
    elements = body.get("elements") if isinstance(body, dict) else None
    found: list[dict[str, Any]] = []
    for element in elements if isinstance(elements, list) else []:
        if not isinstance(element, dict) or element.get("type") not in ("node", "way"):
            continue
        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue
        name = clean_text(tags.get("name:en"), MAX_NAME) or clean_text(tags.get("name"), MAX_NAME)
        centre = element.get("center")
        centre_of: dict[str, Any] = centre if isinstance(centre, dict) else element
        point = _point(centre_of.get("lat"), centre_of.get("lon"))
        if not name or point is None or not isinstance(element.get("id"), int):
            continue
        matched = next(
            (
                tags[key]
                for key, values in OVERPASS_FILTERS[kind]
                if tags.get(key) in values.split("|")
            ),
            kind,
        )
        found.append(
            {
                "source_id": f"osm:{element['type']}/{element['id']}",
                "name": name,
                "kind": clean_text(matched, 40) or kind,
                "latitude": point[0],
                "longitude": point[1],
                "distance_km": _distance(origin, point),
                "notable": bool(tags.get("wikidata") or tags.get("wikipedia")),
            }
        )
    return _ranked(found)


def parse_opentripmap(body: object, centre: tuple[float, float]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for item in body if isinstance(body, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("xid"), str):
            continue
        name = clean_text(item.get("name"), MAX_NAME)
        given = item.get("point")
        raw_point: dict[str, Any] = given if isinstance(given, dict) else {}
        point = _point(raw_point.get("lat"), raw_point.get("lon"))
        if not name or point is None:
            continue
        listed = item.get("kinds")
        kinds = listed if isinstance(listed, str) else ""
        rate = item.get("rate")
        found.append(
            {
                "source_id": f"otm:{clean_text(item['xid'], 60)}",
                "name": name,
                "kind": clean_text(kinds.split(",")[0], 40) or "place",
                "latitude": point[0],
                "longitude": point[1],
                "distance_km": _distance(centre, point),
                "notable": bool(item.get("wikidata")),
                "rate": rate if isinstance(rate, int) and not isinstance(rate, bool) else 0,
            }
        )
    return _ranked(found)


async def overpass_places(
    url: str, *, latitude: float, longitude: float, kind: PlaceKind, agent: str = PRODUCT
) -> list[dict[str, Any]]:
    slot = _overpass_slot()
    try:
        async with asyncio.timeout(OVERPASS_SLOT_WAIT_S):
            await slot.acquire()
    except TimeoutError:
        raise ToolError("unavailable", UNAVAILABLE) from None
    try:
        body = await fetch_json(
            "overpass",
            "POST",
            url,
            data={"data": overpass_query(kind, latitude, longitude)},
            headers={"User-Agent": agent},
            unavailable=UNAVAILABLE,
            deadline_s=OVERPASS_SERVER_TIMEOUT_S + 3.0,
        )
    finally:
        slot.release()
    return parse_overpass(body, kind, (latitude, longitude))


async def opentripmap_places(
    key: SecretStr,
    *,
    latitude: float,
    longitude: float,
    kind: PlaceKind,
    agent: str = PRODUCT,
) -> list[dict[str, Any]]:
    """OpenTripMap's radius search. The key travels in the query string: the URL is never
    logged (fetch_json logs only the error type and status)."""
    body = await fetch_json(
        "opentripmap",
        "GET",
        OPENTRIPMAP_URL,
        params={
            "radius": str(radius_m(kind)),
            "lon": _coord(longitude),
            "lat": _coord(latitude),
            "kinds": OPENTRIPMAP_KINDS[kind],
            "rate": "1",
            "format": "json",
            "limit": "50",
            "apikey": key.get_secret_value(),
        },
        headers={"User-Agent": agent},
        unavailable=UNAVAILABLE,
        deadline_s=8.0,
    )
    return parse_opentripmap(body, (latitude, longitude))


class FindPlacesArgs(Args):
    destination: str = Field(
        min_length=2, max_length=100, description="City, area or 3-letter airport code."
    )
    kind: PlaceKind = Field("sights", description="What sort of place.")
    limit: int = Field(6, ge=1, le=10, description="How many places, at most 10.")


async def find_places(ctx: RunContext, args: FindPlacesArgs) -> dict[str, Any]:
    where = await resolve(ctx, args.destination, city_centre=True)
    key = ctx.settings.opentripmap_key
    source = "opentripmap" if key is not None else "openstreetmap"
    agent = user_agent(ctx.settings)

    async def load() -> list[dict[str, Any]]:
        if key is not None:
            return await opentripmap_places(
                key, latitude=where.latitude, longitude=where.longitude, kind=args.kind, agent=agent
            )
        return await overpass_places(
            ctx.settings.osm_overpass_url,
            latitude=where.latitude,
            longitude=where.longitude,
            kind=args.kind,
            agent=agent,
        )

    found = await cached(
        ctx.redis,
        cache_key("places", source, args.kind, _coord(where.latitude), _coord(where.longitude)),
        DAY_S,
        load,
    )
    cards = []
    for place in found[: args.limit]:
        card = {k: v for k, v in place.items() if k != "source_id"} | {"source": source}
        item = ctx.memory.remember(
            "place", place["source_id"], label=place["name"], price=None, card=card
        )
        cards.append(item.card)
    return {
        "destination": {
            "name": where.name,
            "latitude": where.latitude,
            "longitude": where.longitude,
        },
        "kind": args.kind,
        "source": source,
        "attribution": OTM_ATTRIBUTION if key is not None else OSM_ATTRIBUTION,
        "places": cards,
    }
