import pandas as pd
import json
import random
from pathlib import Path
from loguru import logger

def build_city_to_iata(raw_dir: Path) -> dict:
    airports_file = raw_dir / "airports.dat"
    city_to_iata = {}
    if airports_file.exists():
        # OpenFlights airports format: 
        # ID, Name, City, Country, IATA, ICAO, Lat, Long, Alt, TZ, DST, Tz_DB, Type, Source
        try:
            df_airports = pd.read_csv(airports_file, header=None, on_bad_lines='skip',
                                      names=["ID", "Name", "City", "Country", "IATA", "ICAO", 
                                             "Lat", "Long", "Alt", "TZ", "DST", "Tz_DB", "Type", "Source"])
            df_airports = df_airports[(df_airports["Country"] == "India") & (df_airports["IATA"] != "\\N")]
            for _, row in df_airports.iterrows():
                city = str(row["City"]).strip()
                iata = str(row["IATA"]).strip()
                city_to_iata[city] = iata
        except Exception as e:
            logger.warning(f"Error parsing airports.dat: {e}")
            
    # Fallback/overrides for Indian cities
    overrides = {
        "Delhi": "DEL", "Mumbai": "BOM", "Bengaluru": "BLR", "Bangalore": "BLR",
        "Chennai": "MAA", "Kolkata": "CCU", "Hyderabad": "HYD",
        "Goa": "GOI", "Kochi": "COK", "Pune": "PNQ", "Ahmedabad": "AMD"
    }
    city_to_iata.update(overrides)
    return city_to_iata

def generate_supplier_data(df: pd.DataFrame, city_to_iata: dict) -> list:
    records = []
    logger.info(f"Generating supplier data from {len(df)} base records...")
    
    # We will sample 3,000 records to keep it manageable but substantial
    if len(df) > 3000:
        df = df.sample(3000, random_state=42)
        
    for idx, row in df.iterrows():
        airline = row.get("airline", "Unknown")
        flight = row.get("flight", f"{airline[:2].upper()}{random.randint(100, 999)}")
        src_city = row.get("source_city", "").title()
        dest_city = row.get("destination_city", "").title()
        dep_time = row.get("departure_time", "Morning") 
        # we'll map Morning/Evening to times
        time_map = {"Early_Morning": "05:00", "Morning": "09:00", "Afternoon": "14:00", "Evening": "19:00", "Night": "22:00", "Late_Night": "02:00"}
        dep_time_str = time_map.get(dep_time, "10:00")
        
        cabin_class = row.get("class", "Economy")
        base_price = row.get("price", 5000)
        
        date_str = "2026-07-20"  # Fixed future date for predictability
        src_iata = city_to_iata.get(src_city, src_city[:3].upper())
        dest_iata = city_to_iata.get(dest_city, dest_city[:3].upper())

        # SupplierA: GDS Style (IATA codes, split fare)
        record_a = {
            "supplier": "SupplierA",
            "supplier_type": "GDS",
            "flight_number": flight,
            "airline_name": airline,
            "origin": src_iata,
            "destination": dest_iata,
            "departure_date": date_str,
            "departure_time": dep_time_str,
            "cabin_class": cabin_class,
            "fare_basis_code": "YFLEX" if cabin_class == "Economy" else "JBAS",
            "base_fare_inr": int(base_price * 0.8),
            "taxes_inr": int(base_price * 0.2),
            "total_fare_inr": int(base_price),
            "seats_available": random.randint(1, 9),
            "baggage_included": cabin_class != "Economy",
            "refundable": True,
            "negotiated_discount_available": True,
            "raw_text": f"GDS {airline} {flight} {src_iata}-{dest_iata} {date_str} {dep_time_str} {cabin_class} INR {base_price}"
        }
        
        # SupplierB: LCC Style (City names, convenience fee)
        lcc_price = int(base_price * 0.95)
        record_b = {
            "supplier": "SupplierB",
            "supplier_type": "LCC",
            "flight_number": flight,
            "airline": airline,
            "from": src_city,
            "to": dest_city,
            "date": date_str,
            "departs": dep_time_str,
            "fare": int(lcc_price * 0.9),
            "convenience_fee": int(lcc_price * 0.1),
            "total_payable": lcc_price,
            "seats_left": random.randint(1, 6),
            "add_ons": ["cabin bag included"] if cabin_class == "Economy" else ["meals", "priority"],
            "raw_text": f"{airline} | {src_city} -> {dest_city} on {date_str} {dep_time_str} ({cabin_class})"
        }
        
        # SupplierC: OTA Style (Markup, inclusions, negotiable)
        ota_price = int(base_price * 1.15)
        record_c = {
            "supplier": "SupplierC",
            "supplier_type": "OTA",
            "flight": flight,
            "carrier": airline,
            "origin_city": src_city,
            "origin_iata": src_iata,
            "destination_city": dest_city,
            "destination_iata": dest_iata,
            "travel_date": date_str,
            "departure": dep_time_str,
            "class_of_travel": cabin_class,
            "published_fare": ota_price + 1000,
            "bundle_discount": 1000,
            "final_fare": ota_price,
            "seats_remaining": random.randint(1, 4),
            "inclusions": ["lounge access"] if cabin_class != "Economy" else ["20kg check-in"],
            "negotiable": True,
            "raw_text": f"Book {airline} flight {flight} from {src_city} to {dest_city}. Fare: {ota_price}"
        }
        
        records.extend([record_a, record_b, record_c])
        
    return records

if __name__ == "__main__":
    raw_dir = Path("data/raw")
    processed_dir = Path("data/processed")
    processed_dir.mkdir(parents=True, exist_ok=True)
    
    city_to_iata = build_city_to_iata(raw_dir)
    
    kaggle_csv = raw_dir / "Clean_Dataset.csv"
    if not kaggle_csv.exists():
        logger.error(f"Cannot find {kaggle_csv}. Did you run download_open_data.py successfully?")
        # Creating a small fallback mock dataset if Kaggle file missing
        logger.warning("Generating fallback mock data since real data is missing.")
        df = pd.DataFrame([
            {"airline": "IndiGo", "flight": "6E201", "source_city": "Delhi", "destination_city": "Mumbai", "departure_time": "Morning", "class": "Economy", "price": 4500},
            {"airline": "SpiceJet", "flight": "SG301", "source_city": "Mumbai", "destination_city": "Bangalore", "departure_time": "Afternoon", "class": "Economy", "price": 3200},
            {"airline": "Air India", "flight": "AI501", "source_city": "Chennai", "destination_city": "Delhi", "departure_time": "Evening", "class": "Business", "price": 18000},
        ])
    else:
        df = pd.read_csv(kaggle_csv)
        
    supplier_records = generate_supplier_data(df, city_to_iata)
    
    output_path = processed_dir / "fares.json"
    with open(output_path, "w") as f:
        json.dump(supplier_records, f, indent=2)
        
    logger.info(f"Saved {len(supplier_records)} supplier records to {output_path}")
