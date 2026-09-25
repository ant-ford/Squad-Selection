export const PEOPLE_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  shirtNoValue: "Shirt No Value",
  email: "Email",
  active: "Active",
  registeredTeam: "Registered Team",
  selectedTeamSos: "Selected Team SOS",
  selectedTeamEos: "Selected Team EOS",
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
  status: "Status",
  applicantStage: "Applicant Stage",
  photo: "Photo",
  sportsBackground: "Sports Background / Involvement",
  selectionComments: "Selection Comments/Coach Requests",
  mobileNo: "Mobile No.",
  optInOnly: "Opt-In Only",
  /**
   * Read for the birthday banner only. The mapper keeps the month and day
   * and drops the year, so no response built from a Player carries a date
   * of birth.
   */
  dateOfBirth: "Date of Birth",
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
  autoSelectPlayers: "Auto Select Players",
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
  autoSelectEnabled: "Auto Select Enabled",
  homeKit: "Home Kit",
  awayKit: "Away Kit",
} as const;

export const AVAILABILITYEXCEPTIONS_FIELDS = {
  player: "Player",
  match: "Match",
  availabilityStatus: "Availability Status",
  note: "Player Notes",
  updatedBy: "Updated By",
  season: "Season (Matches)",
  updatedAt: "Updated At",
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
export const AVAILABILITYRULES_FIELDS = {
  player: "Player",
  ruleType: "Rule Type",
  availability: "Availability",
  active: "Active",
  startDate: "Start Date",
  endDate: "End Date",
  notes: "Notes",
  lastModified: "Last Modified",
} as const;

/**
 * People fields the membership board reads. Kept apart from PEOPLE_FIELDS on
 * purpose: those are fetched on every squad read, and widening them for
 * membership would slow every squad screen. This list is passed explicitly
 * by worker/src/membership.ts and nowhere else. No HKID, bank or address
 * field belongs here.
 */
export const MEMBERSHIP_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  photo: "Photo",
  status: "Status",
  applicantStage: "Applicant Stage",
  /**
   * A Last-modified-time field watching Applicant Stage only. Not in the
   * base as of 2026-09-25; until it is added, reads drop it (airtable.ts
   * missingFields) and the board counts days from the application date.
   */
  stageUpdatedAt: "Stage Updated At",
  applicationDate: "Application Date",
  membershipNo: "Membership No.",
  joinDate: "Join Date",
  commitmentEndDate: "Commitment End Date",
  mobileNo: "Mobile No.",
  applicantType: "Applicant Type",
  categoryType: "Category Type",
  gender: "Gender",
  playingPosition: "Playing Position",
  registeredTeam: "Registered Team",
  selectedTeamSos: "Selected Team SOS",
  selectedTeamEos: "Selected Team EOS",
  sponsorName: "Sponsor Preferred Name",
  sportsBackground: "Sports Background / Involvement",
  personalInterest: "Personal / Family Interest",
  tourInterest: "Tour Interest",
  qualifiedUmpire: "Qualified Umpire",
  qualifiedCoach: "Qualified Coach",
  playingLevel: "Playing Level",
  selectionComments: "Selection Comments/Coach Requests",
  applicationForm: "Sports Associate Application Form",
} as const;

/**
 * People fields the chairman's email lists read (worker/src/chairman.ts):
 * the attributes a list is built from and the addresses it sends to.
 * Separate from PEOPLE_FIELDS and MEMBERSHIP_FIELDS for the same reason as
 * those: no read grows for another section's sake. No HKID, bank or
 * address field belongs here.
 */
export const CHAIRMAN_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  status: "Status",
  active: "Active",
  applicantStage: "Applicant Stage",
  membershipNo: "Membership No.",
  memberType: "Member Type",
  categoryType: "Category Type",
  playerCoach: "Player/Coach",
  registeredTeam: "Registered Team",
  selectedTeamSos: "Selected Team SOS",
  selectedTeamEos: "Selected Team EOS",
  ageBand: "Age Band",
  hockeyCommittee: "Hockey Committee Roles",
  subCommittee: "Men's Sub-Committee",
  teamRoles: "Team Roles",
  touringCommittee: "Touring Committee",
  juniorVolunteers: "Junior Hockey Volunteers",
  easter5s: "Easter 5s Committee",
  generalVolunteers: "General Volunteers",
  tourInterest: "Tour Interest",
  tournamentInterest: "Tournament Interest",
  qualifiedUmpire: "Qualified Umpire",
  qualifiedCoach: "Qualified Coach",
  captaincyInterest: "Team Captain/Vice-Captain Interest",
  email: "Email",
  /** Formula: DATETIME_DIFF(TODAY(), {Date of Birth}, 'years'). Under 18 copies in the guardian. */
  age: "Age",
  guardianEmail: "Guardian/Parent Email",
} as const;

/**
 * Membership Officers, Section Chairs and Section Captains share this shape:
 * one row per office held, linked to the holder's People record. Status is
 * Active or Retired.
 */
export const OFFICER_FIELDS = {
  status: "Status",
  designation: "Designation",
  member: "Member",
} as const;

/**
 * Commitments fields the membership section's Statements board reads
 * (worker/src/statements.ts): one row per member per commitment year, and
 * its Review Progress. The AI, combined-context and signature fields are
 * deliberately left out - the officer reads those in their Fillout form.
 */
export const COMMITMENT_FIELDS = {
  reviewProgress: "Review Progress",
  /**
   * A Last-modified-time field watching Review Progress only. Optional:
   * until it exists reads drop it (airtable.ts missingFields) and days in a
   * stage come from the submission dates where there is one.
   */
  reviewUpdatedAt: "Review Progress Updated At",
  /**
   * Checkbox the app ticks to ask for the review email early. A copy of the
   * 60-day automation, triggered on "Review Progress is Not Started and
   * Notify Now is checked", sends the same email and moves the row on.
   */
  notifyNow: "Notify Now",
  people: "People",
  fullName: "Full Name",
  preferredName: "Preferred Name",
  membershipNo: "Membership No.",
  joinDate: "Join Date",
  commitmentEndDate: "Commitment End Date",
  yearNo: "Year #",
  period: "Period",
  periodStart: "Period Start",
  periodEnd: "Period End",
  selectedTeamSos: "Selected Team SOS",
  selectedTeamEos: "Selected Team EOS",
  sponsorName: "Sponsor Preferred Name",
  matchesPlayed: "Matches: Played",
  matchesAvailable: "Matches: Available (Did Not Play)",
  matchesNotAvailable: "Matches: Not Available",
  matchesTeamPlayed: "Matches: Team Played",
  teamsPlayed: "Player: Teams Played",
  practices: "Practices",
  socialFunctions: "Social Functions",
  gamesUmpired: "# Games Umpired",
  qualifiedUmpire: "Qualified Umpire",
  otherContributions: "Other Contributions",
  lowParticipationReason: "Player: Reason for low participation",
  sectionServiceMember: "Potential for Section service and involvement (Member)",
  hkfcServiceMember: "Potential for HKFC service and involvement (Member)",
  sectionServiceSponsor: "Potential for Section service and involvement (Sponsor)",
  hkfcServiceSponsor: "Potential for HKFC service and involvement (Sponsor)",
  sponsorRecommendation: "Recommendation (Sponsor)",
  recommendedReduction: "Recommended Commitment Reduction",
  memberSubmittedAt: "Member Submission Date",
  sponsorSubmittedAt: "Sponsor Submission Date",
  officerSubmittedAt: "Membership Officer Submission Date",
  playerStatement: "Player Statement",
  officerFormUrl: "Fillout - Membership Officer (Commitment Review Form)",
} as const;
