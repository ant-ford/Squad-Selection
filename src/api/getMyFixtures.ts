import { apiGet } from '@/lib/apiClient';
import type { KitColour } from '@/api/getPlayersForMatch';

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
  /** Shirt colour for this fixture; '' until a coach sets it. */
  kit?: KitColour;
}

/** A named goal or card contribution on a played fixture. */
export interface PastContribution {
  name: string;
  goals?: number;
  cards?: string[];
}

/** A fixture the player's team has already played. Read-only. */
export interface PastFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  /** Null when no score has been entered, so the tile can stay quiet. */
  goalsFor: number | null;
  goalsAgainst: number | null;
  outcome: 'win' | 'draw' | 'loss' | null;
  /** True when the player has a Match Card - the record that they played. */
  played: boolean;
  myGoals: number;
  myCards: string[];
  scorers: PastContribution[];
  cards: PastContribution[];
}

export interface GetMyFixturesOutput {
  playerId: string;
  playerName: string;
  /** Recently played fixtures. Empty unless the past view was requested. */
  pastFixtures?: PastFixture[];
  /** People.Photo, first attachment URL. Empty when the player has none. */
  photo?: string;
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
export async function getMyFixtures(includePast = false): Promise<GetMyFixturesOutput> {
  return apiGet<GetMyFixturesOutput>('/api/my-fixtures', {
    // Results come from the cached season context, so this adds no Airtable
    // call, but it is real payload on a screen most players open to answer
    // an upcoming fixture. Requested only when the past view is showing.
    past: includePast ? '1' : undefined,
  });
}