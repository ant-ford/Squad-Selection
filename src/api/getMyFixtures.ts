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
  /**
   * Presentation category vs the player's displayed team (Team Rank):
   * "own" = My Team, "play-up" = higher-ranked team, "support" = lower team.
   * Presentation only - eligibility is unchanged.
   */
  fixtureCategory?: "own" | "play-up" | "support";
  /** True only for fixtures of teams ranked ABOVE the displayed team. */
  isPlayUp?: boolean;
  /** The HKFC team this fixture/selection belongs to (set when isPlayUp). */
  selectionTeam?: string;
}

export interface GetMyFixturesOutput {
  playerId: string;
  playerName: string;
  /** The team the app displays for this player (Selected Team EOS -> SOS -> Registered). */
  displayTeam?: string;
  registeredTeam: string;
  playingPosition: string;
  shirtNoValue: string;
  isCoach: boolean;
  coachTeams: string[];
  captainTeams: string[];
  isSectionCaptain: boolean;
  /**
   * True when this player is a goalkeeper registered to the lowest-ranked
   * active team - they see ALL upcoming HKFC fixtures instead of only their
   * registered team's matches.
   */
  specialGoalkeeperView?: boolean;
  /** Registered-team matches plus any match the player is selected for (play-ups). */
  fixtures: MyFixture[];
  /**
   * Higher-ranked team fixtures the player could help with (selected or
   * eligible same-day) - presented as Play-Up Opportunities.
   */
  playUpOpportunities?: MyFixture[];
  /**
   * Lower-ranked team fixtures - presented as Support Fixtures for
   * availability planning.
   */
  supportFixtures?: MyFixture[];
}

/**
 * Fetches the current user's fixtures from the Worker (GET /api/my-fixtures).
 * The Worker derives the identity from the verified Supabase session — the
 * browser never supplies the email.
 */
export async function getMyFixtures(): Promise<GetMyFixturesOutput> {
  return apiGet<GetMyFixturesOutput>('/api/my-fixtures');
}