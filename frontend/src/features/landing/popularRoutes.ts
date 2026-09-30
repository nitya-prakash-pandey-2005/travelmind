import type { Airport } from "../../api/types";
import type { GlobeArc } from "../globe/RouteGlobe";

/** Real airports on busy routes out of our launch markets (India, the Gulf, the UK, the US, Singapore). */
const AIRPORTS = {
  DEL: { iata_code: "DEL", name: "Indira Gandhi International Airport", city: "New Delhi", country_code: "IN", country_name: "India", latitude: 28.5665, longitude: 77.1031 },
  BOM: { iata_code: "BOM", name: "Chhatrapati Shivaji Maharaj International Airport", city: "Mumbai", country_code: "IN", country_name: "India", latitude: 19.0887, longitude: 72.8679 },
  BLR: { iata_code: "BLR", name: "Kempegowda International Airport", city: "Bengaluru", country_code: "IN", country_name: "India", latitude: 13.1986, longitude: 77.7066 },
  DXB: { iata_code: "DXB", name: "Dubai International Airport", city: "Dubai", country_code: "AE", country_name: "United Arab Emirates", latitude: 25.2532, longitude: 55.3657 },
  LHR: { iata_code: "LHR", name: "London Heathrow Airport", city: "London", country_code: "GB", country_name: "United Kingdom", latitude: 51.47, longitude: -0.4543 },
  SIN: { iata_code: "SIN", name: "Singapore Changi Airport", city: "Singapore", country_code: "SG", country_name: "Singapore", latitude: 1.3644, longitude: 103.9915 },
  JFK: { iata_code: "JFK", name: "John F. Kennedy International Airport", city: "New York", country_code: "US", country_name: "United States", latitude: 40.6413, longitude: -73.7781 },
} satisfies Record<string, Airport>;

type Code = keyof typeof AIRPORTS;

const PAIRS: [Code, Code][] = [
  ["DEL", "DXB"],
  ["BOM", "LHR"],
  ["DEL", "SIN"],
  ["BLR", "DXB"],
  ["DXB", "LHR"],
  ["DEL", "JFK"],
  ["LHR", "JFK"],
  ["BOM", "SIN"],
];

/** Illustrative arcs for the landing globe: airports only, no prices or volumes. */
export const POPULAR_ROUTES: GlobeArc[] = PAIRS.map(([from, to]) => ({
  from: AIRPORTS[from],
  to: AIRPORTS[to],
  active: false,
}));
