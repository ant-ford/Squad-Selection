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
  playingAbility?: string;
  isVisitingPlayer?: boolean;
  isSuspended?: boolean;
  matchesToServe?: number;
  everRegisteredToPremier?: boolean;
  u21Eligible?: boolean;
  playerCoach?: string[];
  sectionRank?: number;
  teamRank?: number;
  positionalRank?: number;
  rankUpdatedAt?: string;
  status?: string;
  applicantStage?: string;
  /** People.Photo — first attachment URL. */
  photo?: string;
  /** People."Sports Background / Involvement" — applicant Hockey CV. */
  sportsBackground?: string;
  /** People."Selection Comments/Coach Requests" — free-text coach notes. */
  selectionComments?: string;
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
  autoSelectPlayers?: string[];
}

export interface Match {
  id: string;
  matchDate: string;
  season?: string;
  division: string;
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
  autoSelectEnabled?: boolean;
}

export interface AvailabilityException {
  id: string;
  player?: string[];
  match?: string[];
  availabilityStatus?: string;
  note?: string;
  season?: string;
  updatedAt?: string;
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
  A: number; B: number; C: number; D: number;
  E: number; F: number; G: number;
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
  status?: string;
  applicantStage?: string;
}

export interface RankingList {
  players: Player[];
  activeCount: number;
  lastUpdated: string;
  config: AbilityGroupConfigMap;
  version: number;
}