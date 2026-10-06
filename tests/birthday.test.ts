import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { birthdayAtAge, birthdayKey, isBirthdayOn } from "../shared/birthday";
import { toPlayer, type PlayerRow } from "../worker/src/data/supabase/mappers";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";
import { useFakeRepos, type FakePerson } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { person as personRow, recId, team } from "./helpers/factories";

// The dashboard runs on the Supabase backend: the repositories in memory,
// and the fake PostgREST (empty) for what getMyFixtures asks Supabase
// directly (volunteer, event and umpiring access).
const ENV = { ...SUPABASE_TEST_ENV } as Env;
const db = useFakeRepos();
const emptyPostgrest = () =>
  fakePostgrest({ tables: { api_offices: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] } });

/** A People row as Postgres has it (api_people), every column empty but the date of birth. */
const playerRow = (dob: string | null): PlayerRow => ({
  id: recId("P1"),
  preferred_name: null, given_names: null, surname: null, shirt_no_value: null, email: null, mobile_no: null, active: true,
  registered_team: null, selected_team_sos: null, selected_team_eos: null, playing_position: null, playing_ability: null,
  is_visiting_player: false, is_suspended: false, matches_to_serve: null, ever_registered_to_premier: false, u21_eligible: false,
  player_coach: [], section_rank: null, rank_updated_at: null, status: null, applicant_stage: null, sports_background: null,
  selection_comments: null, opt_in_only: false, date_of_birth: dob, photo_file_id: null,
});

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

  it("is all the People mapper keeps of the date of birth", async () => {
    const player = await toPlayer(ENV, playerRow("1990-09-25"));
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
  const ANN = recId("P1");
  /** Ann, born 25 September 1990: the repositories carry the month and day only, as the mapper leaves them. */
  const seed = (dob: string) => {
    db.reset({
      people: [
        personRow({
          id: ANN, preferredName: "Ann", email: "ann@hkfc.com", active: true, registeredTeam: "A",
          birthday: dob.slice(5), crm: { dateOfBirth: dob },
        }),
      ],
      teams: [team({ id: recId("TA"), teamName: "A", teamRank: 1, active: true })],
    });
  };
  /** Ann signed in, as auth_context reads her from the seeded People. */
  const ann = (): AuthorizedUser => db.signedIn("ann@hkfc.com");

  beforeEach(() => {
    invalidateAll();
    vi.useFakeTimers({ toFake: ["Date"] });
    emptyPostgrest();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is set on the Hong Kong calendar day, which starts at 16:00 UTC the day before", async () => {
    seed("1990-09-25");
    vi.setSystemTime(new Date("2026-09-24T16:30:00Z")); // 00:30 on the 25th in Hong Kong
    const out = await getMyFixtures(ENV, ann());
    expect(out.isBirthday).toBe(true);
    expect(JSON.stringify(out)).not.toContain("1990");
  });

  it("is not set on any other day", async () => {
    seed("1990-09-25");
    vi.setSystemTime(new Date("2026-09-24T15:30:00Z")); // 23:30 on the 24th in Hong Kong
    expect((await getMyFixtures(ENV, ann())).isBirthday).toBe(false);
  });
});

describe("teammates' birthdays on the dashboard", () => {
  /** An Active player; the date of birth reaches the repositories as month and day only. */
  const person = (label: string, name: string, dob: string, overrides: Partial<FakePerson>) =>
    personRow({
      id: recId(label), preferredName: name, surname: "X", email: `${label.toLowerCase()}@hkfc.com`, active: true,
      birthday: dob.slice(5), crm: { dateOfBirth: dob }, ...overrides,
    });
  const ann = (): AuthorizedUser => db.signedIn("ann@hkfc.com");

  beforeEach(() => {
    invalidateAll();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T04:00:00Z")); // midday, 25 Sept, Hong Kong
    emptyPostgrest();
    db.reset({
      people: [
        // Ann: registered D, Selected Team C. Her own birthday is today too.
        person("Ann", "Ann", "1991-09-25", { registeredTeam: "D", selectedTeamEos: "C" }),
        // Selected Team C by EOS: a teammate.
        person("Ben", "Ben", "1988-09-25", { registeredTeam: "D", selectedTeamEos: "C" }),
        // Registered C, no Selected Team: falls back to C, a teammate.
        person("Cat", "Cat", "2001-09-25", { registeredTeam: "C" }),
        // Registered C but selected for B: not a teammate this season.
        person("Dan", "Dan", "1990-09-25", { registeredTeam: "C", selectedTeamEos: "B" }),
        // Teammate, but not today.
        person("Eve", "Eve", "1990-09-26", { registeredTeam: "C" }),
        // Teammate with a birthday today, but inactive.
        person("Fay", "Fay", "1990-09-25", { registeredTeam: "C", active: false }),
      ],
      teams: [
        team({ id: recId("TB"), teamName: "B", teamRank: 2, active: true }),
        team({ id: recId("TC"), teamName: "C", teamRank: 3, active: true }),
        team({ id: recId("TD"), teamName: "D", teamRank: 4, active: true }),
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("names Active teammates in the same Selected Team, and not the player", async () => {
    const out = await getMyFixtures(ENV, ann());
    expect(out.displayTeam).toBe("C");
    expect(out.isBirthday).toBe(true);
    expect(out.teamBirthdays).toEqual(["Ben X", "Cat X"]);
  });

  it("sends names only, never a date of birth", async () => {
    const out = await getMyFixtures(ENV, ann());
    expect(JSON.stringify(out)).not.toMatch(/19\d\d|20\d\d-\d\d-\d\d/);
  });
});
