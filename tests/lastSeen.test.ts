import { describe, expect, it } from "vitest";
import { notSeenWeeks } from "../worker/src/lastSeen";

describe("not seen", () => {
  it("marks only a player who hasn't answered and hasn't been seen for six weeks", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    expect(notSeenWeeks(daysAgo(43), false, now)).toBe(6);
    expect(notSeenWeeks(daysAgo(70), false, now)).toBe(10);
    expect(notSeenWeeks(daysAgo(41), false, now)).toBeNull();
    expect(notSeenWeeks(daysAgo(70), true, now)).toBeNull(); // answered
    expect(notSeenWeeks(undefined, false, now)).toBeNull(); // not seen since stamping began
  });
});
