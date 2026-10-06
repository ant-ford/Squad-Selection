import { describe, expect, it } from "vitest";
import { hkSeasonLabel } from "../src/lib/season";

describe("hkSeasonLabel", () => {
  it("runs July to June", () => {
    expect(hkSeasonLabel(new Date("2026-10-06T04:00:00Z"))).toBe("2026–27");
    expect(hkSeasonLabel(new Date("2027-03-01T04:00:00Z"))).toBe("2026–27");
    expect(hkSeasonLabel(new Date("2026-06-15T04:00:00Z"))).toBe("2025–26");
  });

  it("turns over at midnight on 1 July Hong Kong time, not UTC or the phone's zone", () => {
    // 30 June 15:59 UTC is 23:59 HKT: still last season.
    expect(hkSeasonLabel(new Date("2026-06-30T15:59:00Z"))).toBe("2025–26");
    // 30 June 16:00 UTC is 00:00 HKT on 1 July: the new season, though it is
    // still 30 June in London or New York.
    expect(hkSeasonLabel(new Date("2026-06-30T16:00:00Z"))).toBe("2026–27");
  });

  it("does not turn over early for a phone ahead of Hong Kong", () => {
    // 1 July 00:30 in Auckland (UTC+12) is 30 June 20:30 HKT.
    expect(hkSeasonLabel(new Date("2026-06-30T12:30:00Z"))).toBe("2025–26");
  });

  it("handles the end of the century year", () => {
    expect(hkSeasonLabel(new Date("2099-12-31T04:00:00Z"))).toBe("2099–00");
  });
});
