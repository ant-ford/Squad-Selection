import { peopleRepository, teamsRepository } from '@/repositories';
import { getCached } from '@/lib/cache';

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
  everRegisteredToPremier: string;
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

export async function fetchReferenceData(): Promise<{ data: ReferenceData; fromCache: boolean }> {
  return getCached<ReferenceData>('club-reference', async () => {
    // Fetch active teams
    const teamsRecords = await teamsRepository.findAll({
      filterByFormula: '{Active}=TRUE()'
    });
    const teams: CachedTeam[] = teamsRecords.map(t => ({
      id: t.id,
      teamName: t.teamName || '',
      teamRank: t.teamRank || 99,
      isPremier: t.isPremier || false,
      targetSquadSize: t.targetSquadSize || 16,
      active: t.active || false,
      coach: t.coach || [],
      teamCaptain: t.teamCaptain || [],
      sectionCaptain: t.sectionCaptain || [],
    }));

    // Fetch active players (pagination support)
    const playerRecords = await peopleRepository.findAll({
      filterByFormula: '{Active}=TRUE()'
    });
    const players: CachedPlayer[] = playerRecords.map(p => ({
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
      everRegisteredToPremier: p.everRegisteredToPremier || '',
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

// This function is called directly from components (no Zite endpoint wrapper)
export async function getClubReferenceData(): Promise<ReferenceData> {
  const { data } = await fetchReferenceData();
  return data;
}