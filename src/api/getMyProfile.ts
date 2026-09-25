import { apiGet } from '@/lib/apiClient';

export interface ProfileData {
  preferredName: string;
  roles: string[];
  isCoach: boolean;

  isSectionCaptain: boolean;
  /** Active Membership Officer / Section Chair / Section Captain rows. Empty for almost everyone. */
  officerRoles: {
    office: 'membershipOfficer' | 'sectionChair' | 'sectionCaptain';
    designation: string;
  }[];
  /** Officers' sections this person may open, decided by the Worker. */
  sections: ('membership' | 'chairman')[];
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