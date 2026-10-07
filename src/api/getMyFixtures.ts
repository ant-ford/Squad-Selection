import type { FixtureChange } from '@shared/fixtureChange';
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
  /**
   * True when the status above came from a standing preference rather than
   * an answer the player gave for this fixture. The Worker has always sent
   * this; without it on screen there is no way to tell "I said no" from
   * "a preference decided for me", which is exactly the confusion that made
   * a stuck midweek fixture so hard to explain.
   */
  availabilityFromRule?: boolean;
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
  /** Moved, venue changed, postponed or cancelled in the last 7 days. */
  change?: FixtureChange;
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
  /** Officers' sections this person may open, decided by the Worker. */
  sections?: ('membership' | 'chairman' | 'kit' | 'planning' | 'trials' | 'registration')[];
  /** Whether the Season plans screen has anything for them (coaches, Section Captains). */
  seasonPlans?: boolean;
  /** Whether the Volunteers screen is theirs (officers, coaches, captains). */
  volunteers?: boolean;
  /** Whether the Events screen is theirs (social secretaries, Section Captains). */
  events?: boolean;
  /** The umpiring duties screen: the club's umpires, and the Umpire Coordinator who runs it. */
  umpiring?: 'umpire' | 'coordinator' | null;
  /** Whether their details are kept in Eddy (the Supabase backend): shows "My details". */
  eddyProfile?: boolean;
  /** Today (Hong Kong time) is this player's birthday. */
  isBirthday?: boolean;
  /** Teammates (same Selected Team) whose birthday it is today, by name. */
  teamBirthdays?: string[];
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
    // Results come from the cached season context, so this adds no extra
    // read. The dashboard always asks for them and hides them in the UI.
    past: includePast ? '1' : undefined,
  });
}