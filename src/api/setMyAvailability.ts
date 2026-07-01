import { z } from 'zod';
import { createEndpoint, AvailabilityExceptions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Set availability for the logged-in player on a match',
  inputSchema: z.object({
    matchId: z.string(),
    status: z.enum(['Available', 'Maybe', 'Unavailable']),
    notes: z.string().optional(),
    existingExceptionId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const userId = context.user.id;

    if (input.status === 'Available') {
      // Remove the exception if it exists
      if (input.existingExceptionId) {
        await AvailabilityExceptions.delete({ id: input.existingExceptionId });
      }
    } else if (input.existingExceptionId) {
      await AvailabilityExceptions.update({
        id: input.existingExceptionId,
        record: {
          availabilityStatus: input.status,
          playerNotes: input.notes || '',
          updatedBy: userId,
        },
      });
    } else {
      await AvailabilityExceptions.create({
        record: {
          match: input.matchId,
          player: userId,
          availabilityStatus: input.status,
          playerNotes: input.notes || '',
          updatedBy: userId,
        },
      });
    }

    return { success: true };
  },
});
