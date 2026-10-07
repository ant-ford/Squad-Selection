import { describe, it, expect } from "vitest";
import { POS_SHORT } from "../shared/positions";
import { POS_SHORT as APP_POS_SHORT } from "../src/lib/format";

describe("POS_SHORT", () => {
  it("abbreviates every playing position", () => {
    expect(POS_SHORT).toEqual({ Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Forward: "FWD", "Flexible/Varies": "FLEX" });
  });

  it("is the one the app uses", () => {
    expect(APP_POS_SHORT).toBe(POS_SHORT);
  });

  // The coach's selected-position summary had its own four-entry map with
  // "FLEX" for anything else; the shared map gives the same keys.
  it("gives the coach summary the same keys as its old map", () => {
    const OLD: Record<string, string> = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Forward: "FWD" };
    for (const position of ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible/Varies", "", "Sweeper"]) {
      expect(POS_SHORT[position] ?? "FLEX").toBe(OLD[position] ?? "FLEX");
    }
  });
});
