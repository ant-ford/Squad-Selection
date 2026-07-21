import { apiGet } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

export interface MyFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
  /** True when this fixture is for a team other than the player's registered team. */
  isPlayUp?: boolean;
  /** The HKFC team this fixture/selection belongs to (set when isPlayUp). */
  selectionTeam?: string;
}

export interface GetMyFixturesOutput {
  playerName: string;
  registeredTeam: string;
  playingPosition: string;
  shirtNoValue: string;
  isCoach: boolean;
  coachTeams: string[];
  captainTeams: string[];
  isSectionCaptain: boolean;
  /** Registered-team matches plus any match the player is selected for (play-ups). */
  fixtures: MyFixture[];
  /**
   * Same-day higher-ranked team matches the player is eligible for but not
   * selected in — surfaced so the player can mark themselves unavailable and
   * release the same-day conflict for their registered team.
   */
  eligibleOtherFixtures?: MyFixture[];
}

/**
 * Resolves the current user's email and fetches their fixtures from the
 * Worker (GET /api/my-fixtures).
 */
export async function getMyFixtures(): Promise<GetMyFixturesOutput> {
  const user = await getCurrentSupabaseUser();
  if (!user?.email) throw new Error('Not authenticated');
  return apiGet<GetMyFixturesOutput>('/api/my-fixtures', { email: user.email });
}