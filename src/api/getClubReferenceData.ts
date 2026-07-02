import { z } from 'zod';
import { createEndpoint, Teams, People } from 'zite-integrations-backend-sdk';
import { getCached } from '../lib/cache';

// Shared types used by other endpoints
export type CachedPlayer = {
  id: string;
  preferredName: string;
  givenNames: string;
  surname: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  isSuspended: boolean;
  matchesToServe: number;
  isVisitingPlayer: boolean;
  everRegisteredToPremier: boolean;
  active: boolean;
};

export type CachedTeam = {
  id: string;
  teamName: string;
  teamRank: number;
  isPremier: boolean;
  targetSquadSize: number;
  active: boolean;
  coach: string[];
  teamCaptain: string[];
  sectionCaptain: string[];
};

export type ReferenceData = {
  players: CachedPlayer[];
  teams: CachedTeam[];
  teamRankMap: Record<string, number>;
  teamNames: string[];
};

// Internal fetcher — shared by endpoint and direct imports
export async function fetchReferenceData(): Promise<{ data: ReferenceData; fromCache: boolean }> {
  return getCached<ReferenceData>('club-reference', async () => {
    // Fetch teams (typically <20 records, 1 call)
    const teamsResult = await Teams.findAll({ filters: { active: true } });
    const teams: CachedTeam[] = teamsResult.records.map(t => ({
      id: t.id,
      teamName: t.teamName || '',
      teamRank: t.teamRank || 99,
      isPremier: t.isPremier || false,
      targetSquadSize: t.targetSquadSize || 16,
      active: t.active || false,
      coach: Array.isArray(t.coach) ? t.coach : t.coach ? [t.coach] : [],
      teamCaptain: Array.isArray(t.teamCaptain) ? t.teamCaptain : t.teamCaptain ? [t.teamCaptain] : [],
      sectionCaptain: Array.isArray(t.sectionCaptain) ? t.sectionCaptain : t.sectionCaptain ? [t.sectionCaptain] : [],
    }));

    // Fetch active players with pagination (typically 100-200 records, 1-2 calls)
    const p1 = await People.findAll({ filters: { active: true }, limit: 100 });
    let allPlayerRecords = p1.records;
    if (p1.hasMore) {
      const p2 = await People.findAll({ filters: { active: true }, limit: 100, offset: p1.offset });
      allPlayerRecords = [...allPlayerRecords, ...p2.records];
      if (p2.hasMore) {
        const p3 = await People.findAll({ filters: { active: true }, limit: 100, offset: p2.offset });
        allPlayerRecords = [...allPlayerRecords, ...p3.records];
      }
    }

    const players: CachedPlayer[] = allPlayerRecords.map(p => ({
      id: p.id,
      preferredName: p.preferredName || '',
      givenNames: p.givenNames || '',
      surname: p.surname || '',
      registeredTeam: p.registeredTeam || '',
      playingPosition: p.playingPosition || '',
      playingAbility: p.playingAbility || '',
      isSuspended: p.isSuspended || false,
      matchesToServe: p.matchesToServe || 0,
      isVisitingPlayer: p.isVisitingPlayer || false,
      everRegisteredToPremier: p.everRegisteredToPremier || false,
      active: p.active || false,
    }));

    const teamRankMap: Record<string, number> = {};
    for (const t of teams) {
      teamRankMap[t.teamName] = t.teamRank;
    }

    return {
      players,
      teams,
      teamRankMap,
      teamNames: teams.map(t => t.teamName),
    };
  });
}

// Zod schemas for the endpoint response
const cachedPlayerSchema = z.object({
  id: z.string(),
  preferredName: z.string(),
  givenNames: z.string(),
  surname: z.string(),
  registeredTeam: z.string(),
  playingPosition: z.string(),
  playingAbility: z.string(),
  isSuspended: z.boolean(),
  matchesToServe: z.number(),
  isVisitingPlayer: z.boolean(),
  everRegisteredToPremier: z.boolean(),
  active: z.boolean(),
});

const cachedTeamSchema = z.object({
  id: z.string(),
  teamName: z.string(),
  teamRank: z.number(),
  isPremier: z.boolean(),
  targetSquadSize: z.number(),
  active: z.boolean(),
  coach: z.array(z.string()),
  teamCaptain: z.array(z.string()),
  sectionCaptain: z.array(z.string()),
});

export default createEndpoint({
  authenticated: true,
  description: 'Returns cached club reference data (teams + players). Cached for 10 minutes.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    players: z.array(cachedPlayerSchema),
    teams: z.array(cachedTeamSchema),
    teamRankMap: z.record(z.number()),
    teamNames: z.array(z.string()),
    fromCache: z.boolean(),
  }),
  execute: async () => {
    const { data, fromCache } = await fetchReferenceData();
    return { ...data, fromCache };
  },
});
