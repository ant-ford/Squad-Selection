import { linkId } from "../../shared/airtableValueUtils";
import { matches } from "./data/matches";
import { teams as teamsRepo } from "./data/teams";
import { isRowId } from "./data/ids";
import type { Env } from "./env";
import { getVersioned } from "./cache";
import { getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { availabilityExceptions } from "./data/availabilityExceptions";
import { evaluatePlayerEligibility, type EvaluationContext } from "./eligibility";
import { HttpError } from "./http";
import type { KitColour, Match, Player, Team } from "../../shared/schema/domainTypes";
import { buildEvaluationContext, SEASON_INDEX_DEPS } from "./seasonContext";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { hkDateKey } from "../../shared/hkDateKey";
import { effectiveAvailability, getAllAvailabilityRules, indexRulesByPlayer } from "./availabilityRules";
import { hkfcSides } from "./match";
import { notSeenWeeks } from "./lastSeen";

import { fixtureChange } from "../../shared/fixtureChange";
type MatchSide = "home" | "away";

// ── Cached match-record fetch ───────────────────────────────────────────
//
// The raw match record, for READ endpoints (getPlayersForMatch); write
// paths read it fresh. Kept under the matches and match_selections cache
// versions (cache.ts getVersioned), which every squad save moves, so a
// coach is never served the selections their save replaced, on any isolate.

async function getMatchRecord(env: Env, matchId: string): Promise<Match> {
  return getVersioned<Match>(env, `match:${matchId}`, ["matches", "match_selections"], async () => {
    const match = await matches(env).getById(matchId);
    if (!match) throw new HttpError("Match not found", 404);
    return match;
  });
}

// ── HKFC side resolution ────────────────────────────────────────────────
function resolveHkfcSide(match: Match, rankMap: Record<string, number>, side?: MatchSide): MatchSide {
  const sides = hkfcSides(match, new Set(Object.keys(rankMap)));
  if (side === "home" && sides.home) return "home";
  if (side === "away" && sides.away) return "away";
  if (sides.home && !sides.away) return "home";
  if (sides.away && !sides.home) return "away";
  if (sides.home && sides.away) return side ?? "home";
  // Fallback for derby/edge cases: trust the URL side or default home
  if (side) return side;
  return "home";
}

function hkfcTeamName(match: Match, rankMap: Record<string, number>, side?: MatchSide): string {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.homeTeam || "" : match.awayTeam || "";
}

function getSelectedPlayerIds(match: Match, rankMap: Record<string, number>, side?: MatchSide): string[] {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.selectedPlayersHome || [] : match.selectedPlayersAway || [];
}

type SelectionField = "selectedPlayersHome" | "selectedPlayersAway";

function getSelectionFieldName(match: Match, rankMap: Record<string, number>, side?: MatchSide): SelectionField {
  return resolveHkfcSide(match, rankMap, side) === "home" ? "selectedPlayersHome" : "selectedPlayersAway";
}

// ── Public endpoints ────────────────────────────────────────────────────
export async function getPlayersForMatch(env: Env, matchId: string, side?: "home" | "away") {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));
  const match = await getMatchRecord(env, matchId);
  const hkfcTeam = hkfcTeamName(match, teamRankMap, side);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  // Kept under the versions of everything it is built from (the season
  // index's tables and the availability rules): a squad saved on one isolate
  // shows on every other on its next request.
  const cacheKey = `players-for-match:${matchId}:${side ?? "auto"}`;
  // This match's own answers and notes come from the poll's read (one match,
  // narrow columns, the same versioned entry the 30 s poll uses), alongside
  // the context; the context itself no longer carries them.
  const [heavyData, forMatch] = await Promise.all([
    getVersioned(env, cacheKey, [...SEASON_INDEX_DEPS, "availability_rules"], async () => {
      const { ctx } = await buildEvaluationContext(env, match, teamRankMap, teamMap, ref.players, hkfcTeam);
      return { ctx, allPlayers: ref.players };
    }),
    getAvailabilityForMatch(env, matchId),
  ]);
  const { ctx, allPlayers } = heavyData;

  const exceptionMap = new Map<string, { availabilityStatus: string; note: string; playerNotes?: string }>();
  for (const exc of forMatch.exceptions) {
    if (exc.playerId) exceptionMap.set(exc.playerId, { availabilityStatus: exc.status, note: exc.notes });
  }

  const selectedPlayerIds = new Set(getSelectedPlayerIds(match, teamRankMap, side));
  const rulesByPlayer = indexRulesByPlayer(await getAllAvailabilityRules(env));

  const matchDateKey = hkDateKey(match.matchDate);
  const thisTeamRank = teamRankMap[hkfcTeam] ?? UNRANKED_TEAM_RANK;

  const players = allPlayers.map((p) => {
    const isSelected = selectedPlayerIds.has(p.id);
    const exc = exceptionMap.get(p.id);
    // Standing rules supply the default for players who have not answered
    // this fixture. Coaches need to know which it is - "hasn't been asked"
    // reads very differently from "said no" - so the flag rides along.
    const playerRank = teamRankMap[p.registeredTeam || ""] ?? UNRANKED_TEAM_RANK;
    const effective = effectiveAvailability(exc?.availabilityStatus, rulesByPlayer.get(p.id) ?? [], {
      date: matchDateKey,
      isPlayUp: thisTeamRank < playerRank,
      isSupport: thisTeamRank > playerRank,
    }, { optInOnly: p.optInOnly });
    const availabilityStatus = effective.status;
    const playerNotes = exc?.note || exc?.playerNotes || "";
    const eligibility = evaluatePlayerEligibility(p, match, ctx);
    const name = [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player";
    // Blocks carry the stable internal ruleId alongside the exact reason string.
    const blocks = eligibility.status === "blocked" && eligibility.reason
      ? [{ rule: eligibility.ruleId ?? "", reason: eligibility.reason }]
      : [];
    const conflicts: { type: string; team: string; matchId: string }[] = [];
    if (eligibility.selectedByTeam) conflicts.push({ type: "selected", team: eligibility.selectedByTeam, matchId: "" });
    if (eligibility.sameDayHigherTeam) conflicts.push({ type: "available", team: eligibility.sameDayHigherTeam, matchId: "" });
    // Soft coach signal: available for THIS fixture but marked Unavailable
    // for a same-day LOWER-ranked HKFC fixture (support duty). Presentation
    // only - computed from existing exceptions, no extra Airtable reads.
    const supportUnavailable: string[] = [];
    if (availabilityStatus !== "Unavailable") {
      const seenTeams = new Set<string>();
      for (const fx of ctx.sameDayFixtures) {
        if ((teamRankMap[fx.teamName] ?? UNRANKED_TEAM_RANK) <= thisTeamRank) continue;
        if (seenTeams.has(fx.teamName)) continue;
        if (ctx.unavailablePlayerMatchKeys.has(`${p.id}:${fx.matchId}`)) {
          supportUnavailable.push(fx.teamName);
          seenTeams.add(fx.teamName);
        }
      }
    }
    return {
      id: p.id,
      preferredName: name,
      // Shirt number, as text: the Airtable field is a formula over a text
      // value, so "7" and "07" are both possible. Blank when unassigned.
      shirtNo: p.shirtNoValue || "",
      // Coaches build WhatsApp click-to-chat links in the browser, so the
      // number has to reach the client. This endpoint is coach-only; the
      // player-facing team list (getTeamAvailabilityForMatch) never includes it.
      mobile: p.mobileNo || "",
      // Display value: Selected Team EOS -> SOS -> Registered Team (optics).
      // Eligibility above was computed from the true Registered Team.
      registeredTeam: selectedDisplayTeam(p),
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      /** True when the status came from a standing rule, not an explicit tap. */
      availabilityFromRule: effective.fromRule,
      /**
       * True when a coach has inverted this player's default, so anything
       * they have not answered reads as Unavailable. Coaches need to tell
       * that apart from a player who actually declined.
       */
      optInOnly: p.optInOnly === true,
      /** Weeks since they last opened Eddy, when 6+ and they haven't answered this fixture (lastSeen.ts). */
      notSeenWeeks: notSeenWeeks(p.lastSeenAt, exc !== undefined),
      supportUnavailable,
      playerNotes,
      playUpCount: eligibility.playUpCount,
      eligibilityStatus: eligibility.status,
      reason: eligibility.reason,
      blocks,
      warnings: eligibility.warnings,
      conflicts,
      selectedByTeam: eligibility.selectedByTeam,
      sameDayHigherTeam: eligibility.sameDayHigherTeam,
      isU21: p.u21Eligible || false,
      isVisitingPlayer: p.isVisitingPlayer || false,
      selectionStatus: isSelected ? "Selected" : "",
      selectionId: "",
    };
  });

  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    const order = { eligible: 0, warning: 1, blocked: 2 } as const;
    return (order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0);
  });

  const teamsByName = new Map(teams.map((t) => [t.teamName || "", t]));
  const resolvedSide = resolveHkfcSide(match, teamRankMap, side);
  const matchInfo = {
    hkfcTeam,
    date: match.matchDate || "",
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    division: match.division || "",
    competitionType: match.competitionType || "",
    venue: match.venue || "",
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: selectedPlayerIds.size,
    autoSelectEnabled: match.autoSelectEnabled ?? false,
    autoSelectPlayerIds: teamsByName.get(hkfcTeam)?.autoSelectPlayers || [],
    // Which side this screen is selecting, so the kit toggle writes the
    // right field. Uses the same resolver as the selection write path, so a
    // derby cannot end up reading one side's kit while writing the other's.
    side: resolvedSide,
    kit: ((resolvedSide === "away" ? match.awayKit : match.homeKit) || "") as KitColour,
    // The version of the squad listed here, read from the same record, so
    // the two always agree. A save sends it back (POST /api/squad/changes).
    selectionVersion: (resolvedSide === "away" ? match.selectionVersionAway : match.selectionVersionHome) ?? 0,
    /** Moved or venue changed in the last 7 days: Notify offers a message about it. */
    change: fixtureChange(match) ?? undefined,
  };
  return { match: matchInfo, players };
}

/** A same-day lower-team selection that a higher team's pick replaced. */
export interface DisplacedSelection {
  playerId: string;
  playerName: string;
  team: string;
  matchId: string;
}

/**
 * Bye-Law 7.1 (Sept 2026): nobody plays for more than one team on a match
 * day, U21s included. When a higher team picks a player that a same-day
 * lower team has already selected, the higher team wins (spec §7.3): the
 * player is taken out of the lower squad. The opposite direction never gets
 * this far - the engine blocks a lower team from picking someone a higher
 * team has selected (Selected for [Team] on same day).
 *
 * Which lower squads to look at comes from the evaluation context's season
 * index, which can be a few seconds behind. Each removal is applied to the
 * lower squad as it is now (apply_squad_changes, no version check), so
 * nothing is removed that is not really there and nobody else's changes to
 * that squad are undone; a lower selection made in the last few seconds on
 * another isolate can be missed, and then shows up as the double-booked chip
 * as before.
 *
 * A lower match already marked Played is left alone: that appearance
 * happened, and rewriting its squad would not undo it.
 */
async function releaseFromLowerSameDaySquads(
  env: Env,
  ctx: EvaluationContext,
  targetTeam: string,
  playerIds: string[],
  rankMap: Record<string, number>,
  playersById: Map<string, Player>,
  actorId: string | null = null,
): Promise<DisplacedSelection[]> {
  const targetRank = rankMap[targetTeam] ?? UNRANKED_TEAM_RANK;
  const byMatch = new Map<string, { team: string; playerIds: Set<string> }[]>();
  for (const fixture of ctx.sameDayFixtures) {
    if ((rankMap[fixture.teamName] ?? UNRANKED_TEAM_RANK) <= targetRank) continue;
    const key = `${fixture.matchId}:${fixture.teamName}`;
    const ids = playerIds.filter((id) => ctx.selectionsByPlayer.get(id)?.has(key));
    if (ids.length === 0) continue;
    const list = byMatch.get(fixture.matchId) ?? [];
    list.push({ team: fixture.teamName, playerIds: new Set(ids) });
    byMatch.set(fixture.matchId, list);
  }

  const displaced: DisplacedSelection[] = [];
  for (const [lowerMatchId, teams] of byMatch) {
    // Status and team names from the season index: neither changes in the
    // seconds it can be behind, and the removal itself reads the squad fresh.
    const lower = ctx.matchesById.get(lowerMatchId);
    if (!lower) continue;
    if (lower.matchStatus === "Played") continue;
    for (const { team, playerIds: ids } of teams) {
      const sides: [string | undefined, MatchSide][] = [[lower.homeTeam, "home"], [lower.awayTeam, "away"]];
      for (const [sideTeam, side] of sides) {
        if (sideTeam !== team) continue;
        const result = await matches(env).applySelectionChanges(lowerMatchId, {
          side, add: [], remove: [...ids], version: null, actorId, source: "release",
        });
        if (result.status !== "ok") continue;
        for (const id of result.removed) displaced.push({ playerId: id, playerName: playerName(playersById.get(id)), team, matchId: lowerMatchId });
      }
    }
    // The match record is kept under the match_selections version, which
    // the release moved: nothing to drop.
  }
  return displaced;
}

function playerName(p: Player | undefined): string {
  return [p?.preferredName, p?.surname].filter(Boolean).join(" ") || p?.givenNames || "Player";
}

type ReleaseContext = { ctx: EvaluationContext; hkfcTeam: string; playersById: Map<string, Player> };

/**
 * Server-side eligibility revalidation (INV-003) of the players a save adds
 * that are not in the squad already: 422 naming each blocked one. Returns
 * what the same-day release needs afterwards.
 */
async function revalidateAdds(
  env: Env,
  match: Match,
  ref: Awaited<ReturnType<typeof getReferenceData>>,
  side: MatchSide | undefined,
  newlyAddedIds: string[],
): Promise<ReleaseContext> {
  const teamMap = new Map<string, Team>(ref.teams.map((t) => [t.teamName || "", t]));
  const hkfcTeam = hkfcTeamName(match, ref.teamRankMap, side);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  const { ctx } = await buildEvaluationContext(env, match, ref.teamRankMap, teamMap, ref.players, hkfcTeam);
  const playersById = new Map(ref.players.map((p) => [p.id, p]));

  const violations: string[] = [];
  for (const id of newlyAddedIds) {
    const player = playersById.get(id);
    if (!player) { violations.push(`${id}: player not found or inactive`); continue; }

    const eligibility = evaluatePlayerEligibility(player, match, ctx);
    if (eligibility.status === "blocked") {
      const name = player.preferredName || player.givenNames || id;
      violations.push(`${name}: ${eligibility.reason}`);
    }
  }

  if (violations.length > 0) {
    throw new HttpError(`Selection rejected — ineligible player(s): ${violations.join("; ")}`, 422);
  }
  return { ctx, hkfcTeam, playersById };
}

/**
 * The whole-squad save. Superseded by applySquadChanges; kept for one
 * release so PWAs still running the old page can save.
 */
export async function syncSquad(
  env: Env,
  matchId: string,
  targetPlayerIds: string[],
  actingEmail?: string,
  side?: MatchSide,
): Promise<{ displaced: DisplacedSelection[] }> {
  if (!Array.isArray(targetPlayerIds)) throw new HttpError("selectedIds must be an array", 400);
  // WRITE PATH: always read the record fresh — never from the 30s cache —
  // so the derby-safety merge below operates on the current opposite side.
  const match = await matches(env).getById(matchId);
  if (!match) throw new HttpError("Match not found", 404);
  const ref = await getReferenceData(env);
  const fieldName = getSelectionFieldName(match, ref.teamRankMap, side);
  const cleanIds = targetPlayerIds.filter((id) => isRowId(id));

    // ── Server-side eligibility revalidation (INV-003) ──────────────────
  const currentSelectedBefore = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const newlyAddedIds = cleanIds.filter((id) => !currentSelectedBefore.includes(id));
  // Set when newly added players pass revalidation; the same-day release
  // below runs only after this squad has been written.
  const release = newlyAddedIds.length > 0 ? await revalidateAdds(env, match, ref, side, newlyAddedIds) : null;

  // Derby safety: ensure a player isn't selected for BOTH sides of the same match
  const updates: Partial<Record<SelectionField, string[]>> = { [fieldName]: cleanIds };
  if (side === "home" || side === "away") {
    const oppositeField: SelectionField = side === "home" ? "selectedPlayersAway" : "selectedPlayersHome";
    const oppositeCurrent = side === "home" ? match.selectedPlayersAway : match.selectedPlayersHome;
    updates[oppositeField] = (oppositeCurrent || []).filter((id) => !cleanIds.includes(id));
  }
  await matches(env).update(matchId, updates);

  // Higher team priority (Bye-Law 7.1 / spec §7.3). After the write above,
  // so a failed save never leaves a player removed from both squads.
  let displaced: DisplacedSelection[] = [];
  if (release) {
    displaced = await releaseFromLowerSameDaySquads(
      env, release.ctx, release.hkfcTeam, newlyAddedIds, ref.teamRankMap, release.playersById,
    );
    for (const d of displaced) {
      console.log(`[Same-Day Audit] action=release playerId=${d.playerId} from=${d.team} matchId=${d.matchId} for=${release.hkfcTeam} forMatchId=${matchId} actor=${actingEmail || "unknown"}`);
    }
  }

  // Invalidation fan-out (Invariant #11): a selection change can affect
  // same-day eligibility for OTHER matches too, so this is a coarse wipe
  // rather than a match-by-match computation.
  return { displaced };
}

const MAX_SQUAD_CHANGES = 40;

export interface SquadChangesBody {
  matchId?: unknown;
  side?: unknown;
  add?: unknown;
  remove?: unknown;
  version?: unknown;
}

export type SquadChangesOutcome =
  | { status: "ok"; version: number; selectedIds: string[]; displaced: DisplacedSelection[] }
  | { status: "conflict"; version: number; selectedIds: string[]; players: { id: string; name: string }[] };

function playerIdList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(`${name} must be a list of player ids`, 400);
  if (value.length > MAX_SQUAD_CHANGES) throw new HttpError(`${name} can list at most ${MAX_SQUAD_CHANGES} players`, 400);
  for (const id of value) {
    if (!isRowId(id)) throw new HttpError(`${name} has an invalid player id`, 400);
  }
  return [...new Set(value as string[])];
}

/** Checks a POST /api/squad/changes body; 400 on anything malformed. */
export function parseSquadChanges(body: SquadChangesBody) {
  if (!isRowId(body.matchId)) throw new HttpError("matchId is invalid", 400);
  if (body.side !== undefined && body.side !== null && body.side !== "home" && body.side !== "away") {
    throw new HttpError('side must be "home" or "away"', 400);
  }
  const add = playerIdList(body.add, "add");
  const remove = playerIdList(body.remove, "remove");
  if (add.some((id) => remove.includes(id))) throw new HttpError("A player cannot be added and removed in one save", 400);
  const version = body.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new HttpError("version must be a whole number", 400);
  }
  return { matchId: body.matchId, side: (body.side ?? undefined) as MatchSide | undefined, add, remove, version };
}

/**
 * A coach's save as changes (Track B6): only the players added and removed,
 * applied to the squad as it is now, so two coaches working on one squad
 * no longer undo each other. Refused as a conflict only when someone else
 * changed one of the same players since `version` (owner decision, 6 Oct
 * 2026). Adds not already in the squad are revalidated as syncSquad does;
 * a higher team's add releases the player from same-day lower squads.
 *
 * Subrequests: the fresh match read, the rpc, one rpc per released lower
 * squad side and the shared-cache invalidation, plus the cached reference
 * and season reads when cold.
 */
export async function applySquadChanges(
  env: Env,
  body: SquadChangesBody,
  actor: { email: string; personId?: string },
): Promise<SquadChangesOutcome> {
  const { matchId, side, add, remove, version } = parseSquadChanges(body);

  // Fresh, never the 30s cache: which adds are new decides what is revalidated.
  const match = await matches(env).getById(matchId);
  if (!match) throw new HttpError("Match not found", 404);
  const ref = await getReferenceData(env);
  const resolvedSide = resolveHkfcSide(match, ref.teamRankMap, side);
  const current = new Set(getSelectedPlayerIds(match, ref.teamRankMap, resolvedSide));
  const newlyAddedIds = add.filter((id) => !current.has(id));
  const release = newlyAddedIds.length > 0 ? await revalidateAdds(env, match, ref, resolvedSide, newlyAddedIds) : null;

  const actorId = actor.personId || null;
  const result = await matches(env).applySelectionChanges(matchId, {
    side: resolvedSide, add, remove, version, actorId, source: "coach",
  });

  if (result.status === "conflict") {
    // The other change moved the cache versions, so the page's reload reads it.
    const byId = new Map(ref.players.map((p) => [p.id, p]));
    return {
      status: "conflict",
      version: result.version,
      selectedIds: result.selected,
      players: result.players.map((id) => ({ id, name: playerName(byId.get(id)) })),
    };
  }
  if (result.status === "unchanged") {
    return { status: "ok", version: result.version, selectedIds: result.selected, displaced: [] };
  }

  // Higher team priority (Bye-Law 7.1 / spec 7.3), after the save so a
  // failed save never leaves a player removed from both squads. Only players
  // this save really added, and only those that were revalidated.
  let displaced: DisplacedSelection[] = [];
  const released = release ? result.added.filter((id) => newlyAddedIds.includes(id)) : [];
  if (release && released.length > 0) {
    displaced = await releaseFromLowerSameDaySquads(
      env, release.ctx, release.hkfcTeam, released, ref.teamRankMap, release.playersById, actorId,
    );
    for (const d of displaced) {
      console.log(`[Same-Day Audit] action=release playerId=${d.playerId} from=${d.team} matchId=${d.matchId} for=${release.hkfcTeam} forMatchId=${matchId} actor=${actor.email || "unknown"}`);
    }
  }

  return { status: "ok", version: result.version, selectedIds: result.selected, displaced };
}

export async function toggleAutoSelect(env: Env, matchId: string, enabled: boolean, actingEmail?: string) {
  const existing = await matches(env).getById(matchId);
  if (!existing) throw new HttpError("Match not found", 404);
  await matches(env).update(matchId, { autoSelectEnabled: enabled });
  console.log(`[AutoSelect Audit] action=toggle matchId=${matchId} enabled=${enabled} actor=${actingEmail || "unknown"}`);
  return { success: true, autoSelectEnabled: enabled };
}

const KIT_COLOURS: readonly string[] = ["Blue", "White", ""];

/**
 * Set the shirt colour for one side of a fixture.
 *
 * Home and Away are separate fields so a derby (HKFC B v HKFC C) can have a
 * different colour per side; the caller says which side it is setting. An
 * empty string clears the choice back to "not yet decided".
 */
export async function setMatchKit(
  env: Env,
  matchId: string,
  side: "home" | "away",
  kit: string,
  actingEmail?: string,
) {
  if (side !== "home" && side !== "away") {
    throw new HttpError('side must be "home" or "away"', 400);
  }
  if (!KIT_COLOURS.includes(kit)) {
    throw new HttpError('kit must be "Blue", "White" or empty', 400);
  }
  const existing = await matches(env).getById(matchId);
  if (!existing) throw new HttpError("Match not found", 404);

  await matches(env).update(matchId, side === "home" ? { homeKit: kit as KitColour } : { awayKit: kit as KitColour });

  // Same invalidation set as the auto-select toggle: the fixture views and
  // the calendar feeds all read the kit off the cached match records.
  console.log(`[Kit Audit] matchId=${matchId} side=${side} kit=${kit || "(cleared)"} actor=${actingEmail || "unknown"}`);
  return { success: true, side, kit };
}

// ── Priority Player List Management ─────────────────────────────────────

export async function getTeamAutoSelectPlayers(env: Env, teamName: string) {
  if (!teamName) throw new HttpError("team name is required", 400);
  const ref = await getReferenceData(env);
  const team = ref.teams.find(t => t.teamName === teamName);
  if (!team) throw new HttpError("Team not found", 404);
  const playerIds = team.autoSelectPlayers || [];
  const players = ref.players
    .filter(p => playerIds.includes(p.id))
    .map(p => ({
      id: p.id,
      preferredName: [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player",
      registeredTeam: selectedDisplayTeam(p),
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      active: p.active ?? true,
    }));
  return { teamName, playerIds, players };
}

export async function setTeamAutoSelectPlayers(env: Env, teamName: string, playerIds: string[], actingEmail?: string) {
  if (!teamName) throw new HttpError("team name is required", 400);
  if (!Array.isArray(playerIds)) throw new HttpError("playerIds must be an array", 400);

  const ref = await getReferenceData(env);
  const team = ref.teams.find(t => t.teamName === teamName);
  if (!team) throw new HttpError("Team not found", 404);

  const validIds = playerIds.filter((id) => isRowId(id));

  // Use team.id from reference data — avoids a redundant Airtable lookup
  await teamsRepo(env).setAutoSelectPlayers(team.id, validIds);


  console.log(`[AutoSelect Audit] action=setPriorityPlayers team=${teamName} count=${validIds.length} actor=${actingEmail || "unknown"}`);
  return { success: true, teamName, playerIds: validIds };
}

/**
 * Availability exceptions for one match, for the 30s squad-page poll.
 *
 * One read of that match's answers only (match=in.(id), narrow columns: at
 * most a few KB), kept under the availability_exceptions cache version:
 * steady-state polling makes no database call until someone answers, and
 * then every isolate sees the answer. It used to read the match, then the
 * whole season's answers (~177 KB on preview) and filter them here; with
 * no season involved, the matches version is no longer a dependency. Not
 * "changed since": an Available answer is usually a deleted row, which a
 * since-filter cannot see.
 */
export async function getAvailabilityForMatch(env: Env, matchId: string) {
  return getVersioned<{ exceptions: { playerId: string; status: string; notes: string }[] }>(
    env,
    `availability:${matchId}`,
    ["availability_exceptions"],
    async () => {
      const forMatch = await availabilityExceptions(env).listForMatches([matchId]);
      return {
        exceptions: forMatch
          .filter((e) => linkId(e.match) === matchId)
          .map((e) => ({
            playerId: linkId(e.player) || "",
            status: e.availabilityStatus || "Available",
            notes: e.note || "",
          })),
      };
    },
  );
}
