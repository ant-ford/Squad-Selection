export const PEOPLE_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  email: "Email",
  active: "Active",
  registeredTeam: "Registered Team",
  playingPosition: "Playing Position",
  playingAbility: "Playing Ability",
  isVisitingPlayer: "Is Visiting Player",
  isSuspended: "Is Suspended",
  matchesToServe: "Matches To Serve",
  everRegisteredToPremier: "Ever Registered To Premier",
  playerCoach: "Player/Coach",
} as const;

export const TEAMS_FIELDS = {
  teamName: "Team Name",
  teamRank: "Team Rank",
  isPremier: "Is Premier",
  targetSquadSize: "Target Squad Size",
  active: "Active",
  coach: "Coach",
  teamCaptain: "Team Captain",
  sectionCaptain: "Section Captain",
} as const;

export const MATCHES_FIELDS = {
  matchDate: "Date",
  division: "Division",
  homeTeam: "Home Team",
  homeTeamScore: "Home Score",
  awayTeam: "Away Team",
  awayTeamScore: "Away Score",
  matchStatus: "Match Status",
  venue: "Venue",
} as const;

export const SQUADSELECTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  selectedBy: "Selected By",
  selectedAt: "Selected At",
} as const;

export const AVAILABILITYEXCEPTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  availabilityStatus: "Availability Status",
  note: "Player Notes",
} as const;

export const MATCHCARDS_FIELDS = {
  player: "Player",
  match: "Match",
  goals: "Goals Scored",
  cards: "Cards",
} as const;