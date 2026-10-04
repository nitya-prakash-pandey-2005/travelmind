import { PROVENANCE_SECTION, TERM } from "../fares/guides";
import type { GuideSection } from "../fares/ReadingGuide";

/** What each label on a hotel result means, matching the hotel cards word for word. */
export const HOTEL_GUIDE: GuideSection[] = [
  PROVENANCE_SECTION,
  {
    title: "Prices",
    entries: [
      { term: <span className={TERM}>/ night</span>, text: "The stay total divided by the number of nights." },
      { term: <span className={TERM}>for N nights</span>, text: "The whole stay for one room, in your agency's currency." },
      { term: <span className={TERM}>≈</span>, text: "Converted with ECB reference rates. The card also shows the billed amount." },
    ],
  },
  {
    title: "Cancellation terms",
    entries: [
      { term: <span className="text-xs font-medium text-ok">Free cancellation until …</span>, text: "Refundable up to the time the supplier gives." },
      { term: <span className="text-xs font-medium text-ok">Refundable</span>, text: "The supplier says refundable but gives no deadline." },
      { term: <span className="text-xs font-medium text-dim">Non-refundable</span>, text: "No refund once booked." },
      { term: <span className="text-xs font-medium text-faint">Cancellation terms on request</span>, text: "The supplier didn't say. Ask before quoting." },
    ],
  },
];

export const HOTEL_NOTE = "Rooms are searched near the airport you pick, for one room. Terms are shown as the supplier states them, never assumed.";
