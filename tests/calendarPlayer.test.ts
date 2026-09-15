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
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "test-calendar-secret",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

/** Date-rot-proof fixture date keys. */
const DAY = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => ({
  id: `recT${i}`,
  fields: { "Team Name": n, "Team Rank": i + 1, Active: true },
}));

let state: { people: any[]; teams: any[]; matches: any[]; exceptions: any[] };

function seedPeople(overrides: { selectedTeamEos?: string; suspended?: boolean } = {}) {
  state.people = [
    {
      id: "recP1",
      fields: {
        "Preferred Name": "Jonny",
        Email: "jonny@hkfc.com",
        Active: true,
        "Registered Team": "F",
        "Playing Ability": "B",
        "Selected Team EOS": overrides.selectedTeamEos,
        "Is Suspended": overrides.suspended ?? false,
        "Playing Position": "Forward",
      },
    },
  ];
}

function match(id: string, homeTeam: string, day: number, selectedHome: string[] = []): any {
  return {
    id,
    fields: {
      Date: `${DAY(day)}T09:00:00.000Z`,
      Season: "2026-2027",
      "Home Team": homeTeam,
      "Away Team": "Opponent",
      "Match Status": "Scheduled",
      "Selected Players Home": selectedHome,
    },
  };
}

function seed() {
  state = {
    people: [],
    teams: TEAMS.map((t) => ({ id: t.id, fields: { ...t.fields } })),
    matches: [],
    exceptions: [],
  };
}

let fetchCalls: { url: string; method: string }[] = [];
let fetchMock: ReturnType<typeof fakeAirtable>["fetchMock"];

function installFakeAirtable() {
  // Getters, not a snapshot: several tests reassign state.matches etc.
  // directly after this runs, and the fake must see the live array.
  const tables: FakeTables = {
    get People() { return state.people; },
    get Teams() { return state.teams; },
    get Matches() { return state.matches; },
    get "Availability Exceptions"() { return state.exceptions; },
  };
  const handle = fakeAirtable(tables);
  fetchCalls = handle.calls;
  fetchMock = handle.fetchMock;
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
  seed();
  seedPeople();
  fetchCalls = [];
  installFakeAirtable();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player calendar (Selected Team view)", () => {
  it("registered F + Selected E: E = My Team, D (unselected play-up) absent, F hidden (selected for E same day)", async () => {
    seedPeople({ selectedTeamEos: "E" });
    state.matches = [
      match("recM_E", "E", 1, ["recP1"]), // Jonny selected for E
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
      match("recM_G", "G", 1), // engine blocks (committee) -> absent
      match("recM_H", "H", 1), // engine blocks (committee) -> absent
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
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
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "D vs")).toHaveLength(0); // play-up, not picked
    expect(eventsWith(ics, "F vs")).toHaveLength(1);
    expect(categoriesFor(ics, "F vs")).toEqual(["Support Fixture"]);
  });

  it("registered F with no Selected Team falls back to F as My Team", async () => {
    seedPeople({});
    state.matches = [
      match("recM_F", "F", 1),
      match("recM_E", "E", 1), // one above display F -> play-up, not picked
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(categoriesFor(ics, "F vs")).toEqual(["My Team"]);
    expect(eventsWith(ics, "E vs")).toHaveLength(0);
  });

  it("a play-up appears once the player is picked for it", async () => {
    seedPeople({});
    state.matches = [
      match("recM_F", "F", 1),
      match("recM_E", "E", 2, ["recP1"]), // picked to play up for E
      match("recM_D", "D", 3), // could play up for D, but not picked
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics = await res.text();
    expect(eventsWith(ics, "E vs")).toHaveLength(1);
    expect(eventsWith(ics, "E vs")[0]).toContain("✅");
    expect(eventsWith(ics, "D vs")).toHaveLength(0);
  });

  it("changing Selected Team EOS changes the player calendar output", async () => {
    seedPeople({ selectedTeamEos: "E" });
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
    ];
    const sig = await sign(`player:recP1`);

    // EOS = E: My Team = E; D is an unpicked play-up, so absent.
    const res1 = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics1 = await res1.text();
    expect(categoriesFor(ics1, "E vs")).toEqual(["My Team"]);
    expect(eventsWith(ics1, "D vs")).toHaveLength(0);

    // The captain changes Selected Team EOS to D in Airtable.
    state.people[0].fields["Selected Team EOS"] = "D";
    // Simulate the natural reference-cache refresh (10-minute TTL).
    invalidateCache("club-reference");

    const res2 = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    const ics2 = await res2.text();
    // My Team is now D; E drops to a play-up opportunity.
    expect(categoriesFor(ics2, "D vs")).toEqual(["My Team"]);
    expect(eventsWith(ics2, "E vs")).toHaveLength(0); // E is no longer advertised (below the new display team)
  });

  it("eligibility still uses the Registered Team: a suspended player keeps My Team but loses play-ups/support", async () => {
    seedPeople({ selectedTeamEos: "E", suspended: true });
    state.matches = [
      match("recM_E", "E", 1, ["recP1"]),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
    ];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
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
    const sig = await sign("player:recP1");
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    return res.text();
  };

  function teammate(id: string, name: string, shirtNo?: string) {
    state.people.push({
      id,
      fields: {
        "Preferred Name": name, Email: `${name}@hkfc.com`, Active: true, "Registered Team": "F",
        "Playing Ability": "B", "Playing Position": "Midfielder",
        ...(shirtNo ? { "Shirt No Value": shirtNo } : {}),
      },
    });
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
    state.exceptions.push({
      id,
      fields: { Player: [playerId], Match: [matchId], "Availability Status": status, "Season (Matches)": ["2026-2027"] },
    });
  }

  it("names the kit colour under the match section", async () => {
    const m = match("recM_F", "F", 1);
    m.fields["Home Kit"] = "White";
    state.matches = [m];
    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("MATCH\nKit: White");
  });

  it("opens with the fixture and when it is, and signs off", async () => {
    state.matches = [match("recM_F", "F", 1)];
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
    state.matches = [match("recM_F", "F", 1, ["recP1"])];
    const realFetch = fetchMock.getMockImplementation() as (url: any, init?: any) => Promise<Response>;
    fetchMock.mockImplementation((url: any, init?: any) => {
      // URLSearchParams encodes spaces as "+", which decodeURIComponent
      // leaves alone - so undo that before matching on field names.
      if (decodeURIComponent(String(url)).replace(/\+/g, " ").includes('{Match Status}="Played"')) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return realFetch(url, init);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const sig = await sign("player:recP1");
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(eventsWith(ics, "F vs")).toHaveLength(1);
    expect(descriptionFor(ics, "F vs")).toContain("SQUAD (1)");
    expect(descriptionFor(ics, "F vs")).not.toContain("FORM");
    expect(errors).toHaveBeenCalled();
  });

  it("drops a section whole when it has nothing to say", async () => {
    // Nobody has played yet, so there is no record and no head-to-head.
    state.matches = [match("recM_F", "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).not.toContain("FORM");
  });

  /** A completed result in the same season as the fixtures above. */
  function result(id: string, homeTeam: string, awayTeam: string, home: number, away: number, day: number) {
    return {
      id,
      fields: {
        Date: `${DAY(day)}T09:00:00.000Z`,
        Season: "2026-2027",
        "Home Team": homeTeam,
        "Away Team": awayTeam,
        "Home Score": home,
        "Away Score": away,
        "Match Status": "Played",
        Venue: "KCC",
      },
    };
  }

  // The feed returned a 500 in production because of how much it read per
  // request. These two pin the reads that were removed.
  it("reads played matches for the seasons it can speak about, not every result ever recorded", async () => {
    state.matches = [match("recM_F", "F", 1), result("recR1", "F", "Opponent", 3, 1, -30)];
    await feed();

    // URLSearchParams encodes spaces as "+", which decodeURIComponent leaves
    // alone - so undo that before matching on field names.
    const playedQueries = fetchCalls
      .map((c) => decodeURIComponent(c.url).replace(/\+/g, " "))
      .filter((u) => u.includes('{Match Status}="Played"'));

    expect(playedQueries.length).toBeGreaterThan(0);
    // An unbounded scan of the Matches table is what tipped the request over.
    for (const q of playedQueries) expect(q).toContain("{Season}=");
  });

  it("does not bypass the availability cache: its own output is already cached", async () => {
    state.matches = [match("recM_F", "F", 1, ["recP1"])];
    await feed();

    // Drop only the built ICS, so the next call rebuilds the events but may
    // still answer its data reads from cache.
    invalidateCachePrefix("calendar:");
    fetchCalls = [];
    await feed();

    const exceptionReads = fetchCalls.filter((c) => c.url.includes("Availability%20Exceptions"));
    expect(exceptionReads).toHaveLength(0);
  });

  it("carries the season record and the last meeting with these opponents", async () => {
    state.matches = [
      match("recM_F", "F", 1),
      result("recR1", "F", "Opponent", 3, 1, -30), // beat them last time
      result("recR2", "F", "Someone Else", 0, 2, -20),
      result("recR3", "Other", "F", 1, 1, -10),
    ];
    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("FORM");
    expect(desc).toContain("This season: 1W 1D 1L (3 played)");
    expect(desc).toMatch(/Last meeting: Won 3-1, \d{1,2} [A-Z][a-z]+ \d{4} \(home\)/);
  });

  it("says Going once the player is picked, and Available until then", async () => {
    state.matches = [match("recM_F", "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).toContain("Availability: Available");

    invalidateAll();
    state.matches = [match("recM_F", "F", 1, ["recP1"])];
    expect(descriptionFor(await feed(), "F vs")).toContain("Availability: Going");
  });

  it("leaves a player's own Maybe answer as they gave it", async () => {
    state.matches = [match("recM_F", "F", 1, ["recP1"])];
    exception("recX1", "recM_F", "recP1", "Maybe");
    const ics = await feed();
    expect(descriptionFor(ics, "F vs")).toContain("Availability: Maybe");
    // Being picked is the stronger fact, so the title still reads as selected.
    expect(eventsWith(ics, "F vs")[0]).toContain("✅");
  });

  it("marks an unanswered-but-Maybe fixture apart from one never answered", async () => {
    state.matches = [match("recM_F", "F", 1)];
    exception("recX1", "recM_F", "recP1", "Maybe");
    expect(eventsWith(await feed(), "F vs")[0]).toContain("❓");

    invalidateAll();
    state.exceptions = [];
    expect(eventsWith(await feed(), "F vs")[0]).toContain("🟦");
  });

  it("lists the squad the player has been picked in, flagging the Maybes", async () => {
    teammate("recP2", "Tom");
    teammate("recP3", "Raj");
    state.matches = [match("recM_F", "F", 1, ["recP1", "recP2", "recP3"])];
    exception("recX2", "recM_F", "recP3", "Maybe");

    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("SQUAD (3)");
    expect(desc).toContain("Jonny");
    expect(desc).toContain("Tom");
    expect(desc).toContain("Raj (Maybe)");
    // Tom answered nothing, so he carries no flag.
    expect(desc).not.toContain("Tom (");
  });

  it("puts shirt numbers ahead of the names, where the player has one", async () => {
    teammate("recP2", "Tom", "7");
    teammate("recP3", "Raj", "23");
    state.matches = [match("recM_F", "F", 1, ["recP1", "recP2", "recP3"])];
    exception("recX2", "recM_F", "recP3", "Maybe");

    const desc = descriptionFor(await feed(), "F vs");
    expect(desc).toContain("SQUAD (3)\nJonny\n#7 Tom\n#23 Raj (Maybe)");
  });

  it("keeps a declined own-team game in the calendar, marked, not cancelled", async () => {
    // It used to go out as CANCELLED, which clients take literally: the
    // fixture looked called off rather than declined by this one player.
    state.matches = [match("recM_F", "F", 1)];
    exception("recX1", "recM_F", "recP1", "Unavailable");
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
    const m = match("recM_F", "F", 1);
    m.fields["Home Kit"] = "Blue";
    state.matches = [m];
    exception("recX1", "recM_F", "recP1", "Unavailable");
    expect(eventsWith(await feed(), "F vs")[0]).not.toContain("🔵");

    invalidateAll();
    state.exceptions = [];
    expect(eventsWith(await feed(), "F vs")[0]).toContain("🔵");
  });

  it("being picked outranks a No: a selected player's game is never shown declined", async () => {
    state.matches = [match("recM_F", "F", 1, ["recP1"])];
    exception("recX1", "recM_F", "recP1", "Unavailable");
    const lines = eventLines(await feed(), "F vs");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).toContain("✅");
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).not.toContain("declined");
    expect(lines).not.toContain("TRANSP:TRANSPARENT");
  });

  it("blocks the player's time for every game they have not declined", async () => {
    state.matches = [match("recM_F", "F", 1)];
    exception("recX1", "recM_F", "recP1", "Maybe");
    const lines = eventLines(await feed(), "F vs");
    expect(lines).toContain("STATUS:TENTATIVE");
    expect(lines).not.toContain("TRANSP:TRANSPARENT");
  });

  it("carries no squad block for a fixture nobody has been picked for", async () => {
    state.matches = [match("recM_F", "F", 1)];
    expect(descriptionFor(await feed(), "F vs")).not.toContain("SQUAD (");
  });
});

describe("player calendar feed signature and caching", () => {
  it("rejects a mismatched signature with 401", async () => {
    state.matches = [match("recM_F", "F", 1)];
    const res = await handlePlayerCalendarFeed(ENV, "recP1", "0".repeat(64));
    expect(res.status).toBe(401);
  });

  it("rejects a signature of the wrong length with 401 (constant-time compare rejects on length too)", async () => {
    state.matches = [match("recM_F", "F", 1)];
    const res = await handlePlayerCalendarFeed(ENV, "recP1", "abcd");
    expect(res.status).toBe(401);
  });

  it("accepts the correctly signed request", async () => {
    state.matches = [match("recM_F", "F", 1)];
    const sig = await sign(`player:recP1`);
    const res = await handlePlayerCalendarFeed(ENV, "recP1", sig);
    expect(res.status).toBe(200);
  });

  it("a cache hit makes zero Airtable calls (display team is read from cached reference data, not a fresh lookup)", async () => {
    state.matches = [match("recM_F", "F", 1)];
    const sig = await sign(`player:recP1`);
    await handlePlayerCalendarFeed(ENV, "recP1", sig); // cold: populates both club-reference and the ICS cache
    const callsAfterFirst = fetchCalls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    fetchCalls = [];
    const res2 = await handlePlayerCalendarFeed(ENV, "recP1", sig); // warm: must not hit Airtable at all
    expect(res2.status).toBe(200);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("team calendar (coach subscriptions)", () => {
  it("the E team calendar remains E fixtures regardless of a player's Selected Team", async () => {
    seedPeople({ selectedTeamEos: "D" }); // a player's EOS points at D - irrelevant to team feeds
    state.matches = [
      match("recM_E", "E", 1),
      match("recM_D", "D", 1),
      match("recM_F", "F", 1),
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
    state.people.push({
      id: "recP2",
      fields: { "Preferred Name": "Tom", Email: "tom@hkfc.com", Active: true, "Registered Team": "E", "Shirt No Value": "7" },
    });
    state.matches = [match("recM_E", "E", 1, ["recP1", "recP2"])];
    const sig = await sign(`team:E`);
    const res = await handleTeamCalendarFeed(ENV, "E", sig);
    const desc = unfold(await res.text())
      .find((l) => l.startsWith("DESCRIPTION:"))!
      .replace(/\\n/g, "\n");
    expect(desc).toContain("SQUAD (2)\nJonny\n#7 Tom");
  });
});
