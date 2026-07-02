import { z } from 'zod';
import { createEndpoint, Teams, Matches, AvailabilityExceptions, SquadSelections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Returns upcoming fixtures for the logged-in player with availability and selection status',
  inputSchema: z.object({}),
  outputSchema: z.object({
    playerName: z.string(),
    registeredTeam: z.string(),
    playingPosition: z.string(),
    shirtNo: z.string(),
    isCoach: z.boolean(),
    fixtures: z.array(z.object({
      id: z.string(),
      date: z.string(),
      homeTeam: z.string(),
      awayTeam: z.string(),
      hkfcTeam: z.string(),
      opponent: z.string(),
      isHome: z.boolean(),
      venue: z.string(),
      division: z.string(),
      availabilityStatus: z.string(),
      playerNotes: z.string(),
      availabilityExceptionId: z.string(),
      selectionStatus: z.string(),
      selectionNotes: z.string(),
      selectedCount: z.number(),
      targetSquadSize: z.number(),
    })),
  }),
  execute: async ({ context }) => {
    const user = context.user;
    const teamName = user.registeredTeam || '';
    const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
    const isCoach = roles.includes('Coach');

    // Fetch teams for name→rank mapping
    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const teamsByName = new Map(teamsResult.records.map(t => [t.teamName || '', t]));
    const teamNames = new Set(teamsResult.records.map(t => t.teamName || ''));

    // Fetch scheduled matches
    const matchesResult = await Matches.findAll({
      filters: { matchStatus: 'Scheduled' },
      limit: 100,
    });
    const now = new Date().toISOString();
    const upcomingMatches = matchesResult.records
      .filter(m => m.date && m.date >= now)
      .filter(m => {
        const home = m.homeTeam || '';
        const away = m.awayTeam || '';
        return home === teamName || away === teamName;
      })
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (upcomingMatches.length === 0) {
      return {
        playerName: user.preferredName || user.givenNames || 'Player',
        registeredTeam: teamName,
        playingPosition: user.playingPosition || '',
        shirtNo: user.shirtNoValue || '',
        isCoach,
        fixtures: [],
      };
    }

    const matchIds = new Set(upcomingMatches.map(m => m.id));

    // Fetch availability exceptions (2 calls max)
    const exceptionsResult = await AvailabilityExceptions.findAll({ filters: {}, limit: 100 });
    const playerExceptions = exceptionsResult.records.filter(e => {
      const pId = Array.isArray(e.player) ? e.player[0] : e.player;
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return pId === user.id && mId && matchIds.has(mId);
    });
    const exceptionByMatch = new Map(playerExceptions.map(e => {
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return [mId || '', e];
    }));

    // Fetch squad selections
    const selectionsResult = await SquadSelections.findAll({ filters: {}, limit: 100 });
    const allSelections = selectionsResult.records.filter(s => {
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return mId && matchIds.has(mId);
    });
    const playerSelections = allSelections.filter(s => {
      const pId = Array.isArray(s.player) ? s.player[0] : s.player;
      return pId === user.id;
    });
    const selectionByMatch = new Map(playerSelections.map(s => {
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return [mId || '', s];
    }));

    // Count selections per match
    const selectedCountByMatch = new Map<string, number>();
    for (const s of allSelections) {
      if (s.selectionStatus !== 'Selected') continue;
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      if (mId) selectedCountByMatch.set(mId, (selectedCountByMatch.get(mId) || 0) + 1);
    }

    const fixtures = upcomingMatches.map(m => {
      const home = m.homeTeam || '';
      const away = m.awayTeam || '';
      const isHome = home === teamName;
      const hkfcTeam = teamNames.has(home) ? home : away;
      const opponent = hkfcTeam === home ? away : home;
      const team = teamsByName.get(hkfcTeam);
      const exc = exceptionByMatch.get(m.id);
      const sel = selectionByMatch.get(m.id);

      return {
        id: m.id,
        date: m.date || '',
        homeTeam: home,
        awayTeam: away,
        hkfcTeam,
        opponent,
        isHome,
        venue: m.venue || '',
        division: m.division || '',
        availabilityStatus: exc?.availabilityStatus || 'Available',
        playerNotes: exc?.playerNotes || '',
        availabilityExceptionId: exc?.id || '',
        selectionStatus: sel?.selectionStatus || '',
        selectionNotes: sel?.selectionNotes || '',
        selectedCount: selectedCountByMatch.get(m.id) || 0,
        targetSquadSize: team?.targetSquadSize || 16,
      };
    });

    return {
      playerName: user.preferredName || user.givenNames || 'Player',
      registeredTeam: teamName,
      playingPosition: user.playingPosition || '',
      shirtNo: user.shirtNoValue || '',
      isCoach,
      fixtures,
    };
  },
});
