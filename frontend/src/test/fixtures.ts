import type { Agency, Airport, Me } from "../api/types";

const ALPHA: Agency = {
  id: "a-alpha",
  name: "Alpha Travels",
  country_code: "IN",
  currency: "INR",
  timezone: "Asia/Kolkata",
  brand_color: "#22d3ee",
  is_demo: false,
};

export const ME_OWNER: Me = {
  user: { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  agency: ALPHA,
};

/** The owner of a demo workspace: same people, sample data, clearly labelled. */
export const ME_DEMO: Me = {
  ...ME_OWNER,
  agency: { ...ALPHA, is_demo: true },
};

export const ME_AGENT: Me = {
  user: { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
  agency: ALPHA,
};

function airport(
  iata_code: string,
  name: string,
  city: string,
  country_code: string,
  country_name: string,
  latitude: number,
  longitude: number,
): Airport {
  return { iata_code, name, city, country_code, country_name, latitude, longitude };
}

export const AIRPORTS = {
  DEL: airport("DEL", "Indira Gandhi International Airport", "New Delhi", "IN", "India", 28.5665, 77.103104),
  BOM: airport("BOM", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "IN", "India", 19.0887, 72.8679),
  GOI: airport("GOI", "Goa Dabolim International Airport", "Vasco da Gama", "IN", "India", 15.3808, 73.8314),
  GOX: airport("GOX", "Manohar International Airport", "Mopa", "IN", "India", 15.7442, 73.8606),
  LHR: airport("LHR", "London Heathrow Airport", "London", "GB", "United Kingdom", 51.4706, -0.461941),
  JFK: airport("JFK", "John F Kennedy International Airport", "New York", "US", "United States", 40.639801, -73.7789),
} satisfies Record<string, Airport>;

/** A user of a different agency, for checks that one agency's data never reaches another. */
export const ME_BETA: Me = {
  user: { id: "u-beta", email: "meera@betatours.in", full_name: "Meera Iyer", role: "owner" },
  agency: {
    id: "a-beta",
    name: "Beta Tours",
    country_code: "IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    brand_color: "#a78bfa",
    is_demo: false,
  },
};
