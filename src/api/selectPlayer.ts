import { z } from 'zod';
import { createEndpoint, ZiteError, SquadSelections, People, Teams, Matches, AvailabilityExceptions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Select a player for a match (with server-side eligibility revalidation)',
  inputSchema: z.object({
    matchId: z.string(),
    playerId: z.string(),
    selectionStatus: z.enum(['Selected', 'Reserve']),
  }),
  outputSchema: z.object({
    id: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    // Revalidate: check player exists and is active
    const player = await People.findOne({ id: input.playerId });
    if (!player || !player.active) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Player not found or inactive' });
    }

    // Check profile completeness
    if (!player.registeredTeam || !player.playingPosition || !player.playingAbility) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Player profile is incomplete' });
    }

    // Check suspension
    if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Player is suspended' });
    }

    // Check match exists
    const match = await Matches.findOne({ id: input.matchId });
    if (!match) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'Match not found' });
    }

    // Check higher-to-lower movement
    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const teamRankMap = new Map(teamsResult.records.map(t => [t.teamName || '', t.teamRank || 99]));
    const home = match.homeTeam || '';
    const away = match.awayTeam || '';
    const hkfcTeam = teamRankMap.has(home) ? home : away;
    const targetTeamRank = teamRankMap.get(hkfcTeam) || 99;
    const playerTeamRank = teamRankMap.get(player.registeredTeam || '') || 99;

    if (playerTeamRank < targetTeamRank) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Higher-to-lower movement blocked (7.2a)' });
    }

    // Check visiting player fixed team
    if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Visiting player fixed to registered team (6.4)' });
    }

    // Check not already selected for this match
    const existingSelections = await SquadSelections.findAll({ filters: {}, limit: 100 });
    const alreadySelected = existingSelections.records.find(s => {
      const pId = Array.isArray(s.player) ? s.player[0] : s.player;
      const mId = Array.isArray(s.match) ? s.match[0] : s.match;
      return pId === input.playerId && mId === input.matchId;
    });

    if (alreadySelected) {
      throw new ZiteError({ code: 'CONFLICT', message: 'Player already selected for this match' });
    }

    // Create selection
    const result = await SquadSelections.create({
      record: {
        match: input.matchId,
        player: input.playerId,
        selectionStatus: input.selectionStatus,
        selectedBy: context.user.id,
      },
    });

    return { id: result.id, success: true };
  },
});
