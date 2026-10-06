import { describe, it, expect } from "vitest";
import { hkDateKey } from "../shared/hkDateKey";
import { hkTime, dutyLine } from "../shared/umpiring";
import { formatWhen, formatDay, formatIcsLocalTime } from "../worker/src/calendar";
import { otherGamesThatDay, groupByHkDay } from "../src/lib/sameDayGames";
import type { MyFixture } from "../src/api/getMyFixtures";

// ---------------------------------------------------------------------------
// Hong Kong date formatting without a new Intl.DateTimeFormat per call.
// Building a formatter is the expensive part, and hkDateKey runs thousands
// of times per dashboard render and per my-fixtures request (10 ms Worker
// CPU limit). Every rewrite must give exactly what the old code gave, so
// the old implementations are copied here and compared input by input.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function oldHkDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(d);
}

/** Every hour from 00:00 to 07:59 HKT (16:00-23:59 UTC the day before) of the given HK days, at :00, :30 and :59:59.999. */
function earlyHkHours(firstDayUtc: number, days: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const hkMidnight = firstDayUtc + d * DAY - 8 * HOUR;
    for (let h = 0; h < 8; h++) {
      const at = hkMidnight + h * HOUR;
      out.push(at, at + 30 * 60_000, at + HOUR - 1);
    }
  }
  return out;
}

/** Either side of HK midnight on the 1st of every month, 1980-2060. */
function monthBoundaries(): number[] {
  const out: number[] = [];
  for (let y = 1980; y <= 2060; y++) {
    for (let m = 0; m < 12; m++) {
      const hkMidnight = Date.UTC(y, m, 1) - 8 * HOUR;
      out.push(hkMidnight - 1, hkMidnight);
    }
  }
  return out;
}

/** 28 Feb to 1 Mar around every leap day, 1980-2096 (and 2100, which is not one). */
function leapDays(): number[] {
  const out: number[] = [];
  for (let y = 1980; y <= 2100; y += 4) {
    const start = Date.UTC(y, 1, 28) - 8 * HOUR - HOUR;
    for (let t = start; t <= start + 3 * DAY; t += 6 * HOUR) out.push(t);
  }
  return out;
}

/** Deterministic spread over a wide range, including before HK's last DST (1979). */
function spread(n: number, from: number, to: number): number[] {
  let seed = 20261006;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, () => Math.floor(from + rand() * (to - from)));
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The same instant written with a fixed UTC offset ("...+08:00", "...-05:00"). */
function withOffset(t: number, offsetHours: number): string {
  const d = new Date(t + offsetHours * HOUR);
  const sign = offsetHours < 0 ? "-" : "+";
  return `${d.toISOString().slice(0, 19)}${sign}${pad(Math.abs(offsetHours))}:00`;
}

// The old formatter is slow (that is the point), so these get room to run.
describe("hkDateKey matches the old per-call formatter", { timeout: 60_000 }, () => {
  const instants = [
    ...earlyHkHours(Date.UTC(2025, 11, 25), 20), // across new year
    ...earlyHkHours(Date.UTC(2026, 5, 28), 6), // season boundary (1 July)
    ...earlyHkHours(Date.UTC(2028, 1, 27), 4), // leap day
    ...monthBoundaries(),
    ...leapDays(),
    ...spread(600, Date.UTC(2015, 0, 1), Date.UTC(2035, 0, 1)),
    ...spread(200, Date.UTC(1900, 0, 1), Date.UTC(2200, 0, 1)),
    // HK summer time in the 1970s: these only agree because of the fallback.
    Date.UTC(1975, 5, 15, 15, 30), Date.UTC(1979, 4, 13, 15, 30), Date.UTC(1979, 9, 21, 15, 30),
    Date.UTC(1979, 11, 31, 15, 59, 59, 999), Date.UTC(1979, 11, 31, 16), Date.UTC(1980, 0, 1),
    Date.UTC(1904, 9, 29, 16), Date.UTC(1941, 5, 15, 15, 30), Date.UTC(1945, 8, 1, 15, 30),
    Date.UTC(9998, 11, 31, 16), Date.UTC(9999, 0, 1), Date.UTC(9999, 11, 31, 16),
    0, -1, 8.64e15, -8.64e15,
  ];
  const everyFourth = instants.filter((_, i) => i % 4 === 0 || i >= instants.length - 20);

  it("for ISO strings in UTC", () => {
    const bad = instants
      .map((t) => new Date(t).toISOString())
      .filter((iso) => hkDateKey(iso) !== oldHkDateKey(iso));
    expect(bad).toEqual([]);
  });

  it("for ISO strings with an offset, and without milliseconds", () => {
    const sample = everyFourth.filter((t) => t > Date.UTC(1000, 0, 1) && t < Date.UTC(9000, 0, 1));
    const strings = sample.flatMap((t) => [withOffset(t, 8), withOffset(t, -5), withOffset(t, 0).replace("+00:00", "Z")]);
    expect(strings.filter((iso) => hkDateKey(iso) !== oldHkDateKey(iso))).toEqual([]);
  });

  it("for Date objects and timestamps passed by untyped callers", () => {
    const loose = hkDateKey as (v: unknown) => string;
    const looseOld = oldHkDateKey as (v: unknown) => string;
    const bad = everyFourth.flatMap((t) => [new Date(t), t]).filter((v) => loose(v) !== looseOld(v));
    expect(bad).toEqual([]);
  });

  it("for date-only strings and local (offset-less) date-times", () => {
    const strings: string[] = [];
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2029, 0, 1); t += DAY) {
      const day = new Date(t).toISOString().slice(0, 10);
      strings.push(day, `${day}T07:30`);
    }
    strings.push("1975-06-15", "1979-12-31", "1980-01-01", "2026-02-29", "2028-02-29", "2026-02-30", "2026-04-31");
    expect(strings.filter((s) => hkDateKey(s) !== oldHkDateKey(s))).toEqual([]);
  });

  it("for empty and invalid input", () => {
    const loose = hkDateKey as (v: unknown) => string;
    const looseOld = oldHkDateKey as (v: unknown) => string;
    const odd: unknown[] = [
      "", null, undefined, "not-a-date", "2026-13-01", "2026-00-10", "2026-10-06T25:00:00Z", "T", " ",
      "+010000-01-01T00:00:00Z", "-000001-06-01T00:00:00Z", "0099-01-01", "Sat, 04 Oct 2026 07:00:00 GMT",
      "2026/10/04 03:00", "October 4, 2026", 0, NaN, new Date(NaN),
    ];
    expect(odd.map((v) => loose(v))).toEqual(odd.map((v) => looseOld(v)));
  });

  it("keeps the documented cases", () => {
    expect(hkDateKey("2026-07-05T19:00:00.000Z")).toBe("2026-07-06");
    expect(hkDateKey("2026-07-05T15:59:59.999Z")).toBe("2026-07-05");
    expect(hkDateKey("2028-02-28T16:00:00.000Z")).toBe("2028-02-29");
    expect(hkDateKey("2026-12-31T16:00:00.000Z")).toBe("2027-01-01");
  });
});

// --- The other per-call formatters, now built once ------------------------

function oldFormatWhen(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} HKT`;
}

function oldFormatDay(iso: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

function oldFormatIcsLocalTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function oldHkParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

const sampleInstants = [
  ...earlyHkHours(Date.UTC(2026, 9, 1), 3),
  ...spread(400, Date.UTC(2020, 0, 1), Date.UTC(2032, 0, 1)),
  Date.UTC(2026, 9, 4, 7, 0, 30), Date.UTC(2026, 11, 31, 16), Date.UTC(2028, 1, 28, 16),
];

describe("calendar and umpiring formatters match the old per-call ones", () => {
  it("formatWhen, formatDay and formatIcsLocalTime (calendar feed)", () => {
    for (const t of sampleInstants) {
      const d = new Date(t);
      expect(formatWhen(d)).toBe(oldFormatWhen(d));
      expect(formatDay(d.toISOString())).toBe(oldFormatDay(d.toISOString()));
      expect(formatIcsLocalTime(d)).toBe(oldFormatIcsLocalTime(d));
    }
    expect(formatDay("")).toBe("");
  });

  it("hkTime and dutyLine (umpiring)", () => {
    for (const t of sampleInstants) {
      const iso = new Date(t).toISOString();
      const p = oldHkParts(iso);
      expect(hkTime(iso)).toBe(`${p.hour}:${p.minute}`);
      const duty = { matchDate: iso, timeTbc: false, venue: "KP", dutyTeam: "HKFC D" };
      expect(dutyLine(duty)).toBe(`${Number(p.day)}/${Number(p.month)} ${p.hour}${p.minute} KP D`);
    }
  });
});

describe("same-day games from the day map", () => {
  it("gives what scanning every fixture gave", () => {
    const fx = (id: string, t: number) => ({ id, date: new Date(t).toISOString(), availabilityStatus: "Available" }) as MyFixture;
    const all = spread(300, Date.UTC(2026, 8, 1), Date.UTC(2026, 11, 1)).map((t, i) => fx(`m${i % 250}`, t));
    const byDay = groupByHkDay(all);
    for (const f of all) {
      expect(otherGamesThatDay(f, byDay.get(hkDateKey(f.date)) ?? [])).toEqual(otherGamesThatDay(f, all));
    }
  });
});
