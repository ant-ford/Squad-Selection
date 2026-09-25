import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { birthdayAtAge, birthdayKey, isBirthdayOn } from "../shared/birthday";
import { mapPlayer } from "../shared/mappers/playerMapper";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";
import { fakeAirtable } from "./helpers/airtable";

describe("birthdayKey", () => {
  it("keeps the month and day of an Airtable date and drops the year", () => {
    expect(birthdayKey("1990-09-25")).toBe("09-25");
  });

  it("is undefined when there is no usable date", () => {
    expect(birthdayKey(undefined)).toBeUndefined();
    expect(birthdayKey("")).toBeUndefined();
    expect(birthdayKey("25/09/1990")).toBeUndefined();
    expect(birthdayKey(19900925)).toBeUndefined();
  });

  it("is all mapPlayer keeps of the date of birth", () => {
    const player = mapPlayer({ id: "recP1", fields: { "Date of Birth": "1990-09-25" } });
    expect(player.birthday).toBe("09-25");
    expect(JSON.stringify(player)).not.toContain("1990");
  });
});

describe("birthdayAtAge", () => {
  it("adds the years to the date of birth", () => {
    expect(birthdayAtAge("2003-05-14", 28)).toBe("2031-05-14");
  });

  it("moves 29 February to the 28th in a year without one, and keeps it in a year with one", () => {
    expect(birthdayAtAge("2000-02-29", 27)).toBe("2027-02-28");
    expect(birthdayAtAge("2000-02-29", 28)).toBe("2028-02-29");
  });

  it("gives nothing without a date", () => {
    expect(birthdayAtAge(undefined, 28)).toBeUndefined();
    expect(birthdayAtAge("soon", 28)).toBeUndefined();
  });
});

describe("isBirthdayOn", () => {
  it("matches the same month and day in any year", () => {
    expect(isBirthdayOn("09-25", "2026-09-25")).toBe(true);
    expect(isBirthdayOn("09-25", "2026-09-26")).toBe(false);
  });

  it("is false with no birthday or no day", () => {
    expect(isBirthdayOn(undefined, "2026-09-25")).toBe(false);
    expect(isBirthdayOn("09-25", "")).toBe(false);
  });

  it("celebrates a 29 February birthday on 28 February outside leap years", () => {
    expect(isBirthdayOn("02-29", "2027-02-28")).toBe(true);
    expect(isBirthdayOn("02-29", "2100-02-28")).toBe(true); // not a leap year
  });

  it("waits for 29 February in a leap year", () => {
    expect(isBirthdayOn("02-29", "2028-02-28")).toBe(false);
    expect(isBirthdayOn("02-29", "2028-02-29")).toBe(true);
    expect(isBirthdayOn("02-29", "2000-02-28")).toBe(false); // 2000 is a leap year
  });
});

describe("the player dashboard's birthday flag", () => {
  const people = (dob: string) => ({
    People: [
      {
        id: "recP1",
        fields: { "Preferred Name": "Ann", Email: "ann@hkfc.com", Active: true, "Registered Team": "A", "Date of Birth": dob },
      },
    ],
    Teams: [{ id: "recTA", fields: { "Team Name": "A", "Team Rank": 1, Active: true } }],
    Matches: [],
    "Match Cards": [],
    "Availability Exceptions": [],
    "Availability Rules": [],
  });
  const ann: AuthorizedUser = {
    email: "ann@hkfc.com", personId: "recP1", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [],
  };
  const ENV = { AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any;

  beforeEach(() => {
    invalidateAll();
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is set on the Hong Kong calendar day, which starts at 16:00 UTC the day before", async () => {
    fakeAirtable(people("1990-09-25"));
    vi.setSystemTime(new Date("2026-09-24T16:30:00Z")); // 00:30 on the 25th in Hong Kong
    const out = await getMyFixtures(ENV, ann);
    expect(out.isBirthday).toBe(true);
    expect(JSON.stringify(out)).not.toContain("1990");
  });

  it("is not set on any other day", async () => {
    fakeAirtable(people("1990-09-25"));
    vi.setSystemTime(new Date("2026-09-24T15:30:00Z")); // 23:30 on the 24th in Hong Kong
    expect((await getMyFixtures(ENV, ann)).isBirthday).toBe(false);
  });
});

describe("teammates' birthdays on the dashboard", () => {
  const ENV = { AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any;
  const person = (id: string, name: string, fields: Record<string, unknown>) => ({
    id,
    fields: { "Preferred Name": name, Surname: "X", Email: `${id}@hkfc.com`, Active: true, ...fields },
  });
  const ann: AuthorizedUser = {
    email: "recAnn@hkfc.com", personId: "recAnn", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [],
  };

  beforeEach(() => {
    invalidateAll();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T04:00:00Z")); // midday, 25 Sept, Hong Kong
    fakeAirtable({
      People: [
        // Ann: registered D, Selected Team C. Her own birthday is today too.
        person("recAnn", "Ann", { "Registered Team": "D", "Selected Team EOS": "C", "Date of Birth": "1991-09-25" }),
        // Selected Team C by EOS: a teammate.
        person("recBen", "Ben", { "Registered Team": "D", "Selected Team EOS": "C", "Date of Birth": "1988-09-25" }),
        // Registered C, no Selected Team: falls back to C, a teammate.
        person("recCat", "Cat", { "Registered Team": "C", "Date of Birth": "2001-09-25" }),
        // Registered C but selected for B: not a teammate this season.
        person("recDan", "Dan", { "Registered Team": "C", "Selected Team EOS": "B", "Date of Birth": "1990-09-25" }),
        // Teammate, but not today.
        person("recEve", "Eve", { "Registered Team": "C", "Date of Birth": "1990-09-26" }),
        // Teammate with a birthday today, but inactive.
        person("recFay", "Fay", { "Registered Team": "C", Active: false, "Date of Birth": "1990-09-25" }),
      ],
      Teams: [
        { id: "recTB", fields: { "Team Name": "B", "Team Rank": 2, Active: true } },
        { id: "recTC", fields: { "Team Name": "C", "Team Rank": 3, Active: true } },
        { id: "recTD", fields: { "Team Name": "D", "Team Rank": 4, Active: true } },
      ],
      Matches: [],
      "Match Cards": [],
      "Availability Exceptions": [],
      "Availability Rules": [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("names Active teammates in the same Selected Team, and not the player", async () => {
    const out = await getMyFixtures(ENV, ann);
    expect(out.displayTeam).toBe("C");
    expect(out.isBirthday).toBe(true);
    expect(out.teamBirthdays).toEqual(["Ben X", "Cat X"]);
  });

  it("sends names only, never a date of birth", async () => {
    const out = await getMyFixtures(ENV, ann);
    expect(JSON.stringify(out)).not.toMatch(/19\d\d|20\d\d-\d\d-\d\d/);
  });
});
