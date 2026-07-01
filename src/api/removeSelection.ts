import { z } from 'zod';
import { createEndpoint, ZiteError, SquadSelections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Remove a squad selection',
  inputSchema: z.object({ selectionId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const sel = await SquadSelections.findOne({ id: input.selectionId });
    if (!sel) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'Selection not found' });
    }
    await SquadSelections.delete({ id: input.selectionId });
    return { success: true };
  },
});
