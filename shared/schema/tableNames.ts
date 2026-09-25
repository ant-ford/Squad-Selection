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

/**
 * Airtable table ids for the tables the Worker caches, from
 * docs/Airtable Schema.json. Webhook payloads name tables by id, never by
 * name, so this is how a change notification is mapped back to the caches
 * it invalidates (worker/src/airtableWebhook.ts).
 */
export const TABLE_IDS: Record<string, string> = {
  tblsM3GD1o3ZrWyBE: TABLES.player,
  tblcr6NEkaOfIdpqd: TABLES.team,
  tbl7lDnqEmRUPV6Ah: TABLES.match,
  tbljzQy4hl3IfMJp1: TABLES.availabilityException,
  tblAfY7xhjkcKXlGq: TABLES.matchCard,
  tblTc4kNMHmFBZn4Q: TABLES.abilityGroupConfiguration,
  tblJ8GXEOY9YAluW4: "Ranking Events",
  tblfWkNsOIl3hrXAt: TABLES.membershipOfficer,
  tblVRHhaM3o25Ld8I: TABLES.sectionChair,
  tblYhjoksGpD99Xvs: TABLES.sectionCaptainOffice,
  tblpZl6OOdArZCV99: TABLES.commitment,
  tblcleIjg9wR8UBBg: TABLES.sponsor,
};