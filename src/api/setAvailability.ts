import { z } from 'zod';
import { createEndpoint, ZiteError, People, AvailabilityExceptions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Set availability for a player on one or more matches (no auth)',
  inputSchema: z.object({
    playerId: z.string(),
    matchIds: z.array(z.string()),
    status: z.enum(['Available', 'Maybe', 'Unavailable']),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), updated: z.number() }),
  execute: async ({ input }) => {
    // Validate player
    const player = await People.findOne({ id: input.playerId });
    if (!player || !player.active) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'Player not found' });
    }

    // Fetch existing exceptions for this player
    const existingResult = await AvailabilityExceptions.findAll({ filters: {}, limit: 100 });
    const playerExceptions = existingResult.records.filter(e => {
      const pId = Array.isArray(e.player) ? e.player[0] : e.player;
      return pId === input.playerId;
    });
    const exceptionByMatch = new Map(playerExceptions.map(e => {
      const mId = Array.isArray(e.match) ? e.match[0] : e.match;
      return [mId || '', e];
    }));

    let updated = 0;

    for (const matchId of input.matchIds) {
      const existing = exceptionByMatch.get(matchId);

      if (input.status === 'Available') {
        // Delete the exception if it exists
        if (existing) {
          await AvailabilityExceptions.delete({ id: existing.id });
          updated++;
        }
      } else if (existing) {
        // Update existing exception
        await AvailabilityExceptions.update({
          id: existing.id,
          record: {
            availabilityStatus: input.status,
            playerNotes: input.notes || '',
            updatedBy: input.playerId,
          },
        });
        updated++;
      } else {
        // Create new exception
        await AvailabilityExceptions.create({
          record: {
            match: matchId,
            player: input.playerId,
            availabilityStatus: input.status,
            playerNotes: input.notes || '',
            updatedBy: input.playerId,
          },
        });
        updated++;
      }
    }

    return { success: true, updated };
  },
});
