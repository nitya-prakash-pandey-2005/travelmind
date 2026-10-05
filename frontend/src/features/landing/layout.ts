/** Shared measurements for the marketing page, so every section lines up on the same grid. */

/** 1240 px content column with 16 / 24 / 32 px gutters. */
export const CONTAINER = "mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8";

/** Section rhythm: 64 px on phones, 88 px from 1024 px. */
export const SECTION_Y = "py-16 lg:py-[88px]";

/** Space Grotesk section titles (the kit's display face). */
export const SECTION_TITLE = "font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[34px]";

export const SECTION_LEAD = "mt-3 max-w-[40rem] text-base leading-7 text-dim";

/** The kit's glass card on the marketing page (blur, 22 px radius, inner highlight). */
export const GLASS = "card";

/** The kit's icon chip: a soft gradient tile with the icon in the accent. */
export const ICON_CHIP =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-line-soft bg-card-2 bg-(image:--tm-grad-soft) text-primary";

/** Anchored sections clear the sticky 56 px nav. */
export const ANCHOR = "scroll-mt-16";
