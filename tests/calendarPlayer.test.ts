import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Player calendar consistency with the player dashboard (Selected Team view)
//
// handlePlayerCalendarFeed consumes buildPlayerFixtureView (the SAME
// categorised fixture logic as the dashboard) via getPlayerFixtures, so the
// subscribed calendar reflects My Team / Play-Up Opportunities / Support
// Fixtures exactly as the player sees them. Coach/team calendars remain team
// subscriptions and are unaffected by individual players' Selected Team.
// ---------------------------------------------------------------------------

import { handlePlayerCalendarFeed, handleTeamCalendarFeed } from "../worker/src/calendar";
import { invalidateAll, invalidateCache, invalidateCachePrefix } from "../worker/src/cache";
import { currentSeason, previousSeason } from "../worker/src/seasonContext";
import { SupabaseError } from "../worker/src/data/supabase";
import type { Match } from "../shared/schema/domainTypes";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";
import { exception as exceptionRow, match as matchRow, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "test-calendar-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof fixture date keys. */
const DAY = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

const P1 = recId("P1");
const M_D = recId("MD");
const M_E = recId("ME");
const M_F = recId("MF");
const M_G = recId("MG");
const M_H = recId("MH");

const db = useFakeRepos(() => ({
  teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) =>
    team({ id: recId(`T${i}`), teamName: n, teamRank: i + 1, active: true }),
  ),
}));
let pg: FakePostgrest;

function seedPeople(overrides: { selectedTeamEos?: string; suspended?: boolean } = {}) {
  db.state.people = [
    person({
      id: P1,
      preferredName: "Jonny",
      email: "jonny@hkfc.com",
      active: true,
      registeredTeam: "F",
      playingAbility: "B",
      selectedTeamEos: overrides.selectedTeamEos,
      isSuspended: overrides.suspended ?? false,
      playingPosition: "Forward",
    }),
  ];
}

function match(id: string, homeTeam: string, day: number, selectedHome: string[] = []): Match {
  return matchRow({
    id,
    matchDate: `${DAY(day)}T09:00:00.000Z`,
    season: "2026-2027",
    homeTeam,
    awayTeam: "Opponent",
    matchStatus: "Scheduled",
    selectedPlayersHome: selectedHome,
  });
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENV.CALENDAR_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unfold RFC 5545 folded lines so assertions see whole logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

function eventsWith(ics: string, needle: string): string[] {
  return unfold(ics).filter((l) => l.startsWith("SUMMARY:") && l.includes(needle));
}

function categoriesFor(ics: string, teamNeedle: string): string[] {
  const lines = unfold(ics);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("SUMMARY:") && lines[i].includes(teamNeedle)) {
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        if (lines[j].startsWith("DESCRIPTION:")) {
          const m = lines[j].match(/Category: ([^\\]+)/);
          if (m) out.push(m[1]);
        }
      }
    }
  }
  return out;
}

beforeEach(() => {
  invalidateAll();
  seedPeople();
  // The feed also adds the special events the player is going to
  // (events.ts calendarEventsFor), read from Supabase directly. Jonny is
  // the same person there, and has answered no events.
  pg = fakePostgrest({
    tables: {
      people: [{ id: "00000000-0000-4000-8000-000000000001", api_id: P1 }],
      event_responses: [],
      events: [],
      api_suspensions: [],
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("player calendar (Selected Team view)", () => {
  it("registered F + Selected E: E = My Team, D (unselected play-up) absent, F hidden (selected for E same day)", async () => {
    seedPeople({ selectedTeamEos: "E" });
    db.state.matches = [
      match(M_E, "E", 1, [P1]), // Jonny selected for E
      match(M_D, "D", 1),
      match(M_F, "F", 1),
      match(M_G, "G", 1), // engine blocks (committee) -> absent
      match(M_H, "H", 1), // engine blocks (committee) -> absent
    ];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics = await res.text();

    // My Team: the E fixture (selected) - no play-up badge.
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(categoriesFor(ics, "E vs")).toEqual(["My Team"]);
    // The D fixture is a play-up opportunity on the dashboard, but Jonny has
    // not been picked for it, so it is not his game and stays out of his
    // calendar.
    expect(eventsWith(ics, "D vs")).toHaveLength(0);
    // Jonny is SELECTED for the higher E fixture on the same day -> his own
    // F team's fixture is ineligible that day (same-day rule).
    expect(eventsWith(ics, "F vs")).toHaveLength(0);
    // G/H are engine-blocked (Committee approval) -> absent.
    expect(eventsWith(ics, "G vs")).toHaveLength(0);
    expect(eventsWith(ics, "H vs")).toHaveLength(0);
  });

  it("registered F + merely available for E (not selected): F support remains visible", async () => {
    // Product decision 2026-09-03: availability for a higher team does not
    // make the player unavailable for their own team. Same fixtures as the
    // Jonny case, but Jonny is NOT selected for the E squad.
    seedPeople({ selectedTeamEos: "E" });
    db.state.matches = [
      match(M_E, "E", 1),
      match(M_D, "D", 1),
      match(M_F, "F", 1),
    ];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "D vs")).toHaveLength(0); // play-up, not picked
    expect(eventsWith(ics, "F vs")).toHaveLength(1);
    expect(categoriesFor(ics, "F vs")).toEqual(["Support Fixture"]);
  });

  it("registered F with no Selected Team falls back to F as My Team", async () => {
    seedPeople({});
    db.state.matches = [
      match(M_F, "F", 1),
      match(M_E, "E", 1), // one above display F -> play-up, not picked
    ];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics = await res.text();
    expect(categoriesFor(ics, "F vs")).toEqual(["My Team"]);
    expect(eventsWith(ics, "E vs")).toHaveLength(0);
  });

  it("a play-up appears once the player is picked for it", async () => {
    seedPeople({});
    db.state.matches = [
      match(M_F, "F", 1),
      match(M_E, "E", 2, [P1]), // picked to play up for E
      match(M_D, "D", 3), // could play up for D, but not picked
    ];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "E vs")[0]).toContain("✅");
    expect(eventsWith(ics, "D vs")).toHaveLength(0);
  });

  it("changing Selected Team EOS changes the player calendar output", async () => {
    seedPeople({ selectedTeamEos: "E" });
    db.state.matches = [
      match(M_E, "E", 1),
      match(M_D, "D", 1),
    ];
    const sig = await sign(`player:${P1}`);

    // EOS = E: My Team = E; D is an unpicked play-up, so absent.
    const res1 = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics1 = await res1.text();
    expect(categoriesFor(ics1, "E vs")).toEqual(["My Team"]);
    expect(eventsWith(ics1, "D vs")).toHaveLength(0);

    // The captain changes Selected Team EOS to D.
    db.state.people[0].selectedTeamEos = "D";
    // Simulate the natural reference-cache refresh.
    invalidateCache("club-reference");

    const res2 = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics2 = await res2.text();
    // My Team is now D; E drops to a play-up opportunity.
    expect(categoriesFor(ics2, "D vs")).toEqual(["My Team"]);
    expect(eventsWith(ics2, "E vs")).toHaveLength(0); // E is no longer advertised (below the new display team)
  });

  it("eligibility still uses the Registered Team: a suspended player keeps My Team but loses play-ups/support", async () => {
    seedPeople({ selectedTeamEos: "E", suspended: true });
    db.state.matches = [
      match(M_E, "E", 1, [P1]),
      match(M_D, "D", 1),
      match(M_F, "F", 1),
    ];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1); // My Team unaffected
    expect(eventsWith(ics, "D vs")).toHaveLength(0); // suspended -> play-up hidden
    expect(eventsWith(ics, "F vs")).toHaveLength(0); // suspended -> support hidden
  });
});

describe("player calendar event detail", () => {
  /** The DESCRIPTION of the first event whose SUMMARY contains `needle`. */
  function descriptionFor(ics: string, needle: string): string {
    const lines = unfold(ics);
    const i = lines.findIndex((l) => l.startsWith("SUMMARY:") && l.includes(needle));
    const d = lines.slice(i).find((l) => l.startsWith("DESCRIPTION:")) || "";
    // Undo the ICS escaping so assertions can read the text as written.
    return d.replace(/^DESCRIPTION:/, "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
  }

  const feed = async () => {
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    return res.text();
  };

  function teammate(id: string, name: string, shirtNo?: string) {
    db.state.people.push(
      person({
        id, preferredName: name, email: `${name}@hkfc.com`, active: true, registeredTeam: "F",
        playingAbility: "B", playingPosition: "Midfielder",
        ...(shirtNo ? { shirtNoValue: shirtNo } : {}),
      }),
    );
  }

  /** The whole VEVENT block (unfolded lines) for the first event whose SUMMARY contains `needle`. */
  function eventLines(ics: string, needle: string): string[] {
    const lines = unfold(ics);
    const i = lines.findIndex((l) => l.startsWith("SUMMARY:") && l.includes(needle));
    const start = lines.lastIndexOf("BEGIN:VEVENT", i);
    const end = lines.indexOf("END:VEVENT", i);
    return lines.slice(start, end + 1);
  }

  function exception(id: string, matchId: string, playerId: string, status: string) {
    db.state.availabilityExceptions.push(
      exceptionRow({ id, player: [playerId], match: [matchId], availabilityStatus: status, season: "2026-2027" }),
    );
  }

  it("names the kit colour under the match section", async () => {
    const m = match(M_F, "F", 1);
    m.homeKit = "White";
    db.state.matches = [m];
    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("MATCH\nKit: White");
  });

  it("opens with the fixture and when it is, and signs off", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    const desc = descriptionFor(await feed(), "F vs");
    expect(desc.split("\n")[0]).toBe("F vs Opponent");
    // Hong Kong time, spelled out rather than an ISO stamp, and labelled: a
    // travelling player's calendar shifts the event itself into their zone.
    expect(desc.split("\n")[1]).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+, \d{2}:\d{2} HKT$/);
    expect(desc.trimEnd().endsWith("Sent by Eddy · HKFC Men's Hockey squad management")).toBe(true);
  });

  it("still sends the events when the form lines cannot be built", async () => {
    // A calendar client that gets an error keeps showing whatever it last
    // fetched, so a failure in the one optional read must not take the
    // whole feed with it.
    db.state.matches = [match(M_F, "F", 1, [P1])];
    vi.spyOn(db.repos.matches, "listPlayedForSeasons").mockRejectedValue(new SupabaseError("Supabase 500", 500));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(eventsWith(ics, "F vs")).toHaveLength(1);
    expect(descriptionFor(ics, "F vs")).toContain("SQUAD (1)");
    expect(descriptionFor(ics, "F vs")).not.toContain("FORM");
    expect(errors).toHaveBeenCalled();
  });

  it("drops a section whole when it has nothing to say", async () => {
    // Nobody has played yet, so there is no record and no head-to-head.
    db.state.matches = [match(M_F, "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).not.toContain("FORM");
  });

  /** A completed result in the same season as the fixtures above. */
  function result(id: string, homeTeam: string, awayTeam: string, home: number, away: number, day: number): Match {
    return matchRow({
      id,
      matchDate: `${DAY(day)}T09:00:00.000Z`,
      season: "2026-2027",
      homeTeam,
      awayTeam,
      homeTeamScore: home,
      awayTeamScore: away,
      matchStatus: "Played",
      venue: "KCC",
    });
  }

  // The feed returned a 500 in production because of how much it read per
  // request. These two pin the reads that were removed.
  it("reads played matches for the seasons it can speak about, not every result ever recorded", async () => {
    db.state.matches = [match(M_F, "F", 1), result(recId("R1"), "F", "Opponent", 3, 1, -30)];
    await feed();

    // Supabase path: the played-matches read is matches.listPlayedForSeasons,
    // which takes the seasons it is bounded by (the Airtable version checked
    // its query for a {Season}= filter).
    const playedQueries = db.callsTo("matches", "listPlayedForSeasons");
    const season = currentSeason();
    const bounded = [season, previousSeason(season) || ""].filter(Boolean).sort();

    expect(playedQueries.length).toBeGreaterThan(0);
    // An unbounded scan of the Matches table is what tipped the request over.
    for (const q of playedQueries) expect(q.args[0]).toEqual(bounded);
    expect(db.callsTo("matches", "listForSeason").filter((c) => !c.args[0])).toEqual([]);
  });

  it("does not bypass the availability cache: its own output is already cached", async () => {
    db.state.matches = [match(M_F, "F", 1, [P1])];
    await feed();

    // Drop only the built ICS, so the next call rebuilds the events but may
    // still answer its data reads from cache.
    invalidateCachePrefix("calendar:");
    db.calls.length = 0;
    await feed();

    const exceptionReads = db.callsTo("availabilityExceptions");
    expect(exceptionReads).toHaveLength(0);
  });

  it("carries the season record and the last meeting with these opponents", async () => {
    db.state.matches = [
      match(M_F, "F", 1),
      result(recId("R1"), "F", "Opponent", 3, 1, -30), // beat them last time
      result(recId("R2"), "F", "Someone Else", 0, 2, -20),
      result(recId("R3"), "Other", "F", 1, 1, -10),
    ];
    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("FORM");
    expect(desc).toContain("This season: 1W 1D 1L (3 played)");
    expect(desc).toMatch(/Last meeting: Won 3-1, \d{1,2} [A-Z][a-z]+ \d{4} \(home\)/);
  });

  it("says Going once the player is picked, and Available until then", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).toContain("Availability: Available");

    invalidateAll();
    db.state.matches = [match(M_F, "F", 1, [P1])];
    expect(descriptionFor(await feed(), "F vs")).toContain("Availability: Going");
  });

  it("leaves a player's own Maybe answer as they gave it", async () => {
    db.state.matches = [match(M_F, "F", 1, [P1])];
    exception(recId("X1"), M_F, P1, "Maybe");
    const ics = await feed();
    expect(descriptionFor(ics, "F vs")).toContain("Availability: Maybe");
    // Being picked is the stronger fact, so the title still reads as selected.
    expect(eventsWith(ics, "F vs")[0]).toContain("✅");
  });

  it("marks an unanswered-but-Maybe fixture apart from one never answered", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    exception(recId("X1"), M_F, P1, "Maybe");
    expect(eventsWith(await feed(), "F vs")[0]).toContain("❓");

    invalidateAll();
    db.state.availabilityExceptions = [];
    expect(eventsWith(await feed(), "F vs")[0]).toContain("🟦");
  });

  it("lists the squad the player has been picked in, flagging the Maybes", async () => {
    const P2 = recId("P2");
    const P3 = recId("P3");
    teammate(P2, "Tom");
    teammate(P3, "Raj");
    db.state.matches = [match(M_F, "F", 1, [P1, P2, P3])];
    exception(recId("X2"), M_F, P3, "Maybe");

    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("SQUAD (3)");
    expect(desc).toContain("Jonny");
    expect(desc).toContain("Tom");
    expect(desc).toContain("Raj (Maybe)");
    // Tom answered nothing, so he carries no flag.
    expect(desc).not.toContain("Tom (");
  });

  it("puts shirt numbers ahead of the names, where the player has one", async () => {
    const P2 = recId("P2");
    const P3 = recId("P3");
    teammate(P2, "Tom", "7");
    teammate(P3, "Raj", "23");
    db.state.matches = [match(M_F, "F", 1, [P1, P2, P3])];
    exception(recId("X2"), M_F, P3, "Maybe");

    const desc = descriptionFor(await feed(), "F vs");
    // Tom and Raj are midfielders; Jonny is a forward, so he is listed after them.
    expect(desc).toContain("SQUAD (3)\n#7 Tom\n#23 Raj (Maybe)\nJonny");
  });

  it("lists the squad in team-sheet order: GK, DEF, MID, FWD, then flexible", async () => {
    const add = (id: string, name: string, position: string) =>
      db.state.people.push(
        person({ id, preferredName: name, email: `${name}@hkfc.com`, active: true, registeredTeam: "F", playingPosition: position }),
      );
    const FLEX = recId("Flex");
    const DEF = recId("Def");
    const GK = recId("Gk");
    const MID = recId("Mid");
    add(FLEX, "Flex", "Flexible/Varies");
    add(DEF, "Def", "Defender");
    add(GK, "Keeper", "Goalkeeper");
    add(MID, "Mid", "Midfielder");
    // Picked in no particular order; Jonny (Forward) sits among them.
    db.state.matches = [match(M_F, "F", 1, [FLEX, P1, DEF, GK, MID])];

    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("SQUAD (5)\nKeeper\nDef\nMid\nJonny\nFlex");
  });

  it("keeps a declined own-team game in the calendar, marked, not cancelled", async () => {
    // It used to go out as CANCELLED, which clients take literally: the
    // fixture looked called off rather than declined by this one player.
    db.state.matches = [match(M_F, "F", 1)];
    exception(recId("X1"), M_F, P1, "Unavailable");
    const ics = await feed();
    const lines = eventLines(ics, "F vs");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).toBe("SUMMARY:❌ F vs Opponent (declined)");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).not.toContain("STATUS:CANCELLED");
    // Declined, so it should not show the player as busy.
    expect(lines).toContain("TRANSP:TRANSPARENT");
    expect(descriptionFor(ics, "F vs")).toContain("Availability: Unavailable");
  });

  it("leaves the kit off a declined game and keeps it on one the player is in", async () => {
    const m = match(M_F, "F", 1);
    m.homeKit = "Blue";
    db.state.matches = [m];
    exception(recId("X1"), M_F, P1, "Unavailable");
    expect(eventsWith(await feed(), "F vs")[0]).not.toContain("🔵");

    invalidateAll();
    db.state.availabilityExceptions = [];
    expect(eventsWith(await feed(), "F vs")[0]).toContain("🔵");
  });

  it("being picked outranks a No: a selected player's game is never shown declined", async () => {
    db.state.matches = [match(M_F, "F", 1, [P1])];
    exception(recId("X1"), M_F, P1, "Unavailable");
    const lines = eventLines(await feed(), "F vs");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).toContain("✅");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).not.toContain("declined");
    expect(lines).not.toContain("TRANSP:TRANSPARENT");
  });

  it("blocks the player's time for every game they have not declined", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    exception(recId("X1"), M_F, P1, "Maybe");
    const lines = eventLines(await feed(), "F vs");
    expect(lines).toContain("STATUS:TENTATIVE");
    expect(lines).not.toContain("TRANSP:TRANSPARENT");
  });

  it("carries no squad block for a fixture nobody has been picked for", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).not.toContain("SQUAD (");
  });
});

describe("player calendar feed signature and caching", () => {
  it("rejects a mismatched signature with 401", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    const res = await handlePlayerCalendarFeed(ENV, P1, "0".repeat(64));
    expect(res.status).toBe(401);
  });

  it("rejects a signature of the wrong length with 401 (constant-time compare rejects on length too)", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    const res = await handlePlayerCalendarFeed(ENV, P1, "abcd");
    expect(res.status).toBe(401);
  });

  it("accepts the correctly signed request", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    const sig = await sign(`player:${P1}`);
    const res = await handlePlayerCalendarFeed(ENV, P1, sig);
    expect(res.status).toBe(200);
  });

  it("a cache hit makes zero data reads (display team is read from cached reference data, not a fresh lookup)", async () => {
    db.state.matches = [match(M_F, "F", 1)];
    const sig = await sign(`player:${P1}`);
    await handlePlayerCalendarFeed(ENV, P1, sig); // cold: populates both club-reference and the ICS cache
    // Every read: the repositories, and Supabase directly (special events).
    const callsAfterFirst = db.calls.length + pg.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    db.calls.length = 0;
    pg.calls.length = 0;
    const res2 = await handlePlayerCalendarFeed(ENV, P1, sig); // warm: must not read anything
    expect(res2.status).toBe(200);
    expect([...db.calls, ...pg.calls]).toHaveLength(0);
  });
});

describe("team calendar (coach subscriptions)", () => {
  it("the E team calendar remains E fixtures regardless of a player's Selected Team", async () => {
    seedPeople({ selectedTeamEos: "D" }); // a player's EOS points at D - irrelevant to team feeds
    db.state.matches = [
      match(M_E, "E", 1),
      match(M_D, "D", 1),
      match(M_F, "F", 1),
    ];
    const sig = await sign(`team:E`);
    const res = await handleTeamCalendarFeed(ENV, "E", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "D vs")).toHaveLength(0);
    expect(eventsWith(ics, "F vs")).toHaveLength(0);
    // Team events carry no player-category line.
    expect(unfold(ics).some((l) => l.includes("Category:"))).toBe(false);
  });

  it("lists the selected squad with shirt numbers", async () => {
    const P2 = recId("P2");
    db.state.people.push(
      person({ id: P2, preferredName: "Tom", email: "tom@hkfc.com", active: true, registeredTeam: "E", shirtNoValue: "7" }),
    );
    db.state.matches = [match(M_E, "E", 1, [P1, P2])];
    const sig = await sign(`team:E`);
    const res = await handleTeamCalendarFeed(ENV, "E", sig);
    const desc = unfold(await res.text())
      .find((l) => l.startsWith("DESCRIPTION:"))!
      .replace(/\\n/g, "\n");
    // Tom has no recorded position, so he follows Jonny (a forward).
    expect(desc).toContain("SQUAD (2)\nJonny\n#7 Tom");
  });

  it("orders the team squad by position too, keeper first", async () => {
    const GK = recId("Gk");
    db.state.people.push(
      person({
        id: GK, preferredName: "Keeper", email: "gk@hkfc.com", active: true, registeredTeam: "E",
        playingPosition: "Goalkeeper", shirtNoValue: "1",
      }),
    );
    db.state.matches = [match(M_E, "E", 1, [P1, GK])]; // keeper picked last
    const sig = await sign(`team:E`);
    const res = await handleTeamCalendarFeed(ENV, "E", sig);
    const desc = unfold(await res.text())
      .find((l) => l.startsWith("DESCRIPTION:"))!
      .replace(/\\n/g, "\n");
    expect(desc).toContain("SQUAD (2)\n#1 Keeper\nJonny");
  });
});
