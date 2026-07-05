import { apiGet } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

export interface ProfileData {
  preferredName: string;
  roles: string[];
  isCoach: boolean;
  isAdmin: boolean;
  isSectionCaptain: boolean;
  captainTeams: string[];

  coachTeams: {
    id: string;
    teamName: string;
    teamRank: number;
    targetSquadSize: number;
  }[];
}

export async function getMyProfile(): Promise<ProfileData> {
  const user = await getCurrentSupabaseUser();

  if (!user?.email) {
    throw new Error('Not authenticated');
  }

  return apiGet<ProfileData>(
    '/api/my-profile',
    { email: user.email }
  );
}