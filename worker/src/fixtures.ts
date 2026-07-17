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

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  if (upcoming.length === 0) return { ...base, fixtures: [] };

  const matchIds = upcoming.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, upcoming.map((m) => m.season || ""));
  
  const playerExceptions = allExceptions.filter(
    (e) => linkId(e.player) === user.id && matchIds.includes(linkId(e.match) || "")
  );
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const fixtures = upcoming.map((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const isHome = home === teamName;
    const hkfcTeam = teamNames.has(home) ? home : away;
    const opponent = hkfcTeam === home ? away : home;
    const team = teamsByName.get(hkfcTeam);
    const exc = exceptionByMatch.get(m.id);
    
    const isSelected = (m.selectedPlayersHome || []).includes(user.id) || (m.selectedPlayersAway || []).includes(user.id);

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
      availabilityStatus: exc?.availabilityStatus || "Available",
      playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "",
      selectionStatus: isSelected ? "Selected" : "",
      selectionNotes: "", 
      selectedCount: (m.selectedPlayersHome || []).length + (m.selectedPlayersAway || []).length,
      targetSquadSize: team?.targetSquadSize || 16,
    };
  });

  return { ...base, fixtures };
}

export async function getPlayerFixtures(env: Env, playerId: string) {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) throw new HttpError("Player not found or inactive", 404);
  const player = mapPlayer(record);
  if (!player.active) throw new HttpError("Player not found or inactive", 404);

  const teamName = player.registeredTeam || "";
  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  const matchIds = upcoming.map((m) => m.id);
  const allExceptions = await getExceptionsForSeasons(env, upcoming.map((m) => m.season || ""));
  const playerExceptions = allExceptions.filter((e) => linkId(e.player) === playerId && matchIds.includes(linkId(e.match) || ""));
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const fixtures = upcoming.map((m) => {
    const exc = exceptionByMatch.get(m.id);
    const isSelected = (m.selectedPlayersHome || []).includes(playerId) || (m.selectedPlayersAway || []).includes(playerId);
    
    return {
      id: m.id,
      date: m.matchDate || "",
      homeTeam: m.homeTeam || "",
      awayTeam: m.awayTeam || "",
      venue: m.venue || "",
      division: m.division || "",
      availabilityStatus: exc?.availabilityStatus || "Available",
      playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "",
      selectionStatus: isSelected ? "Selected" : "",
    };
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
      const unavailableCount = matchExceptions.filter(e => e.availabilityStatus === "Unavailable").length;
      const maybeCount = matchExceptions.filter(e => e.availabilityStatus === "Maybe").length;
      const selectedCount = isHome ? (m.selectedPlayersHome || []).length : (m.selectedPlayersAway || []).length;
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
        selectedCount,
        availableCount: 0,
        maybeCount,
        unavailableCount,
      };
    };

    // Derby + coach both sides ? two cards
    if (bothCoached && !opts.team) {
      return [makeCard(home, away, true), makeCard(away, home, false)];
    }

    // Tab filter ? card from that tab's perspective
    if (opts.team) {
      if (home === opts.team) return [makeCard(home, away, true)];
      if (away === opts.team) return [makeCard(away, home, false)];
      return [];
    }

    // Coach only manages one side
    if (coachedTeamNames.has(home)) return [makeCard(home, away, true)];
    return [makeCard(away, home, false)];
  });

  return { fixtures };
}