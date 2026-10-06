export const TABLES = {
  player: "People",
  team: "Teams",
  match: "Matches",
  availabilityException: "Availability Exceptions",
  matchCard: "Match Cards",
  abilityGroupConfiguration: "Ability Group Configuration",
  selectionEvent: "Selection Events",
  availabilityRule: "Availability Rules",
  membershipOfficer: "Membership Officers",
  sectionChair: "Section Chairs",
  sectionCaptainOffice: "Section Captains",
  commitment: "Commitments",
  sponsor: "Sponsors",
} as const;

/** Ranking history (worker/src/rankingEvents.ts); see README, "Ranking Events table". */
export const RANKING_EVENTS_TABLE = "Ranking Events";

/** The membership section's audit table (worker/src/membership.ts has its layout). */
export const MEMBERSHIP_EVENTS_TABLE = "Membership Events";
