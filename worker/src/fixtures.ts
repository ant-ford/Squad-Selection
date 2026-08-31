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
  const playerId = user.id;
  const teamName = user.registeredTeam || "";
  // Display team (optics): Selected Team EOS -> SOS -> Registered Team. The
  // player experiences THIS team as "My Team"; every business rule (play-up
  // legality, same-day priority, suspension) keeps using the true team.
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
    // Display value (optics). Fixture categorisation below keeps using the
    // true Registered Team so legality and conflicts stay accurate.
    registeredTeam: selectedDisplayTeam(user) || teamName, displayTeam, playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "", isCoach, coachTeams, captainTeams, isSectionCaptain,
  };
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const rankMap = ref.teamRankMap;
  const displayRank = rankMap[displayTeam] ?? 99;

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
      ...base,
      specialGoalkeeperView: true,
      fixtures: cards.map((c) => ({
        ...c,
        availabilityStatus: exceptionByMatch.get(c.id)?.availabilityStatus || "Available",
        playerNotes: exceptionByMatch.get(c.id)?.note || "",
        availabilityExceptionId: exceptionByMatch.get(c.id)?.id || "",
      })),
    };
  }

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches.filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
  // ---------------------------------------------------------------------
  // Fixture categories (presentation only - the eligibility engine remains
  // the sole authority on whether a fixture is actually playable):
  //   My Team   - fixtures for the display team (always shown)
  //   Play-Up   - fixtures for the two teams immediately above the player's
  //               REGISTERED team, skipping teams they are already selected
  //               for (and the display team), closest first
  //   Support   - fixtures for teams below the display team
  // Play-up and support candidates must pass evaluatePlayerEligibility for
  // that specific team+fixture before they are shown to the player.
  // ---------------------------------------------------------------------
  const trueRank = rankMap[teamName] ?? 99;
  const selectedTeams = new Set<string>();
  for (const m of upcoming) {
    if ((m.selectedPlayersHome || []).includes(playerId)) selectedTeams.add(m.homeTeam || "");
    if ((m.selectedPlayersAway || []).includes(playerId)) selectedTeams.add(m.awayTeam || "");
  }
  const aboveTeams = Object.entries(rankMap)
    .filter(([name, rank]) => name && rank > 0 && rank < 99 && rank < trueRank)
    .sort((a, b) => b[1] - a[1]) // closest above the Registered Team first
    .map(([name]) => name);
  const playUpTeams: string[] = [];
  for (const name of aboveTeams) {
    if (name === displayTeam || selectedTeams.has(name)) continue;
    playUpTeams.push(name);
    if (playUpTeams.length >= 2) break;
  }
  const playUpTeamSet = new Set(playUpTeams);

  type FixtureCategory = "own" | "play-up" | "support";
  type Categorized = { match: any; hkfcTeam: string; opponent: string; isHome: boolean; selectedIds: string[]; category: FixtureCategory };
  const categorized: Categorized[] = [];
  for (const m of upcoming) {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    const sides: { team: string; isHome: boolean; selectedIds: string[] }[] = [];
    if (teamNames.has(home)) sides.push({ team: home, isHome: true, selectedIds: m.selectedPlayersHome || [] });
    if (teamNames.has(away)) sides.push({ team: away, isHome: false, selectedIds: m.selectedPlayersAway || [] });
    const buildEntry = (s: { team: string; isHome: boolean; selectedIds: string[] }, category: FixtureCategory): Categorized => ({
      match: m, hkfcTeam: s.team, opponent: s.isHome ? away : home, isHome: s.isHome, selectedIds: s.selectedIds, category,
    });
    // One card per match, priority: My Team > play-up > support.
    const ownSide = sides.find((s) => s.team === displayTeam);
    const playUpSide = sides.find((s) => playUpTeamSet.has(s.team));
    const supportSide = sides.find((s) => (rankMap[s.team] ?? 99) > displayRank && !playUpTeamSet.has(s.team));
    if (ownSide) categorized.push(buildEntry(ownSide, "own"));
    else if (playUpSide) categorized.push(buildEntry(playUpSide, "play-up"));
    else if (supportSide) categorized.push(buildEntry(supportSide, "support"));
  }
  if (categorized.length === 0) return { ...base, displayTeam, fixtures: [], playUpOpportunities: [], supportFixtures: [] };

  // Eligibility gating: play-up and support candidates must pass the existing
  // eligibility engine (evaluatePlayerEligibility) for that team+fixture.
  // My Team fixtures are shown unconditionally. Contexts come from the
  // shared season context (cached - no extra Airtable requests per fixture
  // beyond the season-wide reads).
  const teamMap = new Map(ref.teams.map((t) => [t.teamName || "", t]));
  const gateCache = new Map<string, boolean>();
  const isEligibleFor = async (cand: Categorized, neutraliseSameDay: boolean): Promise<boolean> => {
    const key = `${cand.match.id}:${cand.hkfcTeam}`;
    const cached = gateCache.get(key);
    if (cached !== undefined) return cached;
    let eligible = false;
    try {
      const { ctx } = await buildEvaluationContext(env, cand.match, rankMap, teamMap, ref.players, cand.hkfcTeam);
      if (neutraliseSameDay) {
        // The portal shows opportunities the player can PLAN around, so the
        // same-day availability dimension (which depends on other fixtures'
        // scheduling and availability choices the player has not made yet) is
        // neutralised for PRESENTATION only. Every inherent rule - suspension,
        // play-up limit, movement/Premier restrictions, U21, cup - still
        // applies, and the selection-time evaluation (coach view, same-day
        // blocks) is unchanged.
        ctx.sameDayMatches = [];
        ctx.sameDayFixtures = [];
        ctx.sameDaySelectionsByTeam = new Map();
      }
      const result = evaluatePlayerEligibility(user, cand.match, ctx);
      eligible = result.status !== "blocked";
    } catch (err) {
      console.error("[MyFixtures] eligibility evaluation failed:", err);
      eligible = false;
    }
    gateCache.set(key, eligible);
    return eligible;
  };

  const gatedPlayUp: Categorized[] = [];
  for (const cand of categorized.filter((x) => x.category === "play-up")) {
    if (await isEligibleFor(cand, true)) gatedPlayUp.push(cand);
  }
  const gatedSupport: Categorized[] = [];
  for (const cand of categorized.filter((x) => x.category === "support")) {
    if (await isEligibleFor(cand, false)) gatedSupport.push(cand);
  }

  const relevantCategorized = [
    ...categorized.filter((x) => x.category === "own"),
    ...gatedPlayUp,
    ...gatedSupport,
  ];
  const relevantMatchIds = relevantCategorized.map((c) => c.match.id);
  const allExceptions = await getExceptionsForSeasons(env, relevantCategorized.map((c) => c.match.season || ""));
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId && relevantMatchIds.includes(linkId(e.match) || ""));
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));
  const buildCard = (c: Categorized) => {
    const team = teamsByName.get(c.hkfcTeam);
    const exc = exceptionByMatch.get(c.match.id);
    return {
      id: c.match.id, date: c.match.matchDate || "", homeTeam: c.match.homeTeam || "", awayTeam: c.match.awayTeam || "",
      hkfcTeam: c.hkfcTeam, opponent: c.opponent, isHome: c.isHome, venue: c.match.venue || "", division: c.match.division || "",
      availabilityStatus: exc?.availabilityStatus || "Available", playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "", selectionStatus: c.selectedIds.includes(playerId) ? "Selected" : "",
      selectionNotes: "", selectedCount: c.selectedIds.length, targetSquadSize: team?.targetSquadSize || 16,
      // fixtureCategory is presentation only; "play-up" is used exclusively
      // for the two teams above the Registered Team (per the skip rules).
      fixtureCategory: c.category,
      isPlayUp: c.category === "play-up",
      selectionTeam: c.category !== "own" ? c.hkfcTeam : undefined,
    };
  };
  return {
    ...base,
    displayTeam,
    fixtures: categorized.filter((c) => c.category === "own").map(buildCard),
    playUpOpportunities: gatedPlayUp.map(buildCard),
    supportFixtures: gatedSupport.map(buildCard),
  };
}

export async function getPlayerFixtures(env: Env, playerId: string) {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(record);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);
  const ref = await getReferenceData(env);
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const teamName = player.registeredTeam || "";
  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches.filter((m) => m.matchDate && m.matchDate >= now)
    .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
  const matchIds = upcoming.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, upcoming.map((m) => m.season || ""));
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId && matchIds.includes(linkId(e.match) || ""));
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));
  const fixtures = upcoming.flatMap((m) => {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    const isDerby = teamNames.has(home) && teamNames.has(away);
    if (!isDerby) {
      const isHome = home === teamName;
      const hkfcTeam = teamNames.has(home) ? home : away;
      const exc = exceptionByMatch.get(m.id);
      const isSelected = (m.selectedPlayersHome || []).includes(playerId) || (m.selectedPlayersAway || []).includes(playerId);
      return [{ id: m.id, date: m.matchDate || "", homeTeam: home, awayTeam: away, hkfcTeam, opponent: hkfcTeam === home ? away : home, isHome, venue: m.venue || "", division: m.division || "", availabilityStatus: exc?.availabilityStatus || "Available", playerNotes: exc?.note || "", availabilityExceptionId: exc?.id || "", selectionStatus: isSelected ? "Selected" : "" }];
    }
    return [home, away].filter((s) => s === teamName).map((sideTeam) => {
      const isHome = sideTeam === home;
      const exc = exceptionByMatch.get(m.id);
      const isSelected = isHome ? (m.selectedPlayersHome || []).includes(playerId) : (m.selectedPlayersAway || []).includes(playerId);
      return { id: m.id, date: m.matchDate || "", homeTeam: home, awayTeam: away, hkfcTeam: sideTeam, opponent: sideTeam === home ? away : home, isHome, venue: m.venue || "", division: m.division || "", availabilityStatus: exc?.availabilityStatus || "Available", playerNotes: exc?.note || "", availabilityExceptionId: exc?.id || "", selectionStatus: isSelected ? "Selected" : "" };
    });
  });
  // Display value (optics); the fixture list itself stays on the true team.
  return { playerName: player.preferredName || player.givenNames || "Player", registeredTeam: selectedDisplayTeam(player) || teamName, fixtures };
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
      if (!coachedTeamNames.has(opts.team)) return false;
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
