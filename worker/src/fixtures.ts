import { Env, airtableFindAll, airtableFindById, linkId } from "./airtable";
import { getReferenceData, getPlayerByEmail, getExceptionsForSeasons } from "./reference";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";

async function getScheduledMatches(env: Env) {
  const records = await airtableFindAll(env, TABLES.match, '{Match Status}="Scheduled"');
  return records.map(mapMatch);
}

export async function getMyFixtures(env: Env, email: string) {
  const user = await getPlayerByEmail(env, email);
  if (!user) throw new HttpError("Player record not found for this email", 404);
  const playerId = user.id;
  const teamName = user.registeredTeam || "";
  const ref = await getReferenceData(env);

  const coachTeams = ref.teams.filter((t) => (t.coach || []).includes(user.id)).map((t) => t.teamName || "");
  const captainTeams = ref.teams.filter((t) => (t.teamCaptain || []).includes(user.id)).map((t) => t.teamName || "");
  const isSectionCaptain = ref.teams.some((t) => (t.sectionCaptain || []).includes(user.id));
  const isCoach = coachTeams.length > 0;

  const base = {
    playerName: user.preferredName || user.givenNames || "Player",
    registeredTeam: teamName,
    playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "",
    isCoach,
    coachTeams,
    captainTeams,
    isSectionCaptain,
  };

  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const rankMap = ref.teamRankMap;
  const playerTeamRank = rankMap[teamName] ?? 99;

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  // Calendar days on which the player's registered team plays. Used to find
  // same-day higher-team conflicts without dumping every higher-team match.
  const ownMatchDates = new Set(
    upcoming
      .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
      .map((m) => (m.matchDate || "").split("T")[0]),
  );

  // Categorise every HKFC side of every upcoming match.
  type Categorized = {
    match: any;
    hkfcTeam: string;
    opponent: string;
    isHome: boolean;
    selectedIds: string[];
    category: "own" | "playUpSelection" | "eligibleOther";
  };
  const categorized: Categorized[] = [];

  for (const m of upcoming) {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
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
      const teamRank = rankMap[side.team] ?? 99;
      const isHigher = teamRank < playerTeamRank;

      if (isRegistered) {
        categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "own" });
      } else if (isSelected) {
        // Selected for a team other than the registered team → play-up selection.
        categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "playUpSelection" });
      } else if (isHigher && ownMatchDates.has(dateKey) && !matchInvolvesOwnTeam) {
        // Same-day higher-ranked team, not selected, not the player's own match
        // → a conflict the player may want to release by marking unavailable.
        categorized.push({ match: m, hkfcTeam: side.team, opponent, isHome: side.isHome, selectedIds, category: "eligibleOther" });
      }
    }
  }

  if (categorized.length === 0) {
    return { ...base, fixtures: [], eligibleOtherFixtures: [] };
  }

  // Fetch availability exceptions for every relevant match.
  const relevantMatchIds = categorized.map((c) => c.match.id);
  const allExceptions = await getExceptionsForSeasons(env, categorized.map((c) => c.match.season || ""));
  const playerExceptions = allExceptions.filter(
    (e) => linkId(e.player) === playerId && relevantMatchIds.includes(linkId(e.match) || ""),
  );
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const buildCard = (c: Categorized) => {
    const team = teamsByName.get(c.hkfcTeam);
    const exc = exceptionByMatch.get(c.match.id);
    const isPlayUp = c.category !== "own";
    return {
      id: c.match.id,
      date: c.match.matchDate || "",
      homeTeam: c.match.homeTeam || "",
      awayTeam: c.match.awayTeam || "",
      hkfcTeam: c.hkfcTeam,
      opponent: c.opponent,
      isHome: c.isHome,
      venue: c.match.venue || "",
      division: c.match.division || "",
      availabilityStatus: exc?.availabilityStatus || "Available",
      playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "",
      selectionStatus: c.selectedIds.includes(playerId) ? "Selected" : "",
      selectionNotes: "",
      selectedCount: c.selectedIds.length,
      targetSquadSize: team?.targetSquadSize || 16,
      isPlayUp,
      selectionTeam: isPlayUp ? c.hkfcTeam : undefined,
    };
  };

  const fixtures = categorized
    .filter((c) => c.category === "own" || c.category === "playUpSelection")
    .map(buildCard);
  const eligibleOtherFixtures = categorized
    .filter((c) => c.category === "eligibleOther")
    .map(buildCard);

  return { ...base, fixtures, eligibleOtherFixtures };
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
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  const matchIds = upcoming.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, upcoming.map((m) => m.season || ""));
  const playerExceptions = allExceptions.filter(
    (e) => linkId(e.player) === playerId && matchIds.includes(linkId(e.match) || ""),
  );
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const fixtures = upcoming.flatMap((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const isDerby = teamNames.has(home) && teamNames.has(away);
    if (!isDerby) {
      const isHome = home === teamName;
      const hkfcTeam = teamNames.has(home) ? home : away;
      const opponent = hkfcTeam === home ? away : home;
      const exc = exceptionByMatch.get(m.id);
      const isSelected = (m.selectedPlayersHome || []).includes(playerId) || (m.selectedPlayersAway || []).includes(playerId);
      return [{
        id: m.id, date: m.matchDate || "", homeTeam: home, awayTeam: away,
        hkfcTeam, opponent, isHome, venue: m.venue || "", division: m.division || "",
        availabilityStatus: exc?.availabilityStatus || "Available",
        playerNotes: exc?.note || "", availabilityExceptionId: exc?.id || "",
        selectionStatus: isSelected ? "Selected" : "",
      }];
    }
    return [home, away]
      .filter((sideTeam) => sideTeam === teamName)
      .map((sideTeam) => {
        const isHome = sideTeam === home;
        const exc = exceptionByMatch.get(m.id);
        const isSelected = isHome ? (m.selectedPlayersHome || []).includes(playerId) : (m.selectedPlayersAway || []).includes(playerId);
        return {
          id: m.id, date: m.matchDate || "", homeTeam: home, awayTeam: away,
          hkfcTeam: sideTeam, opponent: sideTeam === home ? away : home, isHome,
          venue: m.venue || "", division: m.division || "",
          availabilityStatus: exc?.availabilityStatus || "Available",
          playerNotes: exc?.note || "", availabilityExceptionId: exc?.id || "",
          selectionStatus: isSelected ? "Selected" : "",
        };
      });
  });

  return {
    playerName: player.preferredName || player.givenNames || "Player",
    registeredTeam: teamName,
    fixtures,
  };
}

export async function getUpcomingFixtures(env: Env, opts: { email?: string; team?: string }) {
  const ref = await getReferenceData(env);
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const playersById = new Map(ref.players.map((p) => [p.id, p.preferredName || p.givenNames || "Player"]));

  let coachedTeamNames = new Set<string>();
  if (opts.email) {
    const user = await getPlayerByEmail(env, opts.email);
    if (user) {
      coachedTeamNames = new Set(ref.teams.filter((t) => (t.coach || []).includes(user.id)).map((t) => t.teamName || ""));
    }
  }

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  const relevant = upcoming.filter((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    if (opts.team) return home === opts.team || away === opts.team;
    return coachedTeamNames.has(home) || coachedTeamNames.has(away);
  });

  if (relevant.length === 0) return { fixtures: [] };

  const matchIds = relevant.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, relevant.map((m) => m.season || ""));
  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of allExceptions) {
    const mId = linkId(exc.match);
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = exceptionsByMatch.get(mId) || [];
    existing.push(exc);
    exceptionsByMatch.set(mId, existing);
  }

  const fixtures = relevant.flatMap((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const bothCoached = coachedTeamNames.has(home) && coachedTeamNames.has(away);

    const makeCard = (hkfcTeam: string, opponent: string, isHome: boolean) => {
      const team = teamsByName.get(hkfcTeam);
      const matchExceptions = exceptionsByMatch.get(m.id) || [];
      const unavailableExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Unavailable");
      const maybeExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Maybe");
      const unavailableNames = unavailableExcs
        .map((e: any) => playersById.get(linkId(e.player) || ""))
        .filter((name: any): name is string => !!name);
      const maybeNames = maybeExcs
        .map((e: any) => playersById.get(linkId(e.player) || ""))
        .filter((name: any): name is string => !!name);
      const selectedIds = isHome ? (m.selectedPlayersHome || []) : (m.selectedPlayersAway || []);
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
        availableCount: 0,
        maybeCount: maybeExcs.length,
        unavailableCount: unavailableExcs.length,
        maybeNames,
        unavailableNames,
      };
    };

    if (bothCoached && !opts.team) {
      return [makeCard(home, away, true), makeCard(away, home, false)];
    }
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