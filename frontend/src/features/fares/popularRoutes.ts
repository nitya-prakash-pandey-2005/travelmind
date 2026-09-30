import type { Airport } from "../../api/types";

/** Real airports on busy routes out of India, for the quick picks shown before an agency has its own history. */
export const POPULAR_AIRPORTS = {
  DEL: { iata_code: "DEL", name: "Indira Gandhi International Airport", city: "New Delhi", country_code: "IN", country_name: "India", latitude: 28.5665, longitude: 77.1031 },
  BOM: { iata_code: "BOM", name: "Chhatrapati Shivaji Maharaj International Airport", city: "Mumbai", country_code: "IN", country_name: "India", latitude: 19.0887, longitude: 72.8679 },
  BLR: { iata_code: "BLR", name: "Kempegowda International Airport", city: "Bengaluru", country_code: "IN", country_name: "India", latitude: 13.1986, longitude: 77.7066 },
  HYD: { iata_code: "HYD", name: "Rajiv Gandhi International Airport", city: "Hyderabad", country_code: "IN", country_name: "India", latitude: 17.2403, longitude: 78.4294 },
  GOI: { iata_code: "GOI", name: "Dabolim Airport", city: "Goa", country_code: "IN", country_name: "India", latitude: 15.3808, longitude: 73.8314 },
  DXB: { iata_code: "DXB", name: "Dubai International Airport", city: "Dubai", country_code: "AE", country_name: "United Arab Emirates", latitude: 25.2532, longitude: 55.3657 },
  SIN: { iata_code: "SIN", name: "Singapore Changi Airport", city: "Singapore", country_code: "SG", country_name: "Singapore", latitude: 1.3644, longitude: 103.9915 },
  LHR: { iata_code: "LHR", name: "London Heathrow Airport", city: "London", country_code: "GB", country_name: "United Kingdom", latitude: 51.47, longitude: -0.4543 },
} satisfies Record<string, Airport>;

type Code = keyof typeof POPULAR_AIRPORTS;

const PAIRS: [Code, Code][] = [
  ["DEL", "BOM"],
  ["BOM", "BLR"],
  ["DEL", "BLR"],
  ["BOM", "GOI"],
  ["DEL", "DXB"],
  ["BOM", "DXB"],
  ["BLR", "SIN"],
  ["DEL", "LHR"],
];

/** Busy real routes, used only when this user has no searches of their own yet. No prices or volumes. */
export const POPULAR_ROUTES: { origin: Airport; destination: Airport }[] = PAIRS.map(([from, to]) => ({
  origin: POPULAR_AIRPORTS[from],
  destination: POPULAR_AIRPORTS[to],
}));

/** Busy real hotel destinations (their airports), for the same fallback on hotel search. */
export const POPULAR_DESTINATIONS: Airport[] = (["BOM", "DEL", "BLR", "GOI", "HYD", "DXB", "SIN", "LHR"] as const).map(
  (code) => POPULAR_AIRPORTS[code],
);
