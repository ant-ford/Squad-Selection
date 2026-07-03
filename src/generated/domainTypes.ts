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
  everRegisteredToPremier?: string;
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
  matchDate: string,
  division: string,
  homeTeam: string,
  homeTeamScore: number,
  awayTeam: string,
  awayTeamScore: number,
  matchStatus: string,
  venue?: string;
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
  player?: string[];
  match?: string[];
  goals?: number;
  cards?: string[];
}