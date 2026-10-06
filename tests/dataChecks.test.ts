import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sectionsFor } from "../worker/src/auth";
import { getDataChecks, seasonBounds } from "../worker/src/dataChecks";
import {
  buildDataChecks,
  findDuplicates,
  mobileKey,
  nameKey,
  type DataCheckInput,
  type DcPersonRow,
} from "../shared/dataChecks";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const L = (n: number) => String.fromCharCode(96 + n); // names are letters only

const person = (n: number, more: Partial<DcPersonRow> = {}): DcPersonRow => ({
  id: U(n),
  api_id: `rec${n}`,
  preferred_name: null,
  given_names: `Given${L(n)}`,
  surname: `Surname${L(n)}`,
  registered_name: `SURNAME${L(n)} Given${L(n)}`,
  status: "Member",
  applicant_stage: null,
  active: true,
  registered_team: "HKFC C",
  playing_position: "Midfield",
  playing_ability: "3",
  date_of_birth: `19${50 + n}-01-0${(n % 9) + 1}`,
  mobile_no: `+852 9000 ${String(1000 + n)}`,
  email: `p${n}@example.test`,
  is_suspended: false,
  matches_to_serve: null,
  ...more,
});

const input = (more: Partial<DataCheckInput> = {}): DataCheckInput => ({
  people: [],
  unlinkedCards: [],
  events: [],
  commitments: [],
  teamNames: ["HKFC A", "HKFC B", "HKFC C"],
  today: "2026-10-06",
  ...more,
});

describe("data checks section", () => {
  const as = (office: string) => ({ officerRoles: [{ office, designation: "" }] }) as unknown as AuthorizedUser;

  it("opens to the Men's Convenor and the Section Captains", () => {
    expect(sectionsFor(as("hockeyConvenor"))).toContain("dataChecks");
    expect(sectionsFor(as("sectionCaptain"))).toContain("dataChecks");
    expect(sectionsFor(as("membershipOfficer"))).not.toContain("dataChecks");
    expect(sectionsFor(as("assistantDirector"))).not.toContain("dataChecks");
  });
});

describe("unlinked match cards", () => {
  const card = (id: string, raw: string, team = "HKFC C", date = "2026-09-20T07:00:00Z") => ({
    api_id: id,
    raw_player_name: raw,
    team,
    match: { match_date: date, home_team: "Opponents A", away_team: team },
  });

  it("gives the opponent and up to three suggestions, closest first, whatever the word order", () => {
    const people = [
      person(1, { given_names: "Samuel", surname: "Lee", registered_name: null }),
      person(2, { given_names: "Sam", surname: "Leigh", registered_name: null }),
      person(3, { given_names: "Tom", surname: "Brown", registered_name: null }),
      person(4, { given_names: "Sam", surname: "Lee", registered_name: null, active: false }),
      person(5, { given_names: "Samantha", surname: "Lees", registered_name: null }),
      person(6, { given_names: "Sam", surname: "Lee", registered_name: null, status: "Resigned" }),
    ];
    const out = buildDataChecks(input({ people, unlinkedCards: [card("c1", "LEE Sam")] }));
    expect(out.unlinkedCards).toHaveLength(1);
    const [c] = out.unlinkedCards;
    expect(c).toMatchObject({ id: "c1", rawName: "LEE Sam", team: "HKFC C", opponent: "Opponents A", matchDate: "2026-09-20T07:00:00Z" });
    expect(c.suggestions.length).toBeLessThanOrEqual(3);
    // The exact name first (the inactive record still counts), never a resigned one or Tom Brown.
    expect(c.suggestions[0].id).toBe("rec4");
    expect(c.suggestions.map((s) => s.id)).not.toContain("rec6");
    expect(c.suggestions.map((s) => s.id)).not.toContain("rec3");
  });

  it("matches a registered name and a preferred name", () => {
    const people = [
      person(1, { registered_name: "CHAN Tai Man", given_names: "Tai Man", surname: "Chan" }),
      person(2, { preferred_name: "Jock", given_names: "John", surname: "Wilson", registered_name: null }),
    ];
    const out = buildDataChecks(input({ people, unlinkedCards: [card("c1", "CHAN Tai-man"), card("c2", "WILSON Jock")] }));
    expect(out.unlinkedCards.find((c) => c.id === "c1")!.suggestions.map((s) => s.id)).toEqual(["rec1"]);
    expect(out.unlinkedCards.find((c) => c.id === "c2")!.suggestions.map((s) => s.id)).toEqual(["rec2"]);
  });

  it("orders newest match first and offers nothing for a blank name", () => {
    const out = buildDataChecks(
      input({ people: [person(1)], unlinkedCards: [card("old", "X Y", "HKFC A", "2026-09-01T07:00:00Z"), card("new", " ", "HKFC A", "2026-09-30T07:00:00Z")] }),
    );
    expect(out.unlinkedCards.map((c) => c.id)).toEqual(["new", "old"]);
    expect(out.unlinkedCards[0]).toMatchObject({ rawName: "", suggestions: [] });
  });

  it("the opponent is the home team when HKFC is away, and the away team when at home", () => {
    const home = { api_id: "h", raw_player_name: "A B", team: "HKFC B", match: { match_date: null, home_team: "HKFC B", away_team: "Rivals" } };
    const out = buildDataChecks(input({ unlinkedCards: [home, card("a", "A B", "HKFC C")] }));
    expect(Object.fromEntries(out.unlinkedCards.map((c) => [c.id, c.opponent]))).toEqual({ h: "Rivals", a: "Opponents A" });
  });
});

describe("shared registered names", () => {
  it("lists a name held by two people, trimmed and ignoring case, inactive ones included", () => {
    const people = [
      person(1, { registered_name: "LEE Sam" }),
      person(2, { registered_name: " lee sam ", active: false }),
      person(3, { registered_name: "LEE Samuel" }),
      person(4, { registered_name: null }),
      person(5, { registered_name: null }),
    ];
    const out = buildDataChecks(input({ people }));
    expect(out.sharedRegisteredNames).toEqual([
      { registeredName: "LEE Sam", people: [expect.objectContaining({ id: "rec1" }), expect.objectContaining({ id: "rec2", active: false })] },
    ]);
  });
});

describe("re-registrations to review", () => {
  it("lists needs_review events with the person and the play-ups", () => {
    const out = buildDataChecks(
      input({
        people: [person(1)],
        events: [
          {
            id: U(90),
            person_id: U(1),
            season: "2026-2027",
            previous_team: "HKFC C",
            new_team: "HKFC D",
            detail: "Would not be a move up",
            play_ups: [{ match_date: "2026-09-01T07:00:00Z", team: "HKFC D" }],
            created_at: "2026-09-02T00:00:00Z",
          },
          { id: U(91), person_id: U(99), season: "2026-2027", previous_team: "HKFC C", new_team: null, detail: null, play_ups: null, created_at: "2026-09-03T00:00:00Z" },
        ],
      }),
    );
    expect(out.reRegistrations).toEqual([
      {
        id: U(90),
        person: expect.objectContaining({ id: "rec1" }),
        season: "2026-2027",
        previousTeam: "HKFC C",
        suggestedTeam: "HKFC D",
        detail: "Would not be a move up",
        playUps: [{ matchDate: "2026-09-01T07:00:00Z", team: "HKFC D" }],
        createdAt: "2026-09-02T00:00:00Z",
      },
    ]);
  });
});

describe("incomplete players (eligibility checkAdminData)", () => {
  it("lists Active players missing a registered team, position or ability, and nobody else", () => {
    const people = [
      person(1),
      person(2, { registered_team: null }),
      person(3, { playing_position: "", playing_ability: null }),
      person(4, { registered_team: null, active: false }),
      person(5, { playing_ability: "  " }),
    ];
    const out = buildDataChecks(input({ people }));
    expect(out.incomplete.map((r) => [r.person.id, r.missing])).toEqual([
      ["rec2", ["team"]],
      ["rec3", ["position", "ability"]],
      ["rec5", ["ability"]],
    ]);
  });
});

describe("likely duplicates", () => {
  it("compares mobiles as digits with the country code (none means Hong Kong)", () => {
    expect(mobileKey("+852 9123 4567")).toBe("85291234567");
    expect(mobileKey("9123-4567")).toBe("85291234567");
    expect(mobileKey("+44 7911 123456")).toBe("447911123456");
    expect(mobileKey("123")).toBeNull();
    expect(mobileKey(null)).toBeNull();
  });

  it("compares names whatever the order and the case", () => {
    expect(nameKey("LEE Sam")).toBe(nameKey("sam lee"));
    expect(nameKey("José O'Brien")).toBe(nameKey("jose o brien"));
  });

  it("groups by name, date of birth with surname, mobile and email, never returning the values", () => {
    const people = [
      person(1, { given_names: "Sam", surname: "Lee", email: "Sam@Example.test ", mobile_no: "+852 9123 4567", date_of_birth: "1990-05-05" }),
      person(2, { given_names: "sam", surname: "LEE", email: "sam@example.test", mobile_no: "91234567", date_of_birth: "1990-05-05", status: "Resigned" }),
      // Same birthday, different surname: not a duplicate.
      person(3, { date_of_birth: "1990-05-05" }),
      person(4, { email: null, mobile_no: null, date_of_birth: null }),
      person(5, { email: null, mobile_no: null, date_of_birth: null }),
    ];
    const groups = findDuplicates(people);
    expect(groups.map((g) => [g.match, g.people.map((p) => p.id).sort()])).toEqual([
      ["dob", ["rec1", "rec2"]],
      ["email", ["rec1", "rec2"]],
      ["mobile", ["rec1", "rec2"]],
      ["name", ["rec1", "rec2"]],
    ]);
    const json = JSON.stringify(groups);
    for (const secret of ["example.test", "9123", "1990-05-05"]) expect(json).not.toContain(secret);
  });
});

describe("needs fixing", () => {
  it("lists a stage the membership board can't place, a review progress the Statements board can't, and a legacy suspension with no team", () => {
    const people = [
      person(1, { applicant_stage: "On Hold" }),
      person(2, { applicant_stage: "Accepted" }),
      person(3, { applicant_stage: "Pending", status: "Resigned" }),
      person(4, { is_suspended: true, registered_team: null }),
      person(5, { matches_to_serve: 2 }), // has a team: carried over by the suspensions migration
      person(6, { matches_to_serve: 1, registered_team: "Old Team" }),
    ];
    const commitments = [
      { api_id: "cm1", person_id: U(2), review_progress: "Done?", period_start: "2026-01-01", period_end: "2026-12-31" },
      { api_id: "cm2", person_id: U(2), review_progress: "Complete", period_start: "2026-01-01", period_end: "2026-12-31" },
      { api_id: "cm3", person_id: U(2), review_progress: null, period_start: "2027-01-01", period_end: "2027-12-31" }, // not started yet
      { api_id: "cm4", person_id: U(2), review_progress: null, period_start: "2025-01-01", period_end: "2025-12-31" }, // before REVIEWS_FROM
      { api_id: "cm5", person_id: U(3), review_progress: null, period_start: "2026-01-01", period_end: "2026-12-31" }, // resigned
      { api_id: "cm6", person_id: null, review_progress: "", period_start: "2026-01-01", period_end: "2026-12-31" },
    ];
    const out = buildDataChecks(input({ people, commitments }));
    expect(out.needsFixing.map((n) => [n.kind, n.person?.id ?? null, n.commitmentId ?? null, n.value])).toEqual([
      ["stage", "rec1", null, "On Hold"],
      ["review", "rec2", "cm1", "Done?"],
      ["review", null, "cm6", ""],
      ["legacySuspension", "rec4", null, "Is suspended"],
      ["legacySuspension", "rec6", null, "Matches to serve"],
    ]);
  });
});

describe("GET data", () => {
  const env = {
    DATA_SUPABASE_URL: "https://proj.supabase.co",
    DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  } as Env;
  let urls: URL[];
  beforeEach(() => {
    urls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        urls.push(url);
        const table = url.pathname.split("/").pop();
        const body = table === "people" ? [person(1, { registered_team: null })] : table === "teams" ? [{ team_name: "HKFC C" }] : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is five reads, with this season's unlinked cards and needs_review events only", async () => {
    const out = await getDataChecks(env);
    expect(out.incomplete.map((r) => r.person.id)).toEqual(["rec1"]);
    expect(urls.map((u) => u.pathname.split("/").pop()).sort()).toEqual(["commitments", "match_cards", "people", "registration_events", "teams"]);
    const cards = urls.find((u) => u.pathname.endsWith("/match_cards"))!;
    expect(cards.searchParams.get("person_id")).toBe("is.null");
    expect(cards.searchParams.getAll("match.match_date")).toEqual([
      expect.stringMatching(/^gte\.\d{4}-07-01T00:00:00Z$/),
      expect.stringMatching(/^lt\.\d{4}-07-01T00:00:00Z$/),
    ]);
    expect(urls.find((u) => u.pathname.endsWith("/registration_events"))!.searchParams.get("status")).toBe("eq.needs_review");
  });

  it("puts a season between 1 July and 1 July, UTC, as season_of() does", () => {
    expect(seasonBounds("2026-2027")).toEqual({ from: "2026-07-01T00:00:00Z", to: "2027-07-01T00:00:00Z" });
  });
});
