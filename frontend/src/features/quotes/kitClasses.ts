/** Class recipes shared by the quote, client and team screens (kit card tool rows and flush tables). */

/** First and last columns line up with the card's 18px padding. */
export const TABLE_INSET = "[&_:is(th,td):first-child]:pl-[18px] [&_:is(th,td):last-child]:pr-[18px]";

/** The kit's `.input`, compact for a card's tool row, with room for a leading search icon. */
export const SEARCH_INPUT = "input h-9 py-0 pl-8 pr-2.5 text-[13px] placeholder:text-faint";
