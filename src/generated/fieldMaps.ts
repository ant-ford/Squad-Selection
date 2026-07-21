export const PEOPLE_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  shirtNoValue: "Shirt No Value",
  email: "Email",
  active: "Active",
  registeredTeam: "Registered Team",
  playingPosition: "Playing Position",
  playingAbility: "Playing Ability",
  isVisitingPlayer: "Is Visiting Player",
  isSuspended: "Is Suspended",
  matchesToServe: "Matches To Serve",
  everRegisteredToPremier: "Ever Registered To Premier",
  u21Eligible: "U21 Eligible",
  playerCoach: "Player/Coach",
  sectionRank: "Section Rank",
  teamRank: "Team Rank",
  positionalRank: "Positional Rank",
  rankUpdatedAt: "Rank Updated At",
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
  season: "Season",
  division: "Division",
  competitionType: "Competition Type",
  homeTeam: "Home Team",
  homeTeamScore: "Home Score",
  awayTeam: "Away Team",
  awayTeamScore: "Away Score",
  matchStatus: "Match Status",
  venue: "Venue",
  fixtureId: "Fixture Id",
  selectedPlayersHome: "Selected Players Home",
  selectedPlayersAway: "Selected Players Away",
} as const;

export const AVAILABILITYEXCEPTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  availabilityStatus: "Availability Status",
  note: "Player Notes",
  updatedBy: "Updated By",
  season: "Season (Matches)",
} as const;

export const MATCHCARDS_FIELDS = {
  player: "Player",
  match: "Match",
  team: "Team",
  playerTeam: "Player Team",
  playUp: "Play Up?",
  goalkeeper: "Goalkeeper",
  jersey: "Jersey Number",
  goals: "Goals Scored",
  cards: "Cards",
  u21: "U21",
  vp: "VP",
  captain: "Captain",
  season: "Season",
  fixtureId: "Fixture Id",
  rawPlayerName: "RawPlayerName",
} as const;

export const ABILITYGROUP_CONFIG_FIELDS = {
  group: "Group",
  capacity: "Capacity",
  isResidual: "Is Residual",
} as const;