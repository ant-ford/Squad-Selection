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
} as const;

export const SQUADSELECTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  selectedBy: "Selected By",
  selectedAt: "Selected At",
  selectionStatus: "Selection Status",
  selectionNotes: "Selection Notes",
} as const;

export const AVAILABILITYEXCEPTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  availabilityStatus: "Availability Status",
  note: "Player Notes",
  // Was missing before the Worker migration, even though setAvailability /
  // setMyAvailability both wrote an `updatedBy` value — the write silently
  // went nowhere because there was no matching Airtable column name here.
  updatedBy: "Updated By",
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