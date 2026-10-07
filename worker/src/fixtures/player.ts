import { linkId } from "../../../shared/airtableValueUtils";
import type { Env } from "../env";
import { getReferenceData, UNRANKED_TEAM_RANK } from "../reference";
import { personAsPlayer } from "../authContext";
import { HttpError } from "../http";
import type { KitColour, Match, Player } from "../../../shared/schema/domainTypes";
import { selectedDisplayTeam } from "../../../shared/displayTeam";
import { hkDateKey } from "../../../shared/hkDateKey";
import { byKickOff } from "../../../shared/kickOff";
import { fixtureChange } from "../../../shared/fixtureChange";
import { isBirthdayOn } from "../../../shared/birthday";
import { firstName, fullName } from "../../../shared/personName";
import { buildEvaluationContext, getSeasonContext, currentSeason } from "../seasonContext";
import { evaluatePlayerEligibility } from "../eligibility";
import { effectiveAvailability, getAllAvailabilityRules, getRulesForPlayer } from "../availabilityRules";
import { sectionsFor, type AuthorizedUser } from "../auth";
import { canSeeVolunteers } from "../volunteerAccess";
import { canManageEvents } from "../eventAccess";
import { umpiringAccess } from "../umpiring";
import { nextDutyLine } from "../myDuties";
import { canSeeSeasonPlans } from "../seasonPlan";
import { hkfcSides, type SideInfo } from "../match";
import { getScheduledMatches, getCalledOffMatches } from "./matchReads";
import { isSpecialGoalkeeper } from "./goalkeeper";
import { type PastFixture, buildPastFixtures } from "./past";

/**
 * Names of the player's teammates whose birthday it is today, for the
 * dashboard card. A teammate is anyone Active whose Selected Team (the same
 * EOS -> SOS -> Registered fallback the dashboard shows) is the player's own.
 * The player themselves is left out: they get their own banner. Only names
 * leave the Worker, never a date.
 */
export function teamBirthdaysOn(
  players: Player[],
  user: Player,
  displayTeam: string,
  today: string,
): string[] {
  if (!displayTeam) return [];
  return players
    .filter(
      (p) =>
        p.id !== user.id &&
        (selectedDisplayTeam(p) || p.registeredTeam || "") === displayTeam &&
        isBirthdayOn(p.birthday, today),
    )
    .map((p) => fullName(p) || "A teammate")
    .sort((a, b) => a.localeCompare(b));
}

export async function getMyFixtures(
  env: Env,
  authUser: AuthorizedUser,
  opts: { includePast?: boolean } = {},
) {
  // The person came with sign-in (auth_context): no read.
  const user = await personAsPlayer(env, authUser.person);
  const teamName = user.registeredTeam || "";
  const displayTeam = selectedDisplayTeam(user) || teamName;
  // The view starts every read it needs at once; the reference data here is
  // the same read (joined in flight), so this adds no round trip.
  // Started with the rest: the umpire's next duty is one read of its own.
  const duty = authUser.umpire ? nextDutyLine(env, authUser.personId).catch(() => null) : Promise.resolve(null);
  const [ref, view] = await Promise.all([getReferenceData(env), buildPlayerFixtureView(env, user, { calledOff: true })]);
  // coachTeams/isSectionCaptain come from the single authorization
  // derivation (auth.ts), not re-derived from Teams links here.
  const captainTeams = authUser.captainTeams;
  const today = hkDateKey(new Date().toISOString());
  const base = {
    // The dashboard's season-stats panel reads stats for this id.
    playerId: user.id,
    playerName: firstName(user) || "Player",
    // People.Photo, already mapped to the first attachment's URL. Optional:
    // the dashboard falls back to the initial when a player has no photo.
    photo: user.photo || "",
    registeredTeam: displayTeam, displayTeam, playingPosition: user.playingPosition || "",
    shirtNoValue: user.shirtNoValue || "",
    isCoach: authUser.role === "coach",
    coachTeams: authUser.coachTeams,
    captainTeams,
    isSectionCaptain: authUser.isSectionCaptain,
    // Officers' sections, for the dashboard's header buttons.
    sections: sectionsFor(authUser),
    seasonPlans: canSeeSeasonPlans(authUser),
    volunteers: await canSeeVolunteers(env, authUser),
    events: await canManageEvents(env, authUser),
    umpiring: await umpiringAccess(env, authUser),
    // The umpire's next duty within two weeks: the "Your duty" line (myDuties.ts).
    duty: await duty,
    // Decided here, on the Hong Kong calendar day, so the date of birth
    // itself never reaches the browser.
    isBirthday: isBirthdayOn(user.birthday, today),
    teamBirthdays: teamBirthdaysOn(ref.players, user, displayTeam, today),
  };

  // Results are read from the cached season context, so asking for them
  // costs no extra Airtable call. Still gated on the toggle: it is a
  // meaningful amount of payload for a screen most players open to answer
  // an upcoming fixture, not to read last month's scores.
  let pastFixtures: PastFixture[] = [];
  if (opts.includePast) {
    const ctx = await getSeasonContext(env, currentSeason(), user.id);
    pastFixtures = buildPastFixtures({
      playerId: user.id,
      teams: [view.displayTeam, user.registeredTeam || ""],
      matches: ctx.allMatches,
      matchCards: ctx.matchCards,
      playerNameById: new Map(
        ref.players.map((p) => [p.id, firstName(p) || "Player"]),
      ),
    });
  }

  return {
    ...base,
    pastFixtures,
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
export async function buildPlayerFixtureView(
  env: Env,
  user: Player,
  opts: { withSquad?: boolean; calledOff?: boolean } = {},
): Promise<PlayerFixtureView> {
  const playerId = user.id;
  const teamName = user.registeredTeam || "";
  // Display team (optics): Selected Team EOS -> SOS -> Registered Team. The
  // player experiences THIS team as "My Team"; every business rule (play-up
  // legality, same-day priority, suspension) keeps using the true team.
  const displayTeam = selectedDisplayTeam(user) || teamName;
  // Everything this view reads, asked for at once (one round trip on a cold
  // isolate instead of one after another): the players and teams, the
  // scheduled matches, the player's own season context (the eligibility
  // gate, their answers and the squad's) and the availability rules. The
  // later reads of each are cache hits, or join these in flight.
  const [ref, allMatches, calledOff] = await Promise.all([
    getReferenceData(env),
    getScheduledMatches(env),
    // The dashboard shows a called-off game for a week; the calendar doesn't.
    opts.calledOff ? getCalledOffMatches(env) : Promise.resolve([] as Match[]),
    getSeasonContext(env, currentSeason(), playerId),
    getAllAvailabilityRules(env),
  ]);
  const teamNames = new Set(ref.teams.map((t) => t.teamName));
  const rankMap = ref.teamRankMap;
  const teamsByName = new Map(ref.teams.map((t) => [t.teamName, t]));

  const now = new Date().toISOString();
  const upcoming = allMatches.filter((m) => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  type FixtureCategory = "own" | "play-up" | "support";
  type Side = { match: any; team: string; opponent: string; isHome: boolean; selectedIds: string[]; dateKey: string };
  const categorized: { side: Side; category: FixtureCategory }[] = [];
  const specialGoalkeeperView = isSpecialGoalkeeper(user, ref);

  if (specialGoalkeeperView) {
    // Lowest-ranked team Goalkeeper: every upcoming HKFC fixture, uncapped
    // and uncategorised (a planning view, not a selection gate) - a derby
    // collapses to whichever side is most relevant to the player: their own
    // team, else the side they are selected for, else home.
    for (const m of upcoming) {
      const sides = hkfcSides(m, teamNames);
      if (!sides.home && !sides.away) continue;
      const chosen: SideInfo =
        (sides.home?.team === teamName && sides.home) ||
        (sides.away?.team === teamName && sides.away) ||
        (sides.home?.selectedIds.includes(playerId) && sides.home) ||
        (sides.away?.selectedIds.includes(playerId) && sides.away) ||
        sides.home ||
        sides.away!;
      categorized.push({ side: { match: m, ...chosen, dateKey: hkDateKey(m.matchDate) }, category: "own" });
    }
  } else {
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
    const sidesByDate = new Map<string, Side[]>();
    for (const m of upcoming) {
      const dateKey = hkDateKey(m.matchDate);
      const matchSides = hkfcSides(m, teamNames);
      for (const sideInfo of [matchSides.home, matchSides.away]) {
        if (!sideInfo) continue;
        const list = sidesByDate.get(dateKey) || [];
        list.push({ match: m, ...sideInfo, dateKey });
        sidesByDate.set(dateKey, list);
      }
    }

    const isSquadSelected = (s: Side) => s.selectedIds.includes(playerId);

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
      const primaryRank = rankMap[primaryTeam] ?? UNRANKED_TEAM_RANK;
      const registeredRank = rankMap[teamName] ?? UNRANKED_TEAM_RANK;
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
  }

  if (categorized.length === 0) {
    return {
      displayTeam,
      specialGoalkeeperView: specialGoalkeeperView || undefined,
      myTeam: [],
      playUpOpportunities: [],
      supportFixtures: [],
    };
  }

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
    const { ctx } = await buildEvaluationContext(env, side.match, rankMap, teamMap, ref.players, side.team, playerId);
    // Portal gate = the engine itself (no neutralisation): mere availability
    // for a higher team no longer blocks (product decision 2026-09-03),
    // while an actual selection for a higher team still does.
    const result = evaluatePlayerEligibility(user, side.match, ctx);
    const eligible = result.status !== "blocked";
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
  // The player's own answers (with note and id) and, for the calendar, the
  // selected squad's: both are in the player's own season context, read
  // above, so no read of their own. The context is kept under the
  // availability_exceptions version, which a tap moves, so the player sees
  // the tap they just made in every isolate.
  const relevantSeasons = [...new Set(relevantCategorized.map((x) => x.side.match.season || "").filter(Boolean))];
  const [contexts, playerRules] = await Promise.all([
    Promise.all(relevantSeasons.map((s) => getSeasonContext(env, s, playerId))),
    getRulesForPlayer(env, playerId),
  ]);
  const relevantIds = new Set(relevantMatchIds);
  const matchExceptions = contexts.flatMap((c) => c.exceptionsRaw).filter((e) => relevantIds.has(linkId(e.match) || ""));
  const playerExceptions = matchExceptions.filter((e) => linkId(e.player) === playerId && relevantMatchIds.includes(linkId(e.match) || ""));
  const exceptionByMatch = new Map(playerExceptions.map((e) => [linkId(e.match) || "", e]));
  // Everyone's answer, per match, so a calendar event can say who else is in
  // the squad and which of them are only a Maybe. The dashboard never shows
  // the squad, so only the calendar feed builds it.
  const squadStatus = new Map<string, string>();
  if (opts.withSquad) {
    for (const e of matchExceptions) {
      const mId = linkId(e.match);
      const pId = linkId(e.player);
      if (mId && pId) squadStatus.set(`${mId}:${pId}`, e.availabilityStatus || "");
    }
  }
  const squadPlayerById = new Map(ref.players.map((p) => [p.id, p]));
  const buildCard = (x: { side: Side; category: FixtureCategory }) => {
    const s = x.side;
    const team = teamsByName.get(s.team);
    const exc = exceptionByMatch.get(s.match.id);
    // A standing rule supplies the default for a fixture the player has not
    // answered; an explicit exception always wins.
    const effective = effectiveAvailability(exc?.availabilityStatus, playerRules, {
      date: hkDateKey(s.match.matchDate),
      isPlayUp: x.category === "play-up",
      isSupport: x.category === "support",
    }, { optInOnly: user.optInOnly });
    return {
      id: s.match.id, date: s.match.matchDate || "", homeTeam: s.match.homeTeam || "", awayTeam: s.match.awayTeam || "",
      hkfcTeam: s.team, opponent: s.opponent, isHome: s.isHome, venue: s.match.venue || "", division: s.match.division || "",
      availabilityStatus: effective.status,
      /** True when the status came from a standing rule, not a tap. */
      availabilityFromRule: effective.fromRule,
      playerNotes: exc?.note || "",
      availabilityExceptionId: exc?.id || "", selectionStatus: s.selectedIds.includes(playerId) ? "Selected" : "",
      selectionNotes: "", selectedCount: s.selectedIds.length, targetSquadSize: team?.targetSquadSize || 16,
      ...(opts.withSquad
        ? {
            squad: s.selectedIds.map((id) => ({
              name: firstName(squadPlayerById.get(id)) || "Player",
              shirtNo: squadPlayerById.get(id)?.shirtNoValue || "",
              playingPosition: squadPlayerById.get(id)?.playingPosition || "",
              availabilityStatus: squadStatus.get(`${s.match.id}:${id}`) || "",
            })),
          }
        : {}),
      // Kit follows the side being shown, so each half of a derby keeps its
      // own colour.
      kit: ((s.isHome ? s.match.homeKit : s.match.awayKit) || "") as KitColour,
      // fixtureCategory is presentation only; "play-up" is used exclusively
      // for the higher-team fillers above the relevant team.
      fixtureCategory: x.category,
      isPlayUp: x.category === "play-up",
      selectionTeam: x.category !== "own" ? s.team : undefined,
      /** Moved, venue changed, postponed or cancelled in the last 7 days. */
      change: fixtureChange(s.match) ?? undefined,
    };
  };
  // Called-off games of the player's own team, shown (without answers) for a week.
  const ownTeams = new Set([teamName, displayTeam].filter(Boolean));
  const calledOffCards = calledOff.flatMap((m) => {
    const sides = hkfcSides(m, teamNames);
    const side = [sides.home, sides.away].find((x) => x && ownTeams.has(x.team));
    return side ? [{ side: { match: m, ...side, dateKey: hkDateKey(m.matchDate) }, category: "own" as const }] : [];
  });
  // Kick-off order, a TBC time after the day's timed games (display only).
  const byDate = <T extends { date: string }>(cards: T[]) => cards.sort((a, b) => byKickOff(a.date, b.date));
  return {
    displayTeam,
    specialGoalkeeperView: specialGoalkeeperView || undefined,
    myTeam: byDate([...ownCards, ...calledOffCards].map(buildCard)),
    playUpOpportunities: gated.filter((x) => x.category === "play-up").map(buildCard),
    supportFixtures: gated.filter((x) => x.category === "support").map(buildCard),
  };
}

/**
 * Calendar-facing fixture list: the SAME categorised view as the player
 * dashboard (My Team + Play-Up Opportunities + Support Fixtures), flattened.
 * Identity comes from the signed calendar token's player id.
 */
export async function getPlayerFixtures(env: Env, playerId: string) {
  // The player comes from the Active list the view reads anyway, and the
  // view's other reads start alongside it: one round trip, not a lookup of
  // the person first. (Their season context is asked for on trust; for an
  // id that is no Active player, the 404 below is what answers.)
  const [ref] = await Promise.all([
    getReferenceData(env),
    getScheduledMatches(env),
    getSeasonContext(env, currentSeason(), playerId).catch(() => null),
    getAllAvailabilityRules(env),
  ]);
  const player = ref.players.find((p) => p.id === playerId);
  if (!player || !player.active) throw new HttpError("Player not found or inactive", 404);
  const view = await buildPlayerFixtureView(env, player, { withSquad: true });
  const fixtures = [...view.myTeam, ...view.playUpOpportunities, ...view.supportFixtures];
  return {
    playerName: firstName(player) || "Player",
    displayTeam: view.displayTeam,
    registeredTeam: view.displayTeam,
    fixtures,
  };
}
