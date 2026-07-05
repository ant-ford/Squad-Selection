import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface ProfileData {
  preferredName: string;
  roles: string[];
  isCoach: boolean;
  isAdmin: boolean;
  coachedTeams: {
    id: string;
    teamName: string;
    teamRank: number;
    targetSquadSize: number;
  }[];
}

export async function getMyProfile(): Promise<ProfileData> {
  const user = await getCurrentPeople();
  const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
  const isCoach = roles.includes('Coach');

  const ref = await getClubReferenceData();
  const userId = user.id;

  const coachedTeams = ref.teams.filter(
    (t) =>
      (t.coach || []).includes(userId) ||
      (t.teamCaptain || []).includes(userId) ||
      (t.sectionCaptain || []).includes(userId)
  );

  return {
    preferredName: user.preferredName || user.givenNames || 'Coach',
    roles,
    isCoach,
    isAdmin: isCoach,
    coachedTeams: coachedTeams
      .map((t) => ({
        id: t.id,
        teamName: t.teamName || '',
        teamRank: t.teamRank ?? 99,
        targetSquadSize: t.targetSquadSize || 16,
      }))
      .sort((a, b) => a.teamRank - b.teamRank),
  };
}
