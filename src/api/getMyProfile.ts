import { apiGet } from '@/lib/apiClient';

export interface ProfileData {
  preferredName: string;
  roles: string[];
  isCoach: boolean;

  isSectionCaptain: boolean;
  /** Active Membership Officer / Section Chair / Section Captain rows. Empty for almost everyone. */
  officerRoles: {
    office: 'membershipOfficer' | 'sectionChair' | 'sectionCaptain' | 'kitConvenor' | 'hockeyConvenor';
    designation: string;
  }[];
  /** Officers' sections this person may open, decided by the Worker. */
  sections: ('membership' | 'chairman' | 'kit' | 'planning')[];
  /** Whether the Hockey Rules quizzes are in Eddy yet (Supabase backend). */
  quizzes?: boolean;
  /** An applicant or someone registering to join: their home is the application page. */
  applicant?: boolean;
  /** Their link for inviting someone to register to join; members only, on Supabase. */
  inviteLink?: string | null;
  /** Whether the Season plans screen has teams for them (worker/src/seasonPlan.ts). */
  seasonPlans?: boolean;
  /** Whether the Volunteers screen is theirs (officers, coaches, captains). */
  volunteers?: boolean;
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