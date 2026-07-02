import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { fetchReferenceData } from './getClubReferenceData';

export default createEndpoint({
  authenticated: true,
  description: 'Returns the logged-in user role and coached teams',
  inputSchema: z.object({}),
  outputSchema: z.object({
    preferredName: z.string(),
    roles: z.array(z.string()),
    isCoach: z.boolean(),
    isAdmin: z.boolean(),
    coachedTeams: z.array(z.object({
      id: z.string(),
      teamName: z.string(),
      teamRank: z.number(),
      targetSquadSize: z.number(),
    })),
  }),
  execute: async ({ context }) => {
    const user = context.user;
    const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
    const isCoach = roles.includes('Coach');

    // Use cached teams instead of querying Airtable directly
    const { data: ref } = await fetchReferenceData();
    const userId = user.id;

    const coachedTeams = ref.teams.filter(t =>
      t.coach.includes(userId) || t.teamCaptain.includes(userId) || t.sectionCaptain.includes(userId)
    );

    return {
      preferredName: user.preferredName || user.givenNames || 'Coach',
      roles,
      isCoach,
      isAdmin: isCoach,
      coachedTeams: coachedTeams
        .map(t => ({
          id: t.id,
          teamName: t.teamName,
          teamRank: t.teamRank,
          targetSquadSize: t.targetSquadSize,
        }))
        .sort((a, b) => a.teamRank - b.teamRank),
    };
  },
});
