import { z } from 'zod';
import { createEndpoint, Teams } from 'zite-integrations-backend-sdk';

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

    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const userId = user.id;

    const coachedTeams = teamsResult.records.filter(t => {
      const coachIds = Array.isArray(t.coach) ? t.coach : t.coach ? [t.coach] : [];
      const captainIds = Array.isArray(t.teamCaptain) ? t.teamCaptain : t.teamCaptain ? [t.teamCaptain] : [];
      const secCapIds = Array.isArray(t.sectionCaptain) ? t.sectionCaptain : t.sectionCaptain ? [t.sectionCaptain] : [];
      return coachIds.includes(userId) || captainIds.includes(userId) || secCapIds.includes(userId);
    });

    return {
      preferredName: user.preferredName || user.givenNames || 'Coach',
      roles,
      isCoach,
      isAdmin: isCoach,
      coachedTeams: coachedTeams
        .map(t => ({
          id: t.id,
          teamName: t.teamName || '',
          teamRank: t.teamRank || 99,
          targetSquadSize: t.targetSquadSize || 16,
        }))
        .sort((a, b) => a.teamRank - b.teamRank),
    };
  },
});
