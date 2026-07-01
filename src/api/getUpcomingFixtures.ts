import { z } from 'zod';
import { createEndpoint, Teams, Matches, SquadSelections, AvailabilityExceptions } from 'zite-integrations-backend-sdk';

const fixtureSchema = z.object({
  id: z.string(),
  date: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  hkfcTeam: z.string(),
  opponent: z.string(),
  isHome: z.boolean(),
  division: z.string(),
  venue: z.string(),
  targetSquadSize: z.number(),
  selectedCount: z.number(),
  reserveCount: z.number(),
  availableCount: z.number(),
  maybeCount: z.number(),
  unavailableCount: z.number(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Returns upcoming fixtures with squad summary for coached teams',
  inputSchema: z.object({
    teamFilter: z.string().optional(),
  }),
  outputSchema: z.object({
    fixtures: z.array(fixtureSchema),
  }),
  execute: async ({ input, context }) => {
    // 1. Cache teams (1 call)
    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const teams = teamsResult.records;
    const teamsByName = new Map(teams.map(t => [t.teamName || '', t]));

    // Find this user's coached teams
    const userId = context.user.id;
    const coachedTeams = teams.filter(t => {
      const coachIds = Array.isArray(t.coach) ? t.coach : t.coach ? [t.coach] : [];
      const captainIds = Array.isArray(t.teamCaptain) ? t.teamCaptain : t.teamCaptain ? [t.teamCaptain] : [];
      const secCapIds = Array.isArray(t.sectionCaptain) ? t.sectionCaptain : t.sectionCaptain ? [t.sectionCaptain] : [];
      return coachIds.includes(userId) || captainIds.includes(userId) || secCapIds.includes(userId);
    });
    const coachedTeamNames = new Set(coachedTeams.map(t => t.teamName || ''));

    // 2. Fetch scheduled matches (1-2 calls)
    const matchesResult = await Matches.findAll({
      filters: { matchStatus: 'Scheduled' },
      limit: 100,
    });
    const now = new Date().toISOString();
    const upcomingMatches = matchesResult.records
      .filter(m => m.date && m.date >= now)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Identify which matches involve our coached teams
    const relevantMatches = upcomingMatches.filter(m => {
      const home = m.homeTeam || '';
      const away = m.awayTeam || '';
      if (input.teamFilter) {
        return home === input.teamFilter || away === input.teamFilter;
      }
      return coachedTeamNames.has(home) || coachedTeamNames.has(away);
    });

    if (relevantMatches.length === 0) {
      return { fixtures: [] };
    }

    // 3. Fetch squad selections for these matches (1-2 calls)
    const matchIds = new Set(relevantMatches.map(m => m.id));
    const selectionsResult = await SquadSelections.findAll({ filters: {}, limit: 100 });
    let allSelections = selectionsResult.records;
    if (selectionsResult.hasMore) {
      const page2 = await SquadSelections.findAll({ filters: {}, offset: selectionsResult.offset, limit: 100 });
      allSelections = [...allSelections, ...page2.records];
    }

    // 4. Fetch availability exceptions (1-2 calls)
    const exceptionsResult = await AvailabilityExceptions.findAll({ filters: {}, limit: 100 });
    let allExceptions = exceptionsResult.records;
    if (exceptionsResult.hasMore) {
      const page2 = await AvailabilityExceptions.findAll({ filters: {}, offset: exceptionsResult.offset, limit: 100 });
      allExceptions = [...allExceptions, ...page2.records];
    }

    // Build lookup maps
    const selectionsByMatch = new Map<string, typeof allSelections>();
    for (const sel of allSelections) {
      const mId = Array.isArray(sel.match) ? sel.match[0] : sel.match;
      if (!mId) continue;
      const existing = selectionsByMatch.get(mId) || [];
      existing.push(sel);
      selectionsByMatch.set(mId, existing);
    }

    const exceptionsByMatch = new Map<string, typeof allExceptions>();
    for (const exc of allExceptions) {
      const mId = Array.isArray(exc.match) ? exc.match[0] : exc.match;
      if (!mId) continue;
      const existing = exceptionsByMatch.get(mId) || [];
      existing.push(exc);
      exceptionsByMatch.set(mId, existing);
    }

    // Build fixture response
    const fixtures = relevantMatches.map(m => {
      const home = m.homeTeam || '';
      const away = m.awayTeam || '';
      const isHome = coachedTeamNames.has(home) || (input.teamFilter ? home === input.teamFilter : false);
      const hkfcTeam = isHome ? home : away;
      const opponent = isHome ? away : home;
      const team = teamsByName.get(hkfcTeam);

      const matchSelections = selectionsByMatch.get(m.id) || [];
      const selectedCount = matchSelections.filter(s => s.selectionStatus === 'Selected').length;
      const reserveCount = matchSelections.filter(s => s.selectionStatus === 'Reserve').length;

      const matchExceptions = exceptionsByMatch.get(m.id) || [];
      const unavailableCount = matchExceptions.filter(e => e.availabilityStatus === 'Unavailable').length;
      const maybeCount = matchExceptions.filter(e => e.availabilityStatus === 'Maybe').length;

      return {
        id: m.id,
        date: m.date || '',
        homeTeam: home,
        awayTeam: away,
        hkfcTeam,
        opponent,
        isHome,
        division: m.division || '',
        venue: m.venue || '',
        targetSquadSize: team?.targetSquadSize || 16,
        selectedCount,
        reserveCount,
        availableCount: 0, // Computed on frontend from total - maybe - unavailable
        maybeCount,
        unavailableCount,
      };
    });

    return { fixtures };
  },
});
