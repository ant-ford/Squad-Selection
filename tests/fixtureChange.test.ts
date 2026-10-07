import { describe, expect, it } from "vitest";
import { fixtureChange, fixtureChangeText, isCalledOff } from "../shared/fixtureChange";
import { buildChangeMessage } from "../src/lib/whatsapp";

const now = new Date("2026-10-08T00:00:00Z");
const base = { matchDate: "2026-10-10T06:30:00.000Z", venue: "HKFC", matchStatus: "Scheduled" };

describe("fixture changes", () => {
  it("is nothing without a recent change", () => {
    expect(fixtureChange(base, now)).toBeNull();
    expect(fixtureChange({ ...base, previousVenue: "KP", changedAt: "2026-09-30T00:00:00Z" }, now)).toBeNull(); // 8 days ago
  });

  it("names postponed and cancelled games, which are called off", () => {
    const p = fixtureChange({ ...base, matchStatus: "Rescheduled", changedAt: "2026-10-07T00:00:00Z" }, now)!;
    expect(p.kind).toBe("postponed");
    expect(isCalledOff(p)).toBe(true);
    expect(fixtureChange({ ...base, matchStatus: "Cancelled", changedAt: "2026-10-07T00:00:00Z" }, now)!.kind).toBe("cancelled");
  });

  it("says moved from the old time on the same day, or the old day otherwise", () => {
    const sameDay = fixtureChange({ ...base, previousMatchDate: "2026-10-10T01:00:00.000Z", changedAt: "2026-10-07T00:00:00Z" }, now)!;
    expect(fixtureChangeText(sameDay, base.matchDate)).toBe("Moved from 09:00");
    const otherDay = fixtureChange({ ...base, previousMatchDate: "2026-10-03T06:30:00.000Z", changedAt: "2026-10-07T00:00:00Z" }, now)!;
    expect(fixtureChangeText(otherDay, base.matchDate)).toBe("Moved from Sat 3 Oct");
    expect(isCalledOff(otherDay)).toBe(false);
  });

  it("names a venue change", () => {
    const v = fixtureChange({ ...base, previousVenue: "King's Park", changedAt: "2026-10-07T00:00:00Z" }, now)!;
    expect(fixtureChangeText(v, base.matchDate)).toBe("Venue changed from King's Park");
  });

  it("builds the team-group message", () => {
    const f = { hkfcTeam: "HKFC C", opponent: "Valley B", date: base.matchDate, venue: "HKFC" };
    expect(buildChangeMessage(f)).toBeNull();
    expect(buildChangeMessage({ ...f, change: { kind: "postponed", at: "x" } })).toMatch(/^HKFC C vs Valley B on .* is postponed\./);
    expect(buildChangeMessage({ ...f, change: { kind: "venue", from: "King's Park", at: "x" } })).toMatch(/^Change: HKFC C vs Valley B, .*\(venue changed from King's Park\)\.$/);
  });
});
