import { describe, it, expect } from "vitest";
import { countdownLabel, hkDaysUntil } from "../src/lib/dateUtils";

// Counted in Hong Kong calendar days, not elapsed hours. A 19:00 kick-off
// tonight and a 09:00 one tomorrow are 14 hours apart and must still read as
// different days, which is what a timestamp difference gets wrong.
describe("fixture countdown", () => {
  // 2026-09-10 12:00 UTC = 20:00 Hong Kong, same day.
  const now = new Date("2026-09-10T12:00:00.000Z");

  const at = (iso: string) => countdownLabel(iso, now);

  it("says Today for a fixture later the same Hong Kong day", () => {
    expect(at("2026-09-10T13:00:00.000Z")).toBe("Today");
  });

  it("still says Today for one that already kicked off today", () => {
    expect(at("2026-09-10T02:00:00.000Z")).toBe("Today");
  });

  it("says Tomorrow for the next Hong Kong day, even a few hours later", () => {
    // 2026-09-11 01:00 UTC = 09:00 HK the next day: 13 hours away, but a
    // different day, so "Tomorrow" rather than "Today".
    expect(at("2026-09-11T01:00:00.000Z")).toBe("Tomorrow");
  });

  it("counts whole days beyond that", () => {
    expect(at("2026-09-15T02:00:00.000Z")).toBe("in 5 days");
  });

  it("reads backwards for fixtures already played", () => {
    expect(at("2026-09-09T02:00:00.000Z")).toBe("Yesterday");
    expect(at("2026-09-06T02:00:00.000Z")).toBe("4 days ago");
  });

  it("returns null rather than a wrong label for an unusable date", () => {
    expect(at("")).toBeNull();
    expect(at("not-a-date")).toBeNull();
    expect(hkDaysUntil(undefined, now)).toBeNull();
  });

  // A late-evening HK fixture is the previous day in UTC, which is exactly
  // the case a UTC-based diff gets wrong.
  it("does not slip a day for a late Hong Kong kick-off", () => {
    // 2026-09-11T15:30Z = 23:30 HK on the 11th: tomorrow, not in 2 days.
    expect(at("2026-09-11T15:30:00.000Z")).toBe("Tomorrow");
  });
});
