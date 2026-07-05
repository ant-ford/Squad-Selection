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
}

export interface SquadSelection {
  id: string;
  player?: string[];
  match?: string[];
  selectedBy?: string[];
  selectedAt?: string;
  selectionStatus?: string;
  selectionNotes?: string;
}

export interface AvailabilityException {
  id: string;
  player?: string[];
  match?: string[];
  availabilityStatus?: string;
  note?: string;
}

export interface MatchCard {
  id: string;
  /** → People link. */
  player?: string[];
  /** → Matches link. */
  match?: string[];
  /** The team whose match this was (single select text). */
  team?: string;
  /** Player's registered team (single select text). */
  playerTeam?: string;
  /** Formula: Team != PlayerTeam. */
  playUp?: boolean;
  /** Role in this specific match — source of truth for GK exemption. */
  goalkeeper?: boolean;
  jersey?: number;
  goals?: number;
  cards?: string[];
  u21?: boolean;
  vp?: boolean;
  captain?: boolean;
  /** Inherited from match link (formula). */
  season?: string;
  fixtureId?: string;
  rawPlayerName?: string;
}