import { Env, airtableFindAll, airtableFindById, linkId } from "./airtable";
import { getReferenceData, getPlayerByEmail, getExceptionsForSeasons } from "./reference";
import { getCached } from "../../src/lib/cache";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";
import type { Match, Player, Team } from "../../src/generated/domainTypes";
import type { ReferenceData } from "./reference";

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
    registeredTeam: teamName, playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "", isCoach, coachTeams, captainTeams, isSectionCaptain,
  };
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const rankMap = ref.teamRankMap;
  const playerTeamRank = rankMap[teamName] ?? 99;

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
  const ownMatchDates = new Set(
    upcoming.filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
      .map((m) => (m.matchDate || "").split("T")[0]),
  );
  type Categorized = { match: any; hkfcTeam: string; opponent: string; isHome: boolean; selectedIds: string[]; category: "own" | "playUpSelection" | "eligibleOther" };
  const categorized: Categorized[] = [];
  for (const m of upcoming) {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    const dateKey = (m.matchDate || "").split("T")[0];
    const matchInvolvesOwnTeam = home === teamName || away === teamName;
    const sides: { team: string; isHome: boolean }[] = [];
    if (teamNames.has(home)) sides.push({ team: home, isHome: true });
    if (teamNames.has(away)) sides.push({ team: away, isHome: false });
    for (const side of sides) {
      const isRegistered = side.team === teamName;
      const selectedIds = side.isHome ? (m.selectedPlayersHome || []) : (m.selectedPlayersAway || []);
      const isSelected = selectedIds.includes(playerId);
      const opponent = side.isHome ? away : home;
      const isHigher = (rankMap[side.team] ?? 99) < playerTeamRank;
      if (isRegistered) categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "own" });
      else if (isSelected) categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "playUpSelection" });
      else if (isHigher && ownMatchDates.has(dateKey) && !matchInvolvesOwnTeam)
        categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "eligibleOther" });
    }
  }
  if (categorized.length === 0) return { ...base, fixtures: [], eligibleOtherFixtures: [] };
  const relevantMatchIds = categorized.map((c) => c.match.id);
  const allExceptions = await getExceptionsForSeasons(env, categorized.map((c) => c.match.season || ""));
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
      isPlayUp: c.category !== "own", selectionTeam: c.category !== "own" ? c.hkfcTeam : undefined,
    };
  };
  return {
    ...base,
    fixtures: categorized.filter((c) => c.category !== "eligibleOther").map(buildCard),
    eligibleOtherFixtures: categorized.filter((c) => c.category === "eligibleOther").map(buildCard),
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
  return { playerName: player.preferredName || player.givenNames || "Player", registeredTeam: teamName, fixtures };
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
