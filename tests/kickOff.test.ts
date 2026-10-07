import { describe, expect, it } from "vitest";
import { byKickOff, isTbcKickOff } from "../shared/kickOff";

const hk = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`).toISOString();

describe("kick-off order (shared/kickOff.ts)", () => {
  it("reads midnight Hong Kong time, and only that, as TBC", () => {
    expect(isTbcKickOff(hk("2026-10-11", "00:00"))).toBe(true);
    expect(isTbcKickOff("2026-10-10T16:00:00.000Z")).toBe(true); // the same instant in UTC
    expect(isTbcKickOff(hk("2026-10-11", "00:30"))).toBe(false);
    expect(isTbcKickOff(hk("2026-10-10", "23:59"))).toBe(false);
    expect(isTbcKickOff("2026-10-11T00:00:00.000Z")).toBe(false); // 08:00 in Hong Kong
    expect(isTbcKickOff("not a date")).toBe(false);
  });

  it("puts a TBC game after the timed games of its own day, before the next day's", () => {
    const games = [
      hk("2026-10-12", "09:00"),
      hk("2026-10-11", "00:00"), // Sunday, TBC
      hk("2026-10-11", "18:00"),
      hk("2026-10-11", "09:00"),
      hk("2026-10-10", "23:30"),
      hk("2026-10-12", "00:00"), // Monday, TBC
    ];
    expect([...games].sort(byKickOff)).toEqual([
      hk("2026-10-10", "23:30"),
      hk("2026-10-11", "09:00"),
      hk("2026-10-11", "18:00"),
      hk("2026-10-11", "00:00"),
      hk("2026-10-12", "09:00"),
      hk("2026-10-12", "00:00"),
    ]);
  });

  it("orders timed games by the instant, whatever the offset written", () => {
    expect(byKickOff("2026-10-11T09:00:00+08:00", "2026-10-11T02:00:00.000Z")).toBeLessThan(0);
    expect(byKickOff(hk("2026-10-11", "10:45"), hk("2026-10-11", "10:45"))).toBe(0);
  });

  it("keeps a missing date first, as the text sort did", () => {
    expect(["2026-10-11T01:00:00.000Z", "", null].sort(byKickOff)).toEqual(["", null, "2026-10-11T01:00:00.000Z"]);
  });
});
