import { z } from 'zod';
import { createEndpoint, ZiteError, People, Teams, Matches, AvailabilityExceptions, SquadSelections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Returns upcoming fixtures for a player (no auth, URL-based)',
  inputSchema: z.object({ playerId: z.string() }),
  outputSchema: z.object({
    playerName: z.string(),
    registeredTeam: z.string(),
    fixtures: z.array(z.object({
      id: z.string(),
      date: z.string(),
      homeTeam: z.string(),
      awayTeam: z.string(),
      venue: z.string(),
      division: z.string(),
      availabilityStatus: z.string(),
      playerNotes: z.string(),
      availabilityExceptionId: z.string(),
      selectionStatus: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    // Validate player
    const player = await People.findOne({ id: input.playerId });
    if (!player || !player.active) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'Player not found' });
    }

    const teamName = player.registeredTeam || '';

    // Fetch scheduled matches
    const matchesResult = await Matches.findAll({
      filters: { matchStatus: 'Scheduled' },
      limit: 100,
    });
    const now = new Date().toISOString();
    const upcomingMatches = matchesResult.records
      .filter(m => m.date && m.date >= now)
      .filter(m => (m.homeTeam || '') === teamName || (m.awayTeam || '') === teamName)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Fetch player's availability exceptions
    const exceptionsResult = await AvailabilityExceptions.findAll({ filters: {}, limit: 100 });
    const playerExceptions = exceptionsResult.records.filter(e => {
      const pId = Array.isArray(e.player) ? e.player[0] : e.player;
      return pId === input.playerId;
    });
    const exceptionByMatch = new Map(playerExceptions.map(e => {
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return [mId || '', e];
    }));

    // Fetch player's squad selections
    const selectionsResult = await SquadSelections.findAll({ filters: {}, limit: 100 });
    const playerSelections = selectionsResult.records.filter(s => {
      const pId = Array.isArray(s.player) ? s.player[0] : s.player;
      return pId === input.playerId;
    });
    const selectionByMatch = new Map(playerSelections.map(s => {
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return [mId || '', s];
    }));

    const fixtures = upcomingMatches.map(m => {
      const exc = exceptionByMatch.get(m.id);
      const sel = selectionByMatch.get(m.id);
      return {
        id: m.id,
        date: m.date || '',
        homeTeam: m.homeTeam || '',
        awayTeam: m.awayTeam || '',
        venue: m.venue || '',
        division: m.division || '',
        availabilityStatus: exc?.availabilityStatus || 'Available',
        playerNotes: exc?.playerNotes || '',
        availabilityExceptionId: exc?.id || '',
        selectionStatus: sel?.selectionStatus || '',
      };
    });

    return {
      playerName: player.preferredName || player.givenNames || 'Player',
      registeredTeam: teamName,
      fixtures,
    };
  },
});
