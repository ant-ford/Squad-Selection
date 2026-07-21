export interface Player {
  id: string;
  preferredName?: string;
  givenNames?: string;
  surname?: string;
  shirtNoValue?: string;
  email?: string;
  active?: boolean;
  registeredTeam?: string;
  playingPosition?: string;
  /** Calculated by ranking engine: e.g. "A+", "A", "A-", "B+", ..., "H-". */
  playingAbility?: string;
  isVisitingPlayer?: boolean;
  isSuspended?: boolean;
  matchesToServe?: number;
  everRegisteredToPremier?: boolean;
  u21Eligible?: boolean;
  playerCoach?: string[];
  /** The ONLY manually-maintained ranking value. 1 = strongest, N = lowest. */
  sectionRank?: number;
  /** Calculated: rank within the player's Registered Team (1 = best in team). */
  teamRank?: number;
  /** Calculated: rank within the player's Playing Position across the entire section (1 = best in position). */
  positionalRank?: number;
  /** ISO timestamp of the last rank change for this player. */
  rankUpdatedAt?: string;
}

export interface Team {
  id: string;
  teamName?: string;
  teamRank?: number;
  isPremier?: boolean;
  targetSquadSize?: number;
  active?: boolean;
  coach?: string[];
  teamCaptain?: string[];
  sectionCaptain?: string[];
}

export interface Match {
  id: string;
  matchDate: string;
  /** Formula field: derived from Date using 1 July boundary. */
  season?: string;
  division: string;
  /** Distinguishes League / Cup / Plate / Bowl. */
  competitionType?: string;
  homeTeam: string;
  homeTeamScore: number;
  awayTeam: string;
  awayTeamScore: number;
  matchStatus: string;
  venue?: string;
  fixtureId?: string;
  selectedPlayersHome?: string[];
  selectedPlayersAway?: string[];
}

export interface AvailabilityException {
  id: string;
  player?: string[];
  match?: string[];
  availabilityStatus?: string;
  note?: string;
  season?: string;
}

export interface MatchCard {
  id: string;
  player?: string[];
  match?: string[];
  team?: string;
  playerTeam?: string;
  playUp?: boolean;
  goalkeeper?: boolean;
  jersey?: number;
  goals?: number;
  cards?: string[];
  u21?: boolean;
  vp?: boolean;
  captain?: boolean;
  season?: string;
  fixtureId?: string;
  rawPlayerName?: string;
}

// ── Ranking types ────────────────────────────────────────────────────────

export type AbilityGroupConfigMap = {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
  G: number;
};

export interface AbilityGroupConfiguration {
  id: string;
  group: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
  capacity: number;
  isResidual?: boolean;
}

export interface InactiveRankingEntry {
  id: string;
  preferredName?: string;
  surname?: string;
  givenNames?: string;
  registeredTeam?: string;
  playingPosition?: string;
  lastSectionRank?: number;
}

export interface RankingList {
  players: Player[];
  activeCount: number;
  lastUpdated: string;
  config: AbilityGroupConfigMap;
}