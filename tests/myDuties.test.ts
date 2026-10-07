import { describe, expect, it } from "vitest";
import { dutyChangeText, nextDuty, type MyDuty } from "../worker/src/myDuties";
import { formatDutyVEvent } from "../worker/src/calendar";

const duty = (more: Partial<MyDuty> = {}): MyDuty => ({
  assignmentId: "00000000-0000-4000-8000-000000000001", dutyId: "d1",
  matchDate: "2026-10-10T01:00:00.000Z", timeTbc: false, venue: "HKFC", homeTeam: "Pak A", awayTeam: "HKFC C",
  slot: 1, dutyTeam: "HKFC D", status: "scheduled", previousMatchDate: null, changedAt: null, unseenChange: false, movedTo: null,
  ...more,
});

describe("an umpire's duties", () => {
  it("says nothing about a duty that hasn't changed, or whose change they've seen", () => {
    expect(dutyChangeText(duty())).toBeNull();
    expect(dutyChangeText(duty({ previousMatchDate: "2026-10-10T00:00:00.000Z", unseenChange: false }))).toBeNull();
  });

  it("words a new time the same day, and a new day", () => {
    expect(dutyChangeText(duty({ previousMatchDate: "2026-10-10T00:00:00.000Z", unseenChange: true }))).toBe(
      "Your duty moved: Pak A vs HKFC C, 08:00 → 09:00",
    );
    expect(dutyChangeText(duty({ previousMatchDate: "2026-10-03T01:00:00.000Z", unseenChange: true }))).toBe(
      "Your duty moved: Pak A vs HKFC C, Sat 3 Oct, 09:00 → Sat 10 Oct, 09:00",
    );
  });

  it("words a called-off duty, with the slot's new date when there is one", () => {
    expect(dutyChangeText(duty({ status: "cancelled", unseenChange: true }))).toBe("Your duty on Sat 10 Oct (Pak A vs HKFC C) is off");
    expect(dutyChangeText(duty({ status: "rescheduled", unseenChange: true, movedTo: "2026-12-13T08:30:00.000Z" }))).toBe(
      "Your duty on Sat 10 Oct (Pak A vs HKFC C) is postponed: now Sun 13 Dec, take it again on the board",
    );
  });

  it("finds the next duty still on within two weeks", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const off = duty({ dutyId: "off", status: "cancelled", matchDate: "2026-10-09T01:00:00.000Z" });
    const next = duty({ dutyId: "next" });
    expect(nextDuty([off, next], now)?.dutyId).toBe("next");
    expect(nextDuty([duty({ matchDate: "2026-10-30T01:00:00.000Z" })], now)).toBeNull();
  });

  it("puts a duty in the calendar, and a called-off one as CANCELLED", () => {
    const on = formatDutyVEvent(duty(), "https://app.eddy.global", new Date("2026-10-08T00:00:00Z"));
    expect(on).toContain("SUMMARY:Umpiring: Pak A vs HKFC C");
    expect(on).toContain("DTSTART;TZID=Asia/Hong_Kong:20261010T090000");
    expect(on).toContain("STATUS:CONFIRMED");
    expect(on).toContain("UID:duty-00000000-0000-4000-8000-000000000001@hkfc-squad-selection");
    const off = formatDutyVEvent(duty({ status: "cancelled" }), "https://app.eddy.global");
    expect(off).toContain("SUMMARY:CANCELLED: Umpiring");
    expect(off).toContain("STATUS:CANCELLED");
  });
});
