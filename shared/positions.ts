/**
 * Playing position abbreviations, used wherever a position needs to fit a
 * chip or narrow column. A position not listed here has no abbreviation:
 * callers choose what to show (the coach's summary counts it as "FLEX").
 */
export const POS_SHORT: Record<string, string> = {
  Goalkeeper: "GK",
  Defender: "DEF",
  Midfielder: "MID",
  Forward: "FWD",
  "Flexible/Varies": "FLEX",
};
