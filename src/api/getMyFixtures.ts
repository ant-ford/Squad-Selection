import { apiGet } from '@/lib/apiClient';

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
 * Fetches the current user's fixtures from the Worker (GET /api/my-fixtures).
 * The Worker derives the identity from the verified Supabase session — the
 * browser never supplies the email.
 */
export async function getMyFixtures(): Promise<GetMyFixturesOutput> {
  return apiGet<GetMyFixturesOutput>('/api/my-fixtures');
}