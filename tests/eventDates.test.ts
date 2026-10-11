import { describe, expect, it } from "vitest";
import { cleanDateAnswers, cleanDateOptions, isDatePoll } from "../shared/eventDates";
import { eventWhen } from "../src/components/events/eventText";
import { checkInOpen, needsRegister, registerOpen } from "../shared/events";

const one = { id: "one", startsAt: "2026-11-01T19:00:00+08:00", endsAt: "2026-11-01T20:00:00+08:00" };
const two = { id: "two", startsAt: "2026-11-03T19:00:00+08:00", endsAt: null };
describe("proposed event dates", () => {
  it("normalizes and sorts dates on the Hong Kong clock without changing their stable IDs", () => {
    expect(cleanDateOptions([two, one])).toEqual([
      { ...one, startsAt: "2026-11-01T11:00:00.000Z", endsAt: "2026-11-01T12:00:00.000Z" },
      { ...two, startsAt: "2026-11-03T11:00:00.000Z" },
    ]);
  });
  it.each([null, [one], Array(7).fill(one), [one, one], [one, { ...two, id: "one" }], [one, { ...two, startsAt: one.startsAt }], [one, { ...two, startsAt: "invalid" }], [one, { ...two, endsAt: "2026-11-03T10:00:00Z" }], [one, { ...two, id: "__proto__" }]])("refuses incomplete, duplicate or invalid options: %j", (raw) => {
    expect(typeof cleanDateOptions(raw)).toBe("string");
  });
  it("requires every current date to be answered and keeps No explicit", () => {
    expect(cleanDateAnswers({ one: "available", two: "unavailable" }, [one, two])).toEqual({ one: "available", two: "unavailable" });
    expect(cleanDateAnswers({ one: "available" }, [one, two])).toMatch(/each/);
    expect(cleanDateAnswers({ one: "available", two: "maybe", old: "available" }, [one, two])).toMatch(/changed/);
    expect(cleanDateAnswers({ one: "going", two: "maybe" }, [one, two])).toMatch(/each/);
  });
  it("does not present a proposed date as settled or open a check-in/register", () => {
    const event = { status: "published" as const, startsAt: one.startsAt, endsAt: one.endsAt, dateOptions: [one, two], chosenDateId: null, registerTakenAt: null };
    const after = Date.parse("2026-11-02T00:00:00Z");
    expect(isDatePoll(event)).toBe(true);
    expect(eventWhen(event)).toBe("Date to be agreed · 2 options");
    expect(registerOpen(event, after)).toBe(false);
    expect(checkInOpen(event, after)).toBe(false);
    expect(needsRegister(event, after)).toBe(false);
    expect(eventWhen({ ...event, chosenDateId: "one" })).toMatch(/Sun 1 Nov/);
  });
});
