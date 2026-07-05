import { Env, airtableFindAll, airtableFindById, linkId } from "./airtable";
import { getReferenceData, getPlayerByEmail } from "./reference";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapSelection } from "../../src/mappers/selectionMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { mapPlayer } from "../../src/mappers/playerMapper";

async function getScheduledMatches(env: Env) {
  const records = await airtableFindAll(env, TABLES.match, '{Match Status}="Scheduled"');
  return records.map(mapMatch);
}

/** Ported from src/api/getMyFixtures.ts. */
export async function getMyFixtures(env: Env, email: string) {
  const user = await getPlayerByEmail(env, email);
  if (!user) throw new HttpError("Player record not found for this email", 404);

  const teamName = user.registeredTeam || "";
  const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
  const isCoach = roles.includes("Coach");

  const base = {
    playerName: user.preferredName || user.givenNames || "Player",
    registeredTeam: teamName,
    playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "",
    isCoach,
  };

  const ref = await getReferenceData(env);
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map((t) => t.teamName));

  const allMatches = await getScheduledMatches(env);
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter((m) => m.matchDate && m.matchDate >= now)
    .filter((m) => (m.homeTeam || "") === teamName || (m.awayTeam || "") === teamName)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  if (upcoming.length === 0) {
    return { ...base, fixtures: [] };
  }

  const matchIds = upcoming.map((m) => m.id);

  const [allExceptions, allSelections] = await Promise.all([
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
  ]);

  const playerExceptions = allExceptions.filter(
    (e) => linkId(e.player) === user.id && matchIds.includes(linkId(e.match) || "")
  );
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const allMatchSelections = allSelections.filter((s) => matchIds.includes(linkId(s.match) || ""));
  const playerSelections = allMatchSelections.filter((s) => linkId(s.player) === user.id);
  const selectionByMatch = new Map(playerSelections.map((s) => [linkId(s.match) || "", s]));

  const selectedCountByMatch = new Map<string, number>();
  for (const s of allMatchSelections) {
    if (s.selectionStatus !== "Selected") continue;
    const mId = linkId(s.match);
    if (mId) selectedCountByMatch.set(mId, (selectedCountByMatch.get(mId) || 0) + 1);
  }

  const fixtures = upcoming.map((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const isHome = home === teamName;
    const hkfcTeam = teamNames.has(home) ? home : away;
    const opponent = hkfcTeam === home ? away : home;
    const team = teamsByName.get(hkfcTeam);
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);

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
      selectionStatus: sel?.selectionStatus || "",
      selectionNotes: sel?.selectionNotes || "",
      selectedCount: selectedCountByMatch.get(m.id) || 0,
      targetSquadSize: team?.targetSquadSize || 16,
    };
  });

  return { ...base, fixtures };
}

/** Ported from src/api/getPlayerFixtures.ts (unauthenticated, player-facing). */
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

  const [allExceptions, allSelections] = await Promise.all([
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
  ]);

  const playerExceptions = allExceptions.filter(
    (e) => linkId(e.player) === playerId && matchIds.includes(linkId(e.match) || "")
  );
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));

  const playerSelections = allSelections.filter(
    (s) => linkId(s.player) === playerId && matchIds.includes(linkId(s.match) || "")
  );
  const selectionByMatch = new Map(playerSelections.map((s) => [linkId(s.match) || "", s]));

  const fixtures = upcoming.map((m) => {
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);
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
      selectionStatus: sel?.selectionStatus || "",
    };
  });

  return {
    playerName: player.preferredName || player.givenNames || "Player",
    registeredTeam: teamName,
    fixtures,
  };
}

/** Ported from src/api/getUpcomingFixtures.ts (coach-facing fixture list). */
export async function getUpcomingFixtures(
  env: Env,
  opts: { email?: string; team?: string }
) {
  const ref = await getReferenceData(env);
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));

  let coachedTeamNames = new Set<string>();
  if (opts.email) {
    const user = await getPlayerByEmail(env, opts.email);
    if (user) {
      coachedTeamNames = new Set(
        ref.teams
          .filter(
            (t) =>
              (t.coach || []).includes(user.id) ||
              (t.teamCaptain || []).includes(user.id) ||
              (t.sectionCaptain || []).includes(user.id)
          )
          .map((t) => t.teamName || "")
      );
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
  const [allSelections, allExceptions] = await Promise.all([
    airtableFindAll(env, TABLES.squadSelection).then((r) => r.map(mapSelection)),
    airtableFindAll(env, TABLES.availabilityException).then((r) => r.map(mapAvailability)),
  ]);

  const selectionsByMatch = new Map<string, any[]>();
  for (const sel of allSelections) {
    const mId = linkId(sel.match);
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = selectionsByMatch.get(mId) || [];
    existing.push(sel);
    selectionsByMatch.set(mId, existing);
  }

  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of allExceptions) {
    const mId = linkId(exc.match);
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = exceptionsByMatch.get(mId) || [];
    existing.push(exc);
    exceptionsByMatch.set(mId, existing);
  }

  const fixtures = relevant.map((m) => {
    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const isHome = coachedTeamNames.has(home) || (opts.team ? home === opts.team : false);
    const hkfcTeam = isHome ? home : away;
    const opponent = isHome ? away : home;
    const team = teamsByName.get(hkfcTeam);

    const matchSelections = selectionsByMatch.get(m.id) || [];
    const selectedCount = matchSelections.filter((s) => s.selectionStatus === "Selected").length;
    const reserveCount = matchSelections.filter((s) => s.selectionStatus === "Reserve").length;

    const matchExceptions = exceptionsByMatch.get(m.id) || [];
    const unavailableCount = matchExceptions.filter((e) => e.availabilityStatus === "Unavailable").length;
    const maybeCount = matchExceptions.filter((e) => e.availabilityStatus === "Maybe").length;

    return {
      id: m.id,
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
      reserveCount,
      availableCount: 0,
      maybeCount,
      unavailableCount,
    };
  });

  return { fixtures };
}
