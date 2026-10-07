import { linkId } from "../../../shared/airtableValueUtils";
import type { Env } from "../env";
import { getReferenceData, getExceptionsForMatches } from "../reference";
import type { KitColour, Match, Player } from "../../../shared/schema/domainTypes";
import { selectedDisplayTeam } from "../../../shared/displayTeam";
import { hkDateKey } from "../../../shared/hkDateKey";
import { fixtureChange } from "../../../shared/fixtureChange";
import type { AuthorizedUser } from "../auth";
import { changedSinceNotice, noticesForMatches, type SquadNotice } from "../squadNotices";
import { hkfcSides, type SideInfo } from "../match";
import { POS_SHORT } from "../../../shared/positions";
import { outcomeOf } from "../teamRecord";
import { getScheduledMatches, getCalledOffMatches, PAST_FIXTURE_WINDOW_DAYS, getPlayedMatches } from "./matchReads";

export async function getUpcomingFixtures(
  env: Env,
  opts: { user?: AuthorizedUser; team?: string; includePast?: boolean; calledOff?: boolean },
) {
  const ref = await getReferenceData(env);
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));
  const playerById = new Map(ref.players.map((p) => [p.id, p]));
  const nameOf = (p?: Player) => (p ? p.preferredName || p.givenNames || "Player" : "");
  // coachTeams already includes every team name when the user is a Section
  // Captain (see auth.ts) - no separate derivation needed here.
  const coachedTeamNames = new Set(opts.user?.coachTeams ?? []);
  const allTeamNames = new Set(ref.teams.map((t) => t.teamName));

  // Day boundaries in Hong Kong, not UTC, and not the current instant. The
  // old comparison was against `now`, so a fixture dropped off the list the
  // moment it kicked off - the coach lost the teamsheet mid-match.
  const todayKey = hkDateKey(new Date().toISOString());
  const cutoff = new Date(Date.now() - PAST_FIXTURE_WINDOW_DAYS * 86_400_000);
  const pastCutoffKey = hkDateKey(cutoff.toISOString());

  const [scheduled, calledOff] = await Promise.all([
    getScheduledMatches(env),
    // The coach list shows a called-off game for a week; the team feed doesn't.
    opts.calledOff ? getCalledOffMatches(env) : Promise.resolve([] as Match[]),
  ]);
  // Played matches are only fetched when asked for, so the common case costs
  // nothing extra. They are a separate status, hence a separate read.
  const played = opts.includePast ? await getPlayedMatches(env) : [];
  const seen = new Set<string>();
  const allMatches = [...scheduled, ...calledOff, ...played].filter((m) => {
    if (!m.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const upcoming = allMatches
    .filter((m) => {
      if (!m.matchDate) return false;
      const key = hkDateKey(m.matchDate);
      if (key >= todayKey) return true;
      return opts.includePast === true && key >= pastCutoffKey;
    })
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));
  const relevant = upcoming.filter((m) => {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    if (opts.team) {
      // An authenticated call (coach export) must be scoped to teams the
      // coach manages; the signed no-user team-feed path is already
      // authorised by its HMAC signature, so it must not be gated here.
      if (opts.user && !coachedTeamNames.has(opts.team)) return false;
      return home === opts.team || away === opts.team;
    }
    return coachedTeamNames.has(home) || coachedTeamNames.has(away);
  });
  if (relevant.length === 0) return { fixtures: [] };
  const matchIds = relevant.map((m) => m.id);
  // The answers for these fixtures only (match=in, narrow columns), not the
  // whole season's: ~5 KB a team on preview against ~177 KB. Kept under the
  // availability_exceptions version (reference.ts getExceptionsForMatches).
  const [listedExceptions, notices] = await Promise.all([
    getExceptionsForMatches(env, matchIds),
    // The squads last sent from Notify: a dot on the card when the squad has
    // changed since (squadNotices.ts). The team feed has no use for it.
    opts.user ? noticesForMatches(env, matchIds).catch(() => new Map<string, SquadNotice>()) : Promise.resolve(new Map<string, SquadNotice>()),
  ]);
  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of listedExceptions) {
    const mId = linkId(exc.match);
    if (!mId || !matchIds.includes(mId)) continue;
    exceptionsByMatch.set(mId, [...(exceptionsByMatch.get(mId) || []), exc]);
  }
  const fixtures = relevant.flatMap((m) => {
    const home = m.homeTeam || ""; const away = m.awayTeam || "";
    // hkfcSides identifies which side(s) are HKFC teams at all; bothCoached
    // (below) is the narrower "does the caller manage both" question.
    const matchSides = hkfcSides(m, allTeamNames);
    const bothCoached = coachedTeamNames.has(home) && coachedTeamNames.has(away);
    const makeCard = (side: SideInfo) => {
      const { team: hkfcTeam, opponent, isHome, selectedIds } = side;
      const team = teamsByName.get(hkfcTeam);
      const matchExceptions = exceptionsByMatch.get(m.id) || [];
      const statusByPlayer = new Map<string, string>();
      for (const e of matchExceptions) { const pid = linkId(e.player); if (pid) statusByPlayer.set(pid, e.availabilityStatus); }

      // Tile counts/lists consider only players whose SELECTED (display)
      // team is this fixture's team - Maybe/Unavailable marks from players
      // of other teams who are merely cross-team eligible are excluded
      // (product decision 2026-09-04). Recommendation scoring is unaffected.
      const isThisTeamsPlayer = (e: any): boolean => {
        const player = playerById.get(linkId(e.player) || "");
        return !!player && selectedDisplayTeam(player) === hkfcTeam;
      };
      const unavailableExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Unavailable" && isThisTeamsPlayer(e));
      const maybeExcs = matchExceptions.filter((e: any) => e.availabilityStatus === "Maybe" && isThisTeamsPlayer(e));
      const unavailableNames = unavailableExcs.map((e: any) => nameOf(playerById.get(linkId(e.player) || ""))).filter(Boolean);
      const maybeNames = maybeExcs.map((e: any) => nameOf(playerById.get(linkId(e.player) || ""))).filter(Boolean);

      const selectedPlayers = selectedIds.map((id) => ({
        id,
        name: nameOf(playerById.get(id)),
        shirtNo: playerById.get(id)?.shirtNoValue || "",
        playingPosition: playerById.get(id)?.playingPosition || "",
        availabilityStatus: statusByPlayer.get(id) || "",
      }));

      const selectedPositionSummary: Record<string, number> = {};
      for (const id of selectedIds) {
        const pos = POS_SHORT[playerById.get(id)?.playingPosition ?? ""] ?? "FLEX";
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
        kit: ((isHome ? m.homeKit : m.awayKit) || "") as KitColour,
        /** Moved, venue changed, postponed or cancelled in the last 7 days. */
        change: fixtureChange(m) ?? undefined,
        targetSquadSize: team?.targetSquadSize || 16,
        selectedCount: selectedIds.length,
        selectedIds,
        /** The squad differs from the one last sent from Notify. */
        unsentChanges: changedSinceNotice(notices.get(`${m.id}:${isHome ? "home" : "away"}`), selectedIds),
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
        // The result, once there is one. The coach list could show past
        // fixtures but never what happened in them, which the player's own
        // past-fixture card has shown all along.
        result:
          m.matchStatus === "Played"
            ? {
                goalsFor: isHome ? m.homeTeamScore : m.awayTeamScore,
                goalsAgainst: isHome ? m.awayTeamScore : m.homeTeamScore,
                outcome: outcomeOf(
                  isHome ? m.homeTeamScore : m.awayTeamScore,
                  isHome ? m.awayTeamScore : m.homeTeamScore,
                ),
              }
            : null,
      };
    };
    if (bothCoached && !opts.team) return [makeCard(matchSides.home!), makeCard(matchSides.away!)];
    if (opts.team) {
      if (home === opts.team && matchSides.home) return [makeCard(matchSides.home)];
      if (away === opts.team && matchSides.away) return [makeCard(matchSides.away)];
      return [];
    }
    if (coachedTeamNames.has(home) && matchSides.home) return [makeCard(matchSides.home)];
    return matchSides.away ? [makeCard(matchSides.away)] : [];
  });
  return { fixtures };
}
