/**
 * Time zones offered in Settings: a short list of the zones agencies actually work in (and the agency's
 * own, whatever it is), each labelled with its current UTC offset and ordered west to east.
 */
const COMMON_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik",
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Africa/Lagos",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Nairobi",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Tehran",
  "Asia/Dubai",
  "Indian/Mauritius",
  "Asia/Karachi",
  "Indian/Maldives",
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Manila",
  "Australia/Perth",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
] as const;

export type TimeZoneOption = { value: string; label: string; offsetMinutes: number };

/** The zones this browser lists (canonical names, e.g. "Asia/Calcutta"), or null when it can't say. */
function supportedZones(): Set<string> | null {
  try {
    return new Set(Intl.supportedValuesOf("timeZone"));
  } catch {
    return null;
  }
}

/** The browser's canonical name for a zone ("Asia/Kolkata" may resolve to "Asia/Calcutta"). */
function canonical(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Minutes east of UTC at `at`, or null for a zone the browser can't format (an unknown name). */
function offsetMinutes(zone: string, at: Date): number | null {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return null;
  }
  if (!name) return null;
  const match = /^GMT(?:([+-−])(\d{1,2}):?(\d{2})?)?$/.exec(name);
  if (!match) return null;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const size = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(size / 60)).padStart(2, "0")}:${String(size % 60).padStart(2, "0")}`;
}

/**
 * The common zones the browser lists in `Intl.supportedValuesOf("timeZone")` (matched through their
 * canonical names, so "Asia/Kolkata" counts when the list says "Asia/Calcutta"), plus `current`, each
 * labelled with its offset at `now`, so daylight saving shows as it is today. Without the list, every
 * common zone the browser can format is offered.
 */
export function timeZoneOptions(current: string, now: Date = new Date()): TimeZoneOption[] {
  const supported = supportedZones();
  const listed = (zone: string) => {
    const name = canonical(zone);
    // Some browsers leave UTC itself out of the list.
    return name !== null && (supported === null || zone === "UTC" || supported.has(zone) || supported.has(name));
  };
  const options: TimeZoneOption[] = [];
  for (const zone of new Set<string>([...COMMON_ZONES.filter(listed), current])) {
    const offset = offsetMinutes(zone, now);
    if (offset === null) continue;
    options.push({ value: zone, label: `(${offsetLabel(offset)}) ${zone}`, offsetMinutes: offset });
  }
  return options.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value));
}
