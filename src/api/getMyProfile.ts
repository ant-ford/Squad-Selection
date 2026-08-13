import { apiGet } from '@/lib/apiClient';

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
  // The Worker derives the identity from the verified Supabase session.
  return apiGet<ProfileData>('/api/my-profile');
}