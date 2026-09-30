# Supplier API reference (researched 2026-09-29)

Working notes for the supplier adapters. Every item was checked against the official docs linked; **[UNVERIFIED]** marks what couldn't be confirmed — code must handle those defensively.

## Duffel Flights API — `https://api.duffel.com`

Headers ([making requests](https://duffel.com/docs/api/overview/making-requests)):
```
Authorization: Bearer <token>     # test tokens start with "duffel_test_"
Duffel-Version: v2                # current version (v1 sunset 2025-01-23)
Accept: application/json
Accept-Encoding: gzip
Content-Type: application/json
```

**Search** — `POST /air/offer_requests?return_offers=true&supplier_timeout=<ms>` ([create offer request](https://duffel.com/docs/api/v2/offer-requests/create-offer-request)). `supplier_timeout` is milliseconds, default 20000, range 2000–60000.
```json
{"data":{"slices":[{"origin":"DEL","destination":"BOM","departure_date":"2026-11-20"}],
         "passengers":[{"type":"adult"},{"age":8}],
         "cabin_class":"economy","max_connections":1}}
```
Passengers carry either `type` (adult, young_adult, child, infant, student) or `age`, not both. Response: `data.id`, `data.live_mode`, `data.offers[]`.

**Offer shape** ([offer schema](https://duffel.com/docs/api/v2/offers/schema)) — amounts are **strings** (parse as Decimal); `tax_amount` and `total_emissions_kg` may be null; `departing_at`/`arriving_at` are **local airport time without offset**:
```json
{"id":"off_00009htYpSCXrwaB9DnUm0","live_mode":false,
 "total_amount":"45.00","total_currency":"GBP","base_amount":"30.20","base_currency":"GBP",
 "tax_amount":"14.80","tax_currency":"GBP","total_emissions_kg":"460",
 "expires_at":"2026-11-01T10:42:14.545Z","owner":{"name":"British Airways","iata_code":"BA"},
 "conditions":{"refund_before_departure":{"allowed":true,"penalty_amount":"100.00","penalty_currency":"GBP"},
               "change_before_departure":{"allowed":true,"penalty_amount":"100.00","penalty_currency":"GBP"}},
 "passengers":[{"id":"pas_1","type":"adult"}],
 "slices":[{"fare_brand_name":"Basic","duration":"PT7H40M","origin":{"iata_code":"LHR"},"destination":{"iata_code":"JFK"},
   "segments":[{"origin":{"iata_code":"LHR"},"destination":{"iata_code":"JFK"},
     "departing_at":"2026-11-20T09:15:00","arriving_at":"2026-11-20T11:55:00","duration":"PT7H40M",
     "marketing_carrier":{"iata_code":"BA","name":"British Airways"},"marketing_carrier_flight_number":"117",
     "operating_carrier":{"iata_code":"BA","name":"British Airways"},"operating_carrier_flight_number":"117",
     "passengers":[{"passenger_id":"pas_1","cabin_class":"economy","cabin_class_marketing_name":"Economy Basic",
                    "baggages":[{"type":"checked","quantity":1},{"type":"carry_on","quantity":1}]}]}]}]}
```
`total_emissions_kg` semantics (whole offer vs per passenger) **[UNVERIFIED]** — we divide by passenger count and label the value "supplier estimate".

**Re-price** — `GET /air/offers/{id}?return_available_services=false` returns the current price (may differ from search). `POST /air/offers/{id}/actions/price` exists for payment-method-specific totals at booking time (not used for display).

**Errors** ([errors](https://duffel.com/docs/api/overview/errors)): `{"errors":[{"type","code","title","message","source"}],"meta":{"request_id","status"}}`. Types: `authentication_error` (401/403), `validation_error` (422), `invalid_request_error` (400/404/422, e.g. `not_found`), `rate_limit_error` (429), `airline_error` (422/502/504, e.g. `offer_no_longer_available`, `price_changed`), `invalid_state_error` (422, `offer_expired`), `api_error` (5xx).

**Rate limit**: 60 requests / 60 s (subject to change); headers `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`.

**Test mode**: test token from the dashboard ("Developer test mode"); results include **Duffel Airways (`ZZ`)** — no realistic schedules/prices — and sometimes real airline sandboxes; `live_mode` is false. Live mode needs email + business (KYC) verification.

## LiteAPI (hotels) — `https://api.liteapi.travel/v3.0`

Auth header `X-API-Key: <key>`; sandbox keys start with `sand_` ([auth](https://docs.liteapi.travel/reference/authentication)).

**Search rates** — `POST /hotels/rates` ([reference](https://docs.liteapi.travel/reference/post_hotels-rates)). Required: `checkin`, `checkout` (YYYY-MM-DD), `currency`, `guestNationality` (ISO-2), `occupancies` (one `{adults, children:[ages]}` per room — **do not send `rooms`**), plus one locator: `hotelIds[]`, `cityName`+`countryCode`, `latitude`+`longitude`+`radius` (metres), `iataCode`, `placeId`. Optional: `timeout` (seconds, 4–10 recommended), `limit`, `maxRatesPerHotel`, `includeHotelData` (needed for non-city searches to get `hotels[]`), `refundableRatesOnly`, `boardType`.
```json
{"data":[{"hotelId":"lp1897","roomTypes":[{"offerId":"...","offerRetailRate":{"amount":163.66,"currency":"USD"},
   "rates":[{"rateId":"...","name":"Standard King Room","boardType":"RO","boardName":"Room Only",
     "retailRate":{"total":[{"amount":163.66,"currency":"USD"}]},
     "cancellationPolicies":{"refundableTag":"RFN","cancelPolicyInfos":[{"cancelTime":"2026-07-30 02:00:00","amount":163.66,"currency":"USD","type":"amount","timezone":"GMT"}]}}]}]}],
 "sandbox":true,
 "hotels":[{"id":"lp1897","name":"…","address":"…","stars":4,"rating":8.5,"main_photo":"https://…"}]}
```
Amounts are **numbers**; `retailRate.total` is an array; `refundableTag` is `RFN`/`NRFN`. Errors: 400/401/429/5xx; 429 body `{"error":{"code":429,"message":"…"}}`. A 200 response carrying `{"error":{"code":2001,"message":"no availability found"}}` and no `data` **[UNVERIFIED, reported by third parties]** — treat any top-level `error` as an error, and code 2001 as "no rooms". Sandbox: 5 req/s.

## Google Travel Impact Model — `https://travelimpactmodel.googleapis.com/v1`

Free; API key as `?key=`; data licensed CC BY-SA 4.0 (attribute "Google Travel Impact Model").

- `POST /flights:computeFlightEmissions` — `{"flights":[{"origin":"ZRH","destination":"CDG","operatingCarrierCode":"AF","flightNumber":1115,"departureDate":{"year":2027,"month":6,"day":22}}]}` (≤1000 legs; `flightNumber` is an integer). Response `flightEmissions[]` in request order, each with `emissionsGramsPerPax.{economy,premiumEconomy,business,first}`; **unknown flights come back (HTTP 200) without `emissionsGramsPerPax`**.
- `POST /flights:computeTypicalFlightEmissions` — `{"markets":[{"origin":"ZRH","destination":"BOS"}]}` → `typicalFlightEmissions[]` with `market` and `emissionsGramsPerPax` (missing for unknown markets).
- Quotas: not published officially **[UNVERIFIED ~60 req/min]**.

## Travelpayouts / Aviasales Data API (cached prices)

`GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates` with header `X-Access-Token`. Params: `origin`, `destination` (IATA), `departure_at` (YYYY-MM or YYYY-MM-DD), `one_way=true`, `direct`, `currency` (lowercase, e.g. `inr`), `market` (e.g. `in` — pass explicitly), `limit` (≤1000), `sorting=price`. Response `{"success":true,"data":[{"price":5929,"airline":"IB","flight_number":"3002","departure_at":"2026-07-28T07:00:00+02:00","transfers":0,"duration":165,...}],"currency":"inr"}`. Prices come from real users' searches in the last 48 h — **indications only, not bookable**; label as CACHED. Rate limit 600/min for this endpoint; cache results ~24 h. Terms for closed B2B display without affiliate click-out **[UNVERIFIED]** — review before production use.

## ECB reference exchange rates

`GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` — free, no key, published each working day ~16:00 CET; rates are EUR-based (`<Cube currency="USD" rate="1.0850"/>`). Used only to show approximate converted prices ("≈ ₹"), never to price a booking.
