import { Env, airtableFindAll, airtableFindById, linkId } from "./airtable";
import { getReferenceData, getPlayerByEmail, getExceptionsForSeasons } from "./reference";
import { getCached } from "../../src/lib/cache";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import type { Match, Player, Team } from "../../src/generated/domainTypes";
import type { ReferenceData } from "./reference";
import { selectedDisplayTeam } from "../../src/lib/displayTeam";
import { buildEvaluationContext } from "./seasonContext";
import { evaluatePlayerEligibility } from "./eligibility";

const POS_KEY: Record<string, string> = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Forward: "FWD" };

/**
 * All Scheduled matches, cached 10 minutes. Selections live inside match
 * records (Selected Players Home/Away), so syncSquad invalidates this cache
 * after every write - fixture views can never show stale selections.
 */
const SCHEDULED_MATCHES_TTL_MS = 10 * 60 * 1000;

export async function getScheduledMatches(env: Env): Promise<Match[]> {
  const { data } = await getCached<Match[]>("scheduled-matches", async () => {
    const records = await airtableFindAll(env, TABLES.match, '{Match Status}="Scheduled"');
    return records.map(mapMatch);
  }, SCHEDULED_MATCHES_TTL_MS);
  return data;
}

// ---------------------------------------------------------------------------
// Lowest-ranked team Goalkeeper schedule
// ---------------------------------------------------------------------------

/**
 * Name of the lowest-ranked ACTIVE team: the team with the highest
 * `Teams.Team Rank` value. Never hardcoded - derived from live data each
 * call (reference data is itself cached 10 minutes).
 */
export function getLowestRankedTeamName(ref: ReferenceData): string {
  let lowest = "";
  let lowestRank = -Infinity;
  for (const t of ref.teams) {
    const rank = t.teamRank ?? 99;
    if (rank > lowestRank) {
      lowestRank = rank;
      lowest = t.teamName || "";
    }
  }
  return lowest;
}

/**
 * Cohort: an ACTIVE player whose current Playing Position is Goalkeeper and
 * who is registered to the lowest-ranked active team. People.Playing
 * Position is the source of truth for current identity; Match Cards
 * Goalkeeper flags are historical and never used here.
 */
export function isSpecialGoalkeeper(user: Player, ref: ReferenceData): boolean {
  if (user.active !== true) return false;
  if ((user.playingPosition || "") !== "Goalkeeper") return false;
  const lowest = getLowestRankedTeamName(ref);
  return lowest !== "" && (user.registeredTeam || "") === lowest;
}

function buildSpecialGoalkeeperCard(
  m: Match,
  playerId: string,
  teamsByName: ReadonlyMap<string | undefined, Team>,
  ownTeam: string,
): {
  id: string; date: string; homeTeam: string; awayTeam: string;
  hkfcTeam: string; opponent: string; isHome: boolean; venue: string; division: string;
  availabilityStatus: string; playerNotes: string; availabilityExceptionId: string;
  selectionStatus: string; selectionNotes: string; selectedCount: number; targetSquadSize: number;
  isPlayUp?: boolean;
} {
  const home = m.homeTeam || "";
  const away = m.awayTeam || "";
  const homeIsHkfc = teamsByName.has(home);
  const awayIsHkfc = teamsByName.has(away);
  let hkfcTeam: string;
  let opponent: string;
  let isHome: boolean;
  let selectedIds: string[];
  if (home === ownTeam) {
    hkfcTeam = home; opponent = away; isHome = true; selectedIds = m.selectedPlayersHome || [];
  } else if (away === ownTeam) {
    hkfcTeam = away; opponent = home; isHome = false; selectedIds = m.selectedPlayersAway || [];
  } else if ((m.selectedPlayersHome || []).includes(playerId)) {
    // Player is selected for a side of a derby they are not registered to -
    // show that side so the selection is visible.
    hkfcTeam = home; opponent = away; isHome = true; selectedIds = m.selectedPlayersHome || [];
  } else if ((m.selectedPlayersAway || []).includes(playerId)) {
    hkfcTeam = away; opponent = home; isHome = false; selectedIds = m.selectedPlayersAway || [];
  } else if (homeIsHkfc) {
    hkfcTeam = home; opponent = away; isHome = true; selectedIds = m.selectedPlayersHome || [];
  } else {
    hkfcTeam = away; opponent = home; isHome = false; selectedIds = m.selectedPlayersAway || [];
  }
  const team = teamsByName.get(hkfcTeam);
  return {
    id: m.id,
    date: m.matchDate || "",
    homeTeam: home,
    awayTeam: away,
    hkfcTeam,
    opponent,
    isHome,
    venue: m.venue || "",
    division: m.division || "",
    availabilityStatus: "Available",
    playerNotes: "",
    availabilityExceptionId: "",
    selectionStatus: selectedIds.includes(playerId) ? "Selected" : "",
    selectionNotes: "",
    selectedCount: selectedIds.length,
    targetSquadSize: team?.targetSquadSize || 16,
  };
}

export async function getMyFixtures(env: Env, email: string) {
  const user = await getPlayerByEmail(env, email);
  if (!user) throw new HttpError("Player record not found for this email", 404);
  const teamName = user.registeredTeam || "";
  const displayTeam = selectedDisplayTeam(user) || teamName;
  const ref = await getReferenceData(env);
  // Section Captains share coach access (see auth.ts); include their teams in
  // coachTeams so the player-profile gates and team-scoped operations match.
  const coachTeams = ref.teams
    .filter((t) => (t.coach || []).includes(user.id) || (t.sectionCaptain || []).includes(user.id))
    .map((t) => t.teamName || "");
  const captainTeams = ref.teams.filter((t) => (t.teamCaptain || []).includes(user.id)).map((t) => t.teamName || "");
  const isSectionCaptain = ref.teams.some((t) => (t.sectionCaptain || []).includes(user.id));
  const isCoach = coachTeams.length > 0;
  const base = {
    playerName: user.preferredName || user.givenNames || "Player",
    registeredTeam: displayTeam, displayTeam, playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "", isCoach, coachTeams, captainTeams, isSectionCaptain,
  };
  const view = await buildPlayerFixtureView(env, user);
  return {
    ...base,
    displayTeam: view.displayTeam,
    specialGoalkeeperView: view.specialGoalkeeperView,
    fixtures: view.myTeam,
    playUpOpportunities: view.playUpOpportunities,
    supportFixtures: view.supportFixtures,
  };
}

export interface PlayerFixtureView {
  displayTeam: string;
  /** True for the special goalkeeper planning view. */
  specialGoalkeeperView?: boolean;
  /** My Team / Upcoming Fixture cards (selected or Selected Team EOS fixtures; GK planning list). */
  myTeam: any[];
  playUpOpportunities: any[];
  supportFixtures: any[];
}

/**
 * THE authoritative player fixture view - shared by the player dashboard
 * (getMyFixtures) and the player calendar feed (getPlayerFixtures) so the
 * two can never drift apart. Categorisation: per-day, at most three options
 * (selected/EOS fixture -> registered-team support -> play-up fill), with
 * play-up and support candidates gated by the eligibility engine using the
 * true Registered Team.
 */
export async function buildPlayerFixtureView(env: Env, user: Player): Promise<PlayerFixtureView> {
  const playerId = user.id;
  const teamName = user.registeredTeam || "";
  // Display team (optics): Selected Team EOS -> SOS -> Registered Team. The
  // player experiences THIS team as "My Team"; every business rule (play-up
  // legality, same-day priority, suspension) keeps using the true team.
  const displayTeam = selectedDisplayTeam(user) || teamName;
  const ref = await getReferenceData(env);
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const rankMap = ref.teamRankMap;
  const displayRank = rankMap[displayTeam] ?? 99;
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));

  // Lowest-ranked team Goalkeeper: date-grouped schedule of ALL upcoming
  // HKFC fixtures (derbies are a single card). No per-fixture Airtable
  // requests - exceptions are bulk-fetched by season below.
  if (isSpecialGoalkeeper(user, ref)) {
    const allMatches = await getScheduledMatches(env);
    const now = new Date().toISOString();
    const upcoming = allMatches
      .filter((m) => m.matchDate && m.matchDate >= now)
      .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
    const cards = upcoming
      .filter((m) => teamNames.has(m.homeTeam || "") || teamNames.has(m.awayTeam || ""))
      .map((m) => buildSpecialGoalkeeperCard(m, user.id, teamsByName, teamName));
    const matchIds = cards.map((c) => c.id);
    const allExceptions = await getExceptionsForSeasons(env, upcoming.map((m) => m.season || ""));
    const exceptionByMatch = new Map(
      allExceptions
        .filter((e) => linkId(e.player) === user.id && matchIds.includes(linkId(e.match) || ""))
        .map((e) => [linkId(e.match) || "", e]),
    );
    return {
      displayTeam,
      specialGoalkeeperView: true,
      myTeam: cards.map((c) => ({
        ...c,
        fixtureCategory: "own" as const,
        availabilityStatus: exceptionByMatch.get(c.id)?.availabilityStatus || "Available",
        playerNotes: exceptionByMatch.get(c.id)?.note || "",
        availabilityExceptionId: exceptionByMatch.get(c.id)?.id || "",
      })),
      playUpOpportunities: [],
      supportFixtures: [],
    };
  }

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches.filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Fixture categories (presentation only - the eligibility engine remains
  // the sole authority on whether a fixture is actually playable).
  //
  // Per-day model: on any given date the player sees AT MOST THREE fixture
  // options, prioritised:
  //   1. Upcoming Fixture  - the fixture they are selected for (their
  //      current selected team), else their Selected Team (EOS) fixture
  //      if it plays that day;
  //   2. Support Fixture   - their Registered Team's fixture, when the
  //      Registered Team is below the relevant selected/EOS team;
  //   3. Play-Up fills     - teams immediately above the relevant team
  //      (closest first, Registered Team excluded), subject to eligibility,
  //      filling the remaining places up to three.
  // The same-day availability dimension is neutralised for this portal
  // presentation (players plan availability here); selection-time
  // evaluation keeps every rule including same-day blocks.
  // ---------------------------------------------------------------------
  type FixtureCategory = "own" | "play-up" | "support";
  type Side = { match: any; team: string; opponent: string; isHome: boolean; selectedIds: string[]; dateKey: string };
  const sidesByDate = new Map<string, Side[]>();
  for (const m of upcoming) {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    const dateKey = (m.matchDate || "").split("T")[0];
    const opponentFor = (isHome: boolean) => (isHome ? away : home);
    if (teamNames.has(home)) {
      const side = { match: m, team: home, opponent: opponentFor(true), isHome: true, selectedIds: m.selectedPlayersHome || [], dateKey };
      const list = sidesByDate.get(dateKey) || [];
      list.push(side);
      sidesByDate.set(dateKey, list);
    }
    if (teamNames.has(away)) {
      const side = { match: m, team: away, opponent: opponentFor(false), isHome: false, selectedIds: m.selectedPlayersAway || [], dateKey };
      const list = sidesByDate.get(dateKey) || [];
      list.push(side);
      sidesByDate.set(dateKey, list);
    }
  }

  const isSquadSelected = (s: Side) => s.selectedIds.includes(playerId);
  const categorized: { side: Side; category: FixtureCategory }[] = [];

  for (const [, entries] of sidesByDate) {
    let carded = 0;
    const takenMatches = new Set<string>();
    const card = (s: Side, category: FixtureCategory) => {
      categorized.push({ side: s, category });
      takenMatches.add(s.match.id);
      carded++;
    };

    // 1. Upcoming Fixture: the fixture the player is selected for.
    const selectedSide = entries.find((s) => isSquadSelected(s));
    if (selectedSide) card(selectedSide, "own");

    // 2. The Selected Team (EOS) fixture, when it is a different match.
    const eosSide = entries.find((s) => s.team === displayTeam && !takenMatches.has(s.match.id));
    if (eosSide) card(eosSide, "own");

    // 3. Support Fixture: the Registered Team's fixture, when the
    //    Registered Team is below the relevant selected/EOS team.
    const primaryTeam = selectedSide?.team ?? eosSide?.team ?? displayTeam;
    const primaryRank = rankMap[primaryTeam] ?? 99;
    const registeredRank = rankMap[teamName] ?? 99;
    const registeredSide = entries.find((s) => s.team === teamName && !takenMatches.has(s.match.id));
    if (registeredSide && registeredRank > primaryRank) card(registeredSide, "support");

    // 4. Play-ups: teams immediately above the relevant team (closest
    //    first, Registered Team excluded), filling the remaining places,
    //    subject to eligibility (gated below).
    const aboveTeams = Object.entries(rankMap)
      .filter(([name, rank]) => name && rank > 0 && rank < 99 && rank < primaryRank && name !== teamName)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    for (const name of aboveTeams) {
      if (carded >= 3) break;
      const entry = entries.find((s) => s.team === name && !takenMatches.has(s.match.id));
      if (!entry) continue;
      card(entry, "play-up");
    }
  }

  if (categorized.length === 0) return { displayTeam, myTeam: [], playUpOpportunities: [], supportFixtures: [] };

  // Eligibility gating: play-up and support candidates must pass the existing
  // eligibility engine (evaluatePlayerEligibility) for that team+fixture.
  // My Team fixtures (selected/EOS) are shown unconditionally. Contexts come
  // from the shared season context (cached - no extra Airtable requests per
  // fixture beyond the season-wide reads).
  const teamMap = new Map(ref.teams.map((t) => [t.teamName || "", t]));
  const gateCache = new Map<string, boolean>();
  const isEligibleFor = async (side: Side): Promise<boolean> => {
    const key = `${side.match.id}:${side.team}`;
    const cached = gateCache.get(key);
    if (cached !== undefined) return cached;
    let eligible = false;
    try {
      const { ctx } = await buildEvaluationContext(env, side.match, rankMap, teamMap, ref.players, side.team);
      // Same-day is neutralised for portal presentation (players plan
      // availability here); selection-time evaluation keeps every rule.
      ctx.sameDayMatches = [];
      ctx.sameDayFixtures = [];
      ctx.sameDaySelectionsByTeam = new Map();
      const result = evaluatePlayerEligibility(user, side.match, ctx);
      eligible = result.status !== "blocked";
    } catch (err) {
      console.error("[MyFixtures] eligibility evaluation failed:", err);
      eligible = false;
    }
    gateCache.set(key, eligible);
    return eligible;
  };

  const gated: { side: Side; category: FixtureCategory }[] = [];
  for (const cand of categorized.filter((x) => x.category !== "own")) {
    if (await isEligibleFor(cand.side)) gated.push(cand);
  }

  const ownCards = categorized.filter((x) => x.category === "own");
  const relevantCategorized = [...ownCards, ...gated];
  const relevantMatchIds = relevantCategorized.map((x) => x.side.match.id);
  const allExceptions = await getExceptionsForSeasons(env, relevantCategorized.map((x) => x.side.match.season || ""));
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId && relevantMatchIds.includes(linkId(e.match) || ""));
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));
  const buildCard = (x: { side: Side; category: FixtureCategory }) => {
    const s = x.side;
    const team = teamsByName.get(s.team);
    const exc = exceptionByMatch.get(s.match.id);
    return {
      id: s.match.id, date: s.match.matchDate || "", homeTeam: s.match.homeTeam || "", awayTeam: s.match.awayTeam || "",
      hkfcTeam: s.team, opponent: s.opponent, isHome: s.isHome, venue: s.match.venue || "", division: s.match.division || "",
      availabilityStatus: exc?.availabilityStatus || "Available", playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "", selectionStatus: s.selectedIds.includes(playerId) ? "Selected" : "",
      selectionNotes: "", selectedCount: s.selectedIds.length, targetSquadSize: team?.targetSquadSize || 16,
      // fixtureCategory is presentation only; "play-up" is used exclusively
      // for the higher-team fillers above the relevant team.
      fixtureCategory: x.category,
      isPlayUp: x.category === "play-up",
      selectionTeam: x.category !== "own" ? s.team : undefined,
    };
  };
  return {
    displayTeam,
    myTeam: ownCards.map(buildCard),
    playUpOpportunities: gated.filter((x) => x.category === "play-up").map(buildCard),
    supportFixtures: gated.filter((x) => x.category === "support").map(buildCard),
  };
}


/**
 * Calendar-facing fixture list: the SAME categorised view as the player
 * dashboard (My Team + Play-Up Opportunities + Support Fixtures), flattened.
 * Identity comes from the signed calendar token's player id.
 */
/** The display team for a player record id (Selected Team EOS -> SOS -> Registered). */
export async function getPlayerDisplayTeam(env: Env, playerId: string): Promise<string> {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) return "";
  const player = mapPlayer(record);
  return selectedDisplayTeam(player) || player.registeredTeam || "";
}

export async function getPlayerFixtures(env: Env, playerId: string) {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(record);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);
  const view = await buildPlayerFixtureView(env, player);
  const fixtures = [...view.myTeam, ...view.playUpOpportunities, ...view.supportFixtures];
  return {
    playerName: player.preferredName || player.givenNames || "Player",
    displayTeam: view.displayTeam,
    registeredTeam: view.displayTeam,
    fixtures,
  };
}

export async function getUpcomingFixtures(env: Env, opts: { email?: string; team?: string }) {
  const ref = await getReferenceData(env);
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const playerById = new Map(ref.players.map((p) => [p.id, p]));
  const nameOf = (p?: Player) => (p ? p.preferredName || p.givenNames || "Player" : "");
  let coachedTeamNames = new Set<string>();
  if (opts.email) {
    const user = await getPlayerByEmail(env, opts.email);
    if (user) {
      coachedTeamNames = new Set(ref.teams.filter((t) => (t.coach || []).includes(user.id)).map((t) => t.teamName || ""));
      const isSectionCaptain = ref.teams.some((t) => (t.sectionCaptain || []).includes(user.id));
      // Section captains see the whole section, whether or not a specific team filter is applied.
      if (isSectionCaptain) coachedTeamNames = new Set(ref.teams.map((t) => t.teamName || ""));
    }
  }
  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches.filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
  const relevant = upcoming.filter((m) => {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    if (opts.team) {
      // An email-bearing call (coach export) must be scoped to teams the
      // coach manages; the signed no-email team-feed path is already
      // authorised by its HMAC signature, so it must not be gated here.
      if (opts.email && !coachedTeamNames.has(opts.team)) return false;
      return home === opts.team || away === opts.team;
    }
    return coachedTeamNames.has(home) || coachedTeamNames.has(away);
  });
  if (relevant.length === 0) return { fixtures: [] };
  const matchIds = relevant.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, relevant.map((m) => m.season || ""));
  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of allExceptions) {
    const mId = linkId(exc.match);
    if (!mId || !matchIds.includes(mId)) continue;
    exceptionsByMatch.set(mId, [...(exceptionsByMatch.get(mId) || []), exc]);
  }
  const fixtures = relevant.flatMap((m) => {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    const bothCoached = coachedTeamNames.has(home) && coachedTeamNames.has(away);
    const makeCard = (hkfcTeam: string, opponent: string, isHome: boolean) => {
      const team = teamsByName.get(hkfcTeam);
      const matchExceptions = exceptionsByMatch.get(m.id) || [];
      const statusByPlayer = new Map<string, string>();
      for (const e of matchExceptions) { const pid = linkId(e.player); if (pid) statusByPlayer.set(pid, e.availabilityStatus); }
      
      const unavailableExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Unavailable");
      const maybeExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Maybe");
      const unavailableNames = unavailableExcs.map((e: any) => nameOf(playerById.get(linkId(e.player) || ""))).filter(Boolean);
      const maybeNames = maybeExcs.map((e: any) => nameOf(playerById.get(linkId(e.player) || ""))).filter(Boolean);
      
      const selectedIds = isHome ? (m.selectedPlayersHome || []) : (m.selectedPlayersAway || []);
      const selectedPlayers = selectedIds.map((id) => ({ id, name: nameOf(playerById.get(id)) }));
      
      const selectedPositionSummary: Record<string, number> = {};
      for (const id of selectedIds) {
        const pos = POS_KEY[playerById.get(id)?.playingPosition ?? ""] ?? "FLEX";
        selectedPositionSummary[pos] = (selectedPositionSummary[pos] ?? 0) + 1;
      }
      
      return {
        id: m.id + (bothCoached ? (isHome ? "-home" : "-away") : ""),
        date: m.matchDate || "", 
        homeTeam: home, 
        awayTeam: away, 
        hkfcTeam, 
        opponent, 
        isHome,
        division: m.division || "", 
        venue: m.venue || "", 
        targetSquadSize: team?.targetSquadSize || 16,
        selectedCount: selectedIds.length, 
        selectedIds, 
        selectedPlayers,
        selectedPositionSummary, 
        hasGoalkeeperSelected: (selectedPositionSummary.GK ?? 0) > 0,
        selectedUnavailableNames: selectedIds
          .filter((id) => statusByPlayer.get(id) === "Unavailable")
          .map((id) => nameOf(playerById.get(id))),
        maybeCount: maybeExcs.length, 
        unavailableCount: unavailableExcs.length, 
        maybeNames, 
        unavailableNames,

      };
    };
    if (bothCoached && !opts.team) return [makeCard(home, away, true), makeCard(away, home, false)];
    if (opts.team) {
      if (home === opts.team) return [makeCard(home, away, true)];
      if (away === opts.team) return [makeCard(away, home, false)];
      return [];
    }
    if (coachedTeamNames.has(home)) return [makeCard(home, away, true)];
    return [makeCard(away, home, false)];
  });
  return { fixtures };
}
