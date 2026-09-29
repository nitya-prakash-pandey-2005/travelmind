import json
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from rapidfuzz import fuzz, process

@dataclass
class FareRecord:
    record_id: str
    supplier: str
    supplier_type: str
    flight_number: str
    airline_name: str
    origin_iata: str
    origin_city: str
    destination_iata: str
    destination_city: str
    departure_date: str
    departure_time: str
    cabin_class: str
    total_fare_inr: int
    seats_available: int
    baggage_included: bool
    refundable: bool
    negotiable: bool
    raw_text: str
    embedding_text: str

    def build_embedding_text(self):
        self.embedding_text = (
            f"Flight {self.airline_name} {self.flight_number} from {self.origin_city} ({self.origin_iata}) "
            f"to {self.destination_city} ({self.destination_iata}) on {self.departure_date} at {self.departure_time}. "
            f"Class: {self.cabin_class}. Fare: INR {self.total_fare_inr}. "
            f"Seats: {self.seats_available}. Baggage: {'Included' if self.baggage_included else 'Not included'}. "
            f"Refundable: {'Yes' if self.refundable else 'No'}. Negotiable: {'Yes' if self.negotiable else 'No'}."
        )

# Simple dictionaries; ideally loaded from airports.dat via build_city_to_iata
CITY_TO_IATA = {
    "Delhi": "DEL", "New Delhi": "DEL", "Mumbai": "BOM", "Bombay": "BOM",
    "Bengaluru": "BLR", "Bangalore": "BLR", "Chennai": "MAA", "Madras": "MAA",
    "Kolkata": "CCU", "Calcutta": "CCU", "Hyderabad": "HYD", "Ahmedabad": "AMD",
    "Pune": "PNQ", "Goa": "GOI", "Kochi": "COK", "Cochin": "COK"
}
IATA_TO_CITY = {v: k for k, v in CITY_TO_IATA.items()}

def resolve_city_iata(city_name: str) -> str:
    if city_name in CITY_TO_IATA:
        return CITY_TO_IATA[city_name]
    
    # Fuzzy match
    match = process.extractOne(city_name, list(CITY_TO_IATA.keys()), scorer=fuzz.WRatio)
    if match and match[1] >= 80:
        return CITY_TO_IATA[match[0]]
    return city_name[:3].upper()

def resolve_iata_city(iata_code: str) -> str:
    return IATA_TO_CITY.get(iata_code, iata_code)

def normalize_supplier_a(data: Dict[str, Any], record_id: str) -> FareRecord:
    record = FareRecord(
        record_id=record_id,
        supplier=data["supplier"],
        supplier_type=data["supplier_type"],
        flight_number=data["flight_number"],
        airline_name=data["airline_name"],
        origin_iata=data["origin"],
        origin_city=resolve_iata_city(data["origin"]),
        destination_iata=data["destination"],
        destination_city=resolve_iata_city(data["destination"]),
        departure_date=data["departure_date"],
        departure_time=data["departure_time"],
        cabin_class=data["cabin_class"],
        total_fare_inr=data["total_fare_inr"],
        seats_available=data["seats_available"],
        baggage_included=data["baggage_included"],
        refundable=data["refundable"],
        negotiable=data.get("negotiated_discount_available", False),
        raw_text=data["raw_text"],
        embedding_text=""
    )
    record.build_embedding_text()
    return record

def normalize_supplier_b(data: Dict[str, Any], record_id: str) -> FareRecord:
    record = FareRecord(
        record_id=record_id,
        supplier=data["supplier"],
        supplier_type=data["supplier_type"],
        flight_number=data["flight_number"],
        airline_name=data["airline"],
        origin_iata=resolve_city_iata(data["from"]),
        origin_city=data["from"],
        destination_iata=resolve_city_iata(data["to"]),
        destination_city=data["to"],
        departure_date=data["date"],
        departure_time=data["departs"],
        cabin_class="Economy", # LCC default
        total_fare_inr=data["total_payable"],
        seats_available=data["seats_left"],
        baggage_included=any("bag" in a.lower() for a in data.get("add_ons", [])),
        refundable=False,
        negotiable=False,
        raw_text=data["raw_text"],
        embedding_text=""
    )
    # LCC might have class info in raw text, simple heuristics
    if "premium" in data["raw_text"].lower():
        record.cabin_class = "Premium Economy"
        
    record.build_embedding_text()
    return record

def normalize_supplier_c(data: Dict[str, Any], record_id: str) -> FareRecord:
    record = FareRecord(
        record_id=record_id,
        supplier=data["supplier"],
        supplier_type=data["supplier_type"],
        flight_number=data["flight"],
        airline_name=data["carrier"],
        origin_iata=data["origin_iata"],
        origin_city=data["origin_city"],
        destination_iata=data["destination_iata"],
        destination_city=data["destination_city"],
        departure_date=data["travel_date"],
        departure_time=data["departure"],
        cabin_class=data["class_of_travel"],
        total_fare_inr=data["final_fare"],
        seats_available=data["seats_remaining"],
        baggage_included=any("baggage" in i.lower() for i in data.get("inclusions", [])),
        refundable=True,
        negotiable=data.get("negotiable", False),
        raw_text=data["raw_text"],
        embedding_text=""
    )
    record.build_embedding_text()
    return record

def normalize_records(raw_records: List[Dict[str, Any]]) -> List[FareRecord]:
    normalized = []
    for i, data in enumerate(raw_records):
        record_id = f"REC_{i:05d}"
        if data["supplier"] == "SupplierA":
            normalized.append(normalize_supplier_a(data, record_id))
        elif data["supplier"] == "SupplierB":
            normalized.append(normalize_supplier_b(data, record_id))
        elif data["supplier"] == "SupplierC":
            normalized.append(normalize_supplier_c(data, record_id))
    return normalized
