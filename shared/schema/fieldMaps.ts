/**
 * The columns the officer sections read from the CRM views
 * (api_people_crm, api_commitments_crm). Each list is both what a read
 * selects and the keys module code reads off a row (worker/src/data/rows.ts):
 * the view columns carry these names.
 *
 * The squad app's own reads (players, teams, matches, ...) return domain
 * types and need no list.
 */

/**
 * People columns the membership board reads. Kept apart from the squad
 * reads on purpose, and passed explicitly by worker/src/data/people.ts and
 * nowhere else. No HKID, bank or address column belongs here.
 */
export const MEMBERSHIP_FIELDS = [
  "preferredName",
  "givenNames",
  "surname",
  "photo",
  "status",
  "applicantStage",
  /** When Applicant Stage last changed; blank rows count days from the application date. */
  "stageUpdatedAt",
  "applicationDate",
  "membershipNo",
  "joinDate",
  "commitmentEndDate",
  "mobileNo",
  "applicantType",
  "categoryType",
  "gender",
  "playingPosition",
  "registeredTeam",
  "selectedTeamSos",
  "selectedTeamEos",
  "sponsorName",
  "sportsBackground",
  "personalInterest",
  "tourInterest",
  "qualifiedUmpire",
  "qualifiedCoach",
  "playingLevel",
  "selectionComments",
  "applicationForm",
  /**
   * Read only to pre-fill Approve's Commitment End Date with the 28th
   * birthday; the board sends that date, never the date of birth.
   */
  "dateOfBirth",
  /**
   * Who signs each stage, as links to their office row (Sponsors, Section
   * Chairs, Membership Officers). Read for the board's WhatsApp shortcut
   * to whoever the application is waiting on; never written.
   */
  "sponsoredBySponsor",
  "sponsoredByChair",
  "sponsoredByOfficer",
] as const;

/**
 * People columns the chairman's email lists read (worker/src/chairman.ts):
 * the attributes a list is built from and the addresses it sends to.
 * Separate from MEMBERSHIP_FIELDS for the same reason: no read grows for
 * another section's sake. No HKID, bank or address column belongs here.
 */
export const CHAIRMAN_FIELDS = [
  "preferredName",
  "givenNames",
  "surname",
  "status",
  "active",
  "applicantStage",
  "membershipNo",
  "memberType",
  "categoryType",
  "playerCoach",
  "registeredTeam",
  "selectedTeamSos",
  "selectedTeamEos",
  "ageBand",
  "hockeyCommittee",
  "subCommittee",
  "teamRoles",
  "touringCommittee",
  "juniorVolunteers",
  "easter5s",
  "generalVolunteers",
  "tourInterest",
  "tournamentInterest",
  "qualifiedUmpire",
  "qualifiedCoach",
  "captaincyInterest",
  "email",
  /** Years since the date of birth. Under 18 copies in the guardian. */
  "age",
  "guardianEmail",
] as const;

/**
 * Commitments columns the membership section's Statements board reads
 * (worker/src/statements.ts): one row per member per commitment year, and
 * its Review Progress. The AI, combined-context and signature columns are
 * deliberately left out.
 */
export const COMMITMENT_FIELDS = [
  "reviewProgress",
  /** When Review Progress last changed; blank rows use the submission dates. */
  "reviewUpdatedAt",
  /** Whether the review email was asked for early (Notify Now). */
  "notifyNow",
  "people",
  "fullName",
  "preferredName",
  "membershipNo",
  "joinDate",
  "commitmentEndDate",
  "yearNo",
  "period",
  "periodStart",
  "periodEnd",
  "selectedTeamSos",
  "selectedTeamEos",
  "sponsorName",
  /** Link to the Sponsors row; read for the WhatsApp shortcut, never written. */
  "sponsorLink",
  "matchesPlayed",
  "matchesAvailable",
  "matchesNotAvailable",
  "matchesTeamPlayed",
  "teamsPlayed",
  "practices",
  "socialFunctions",
  "gamesUmpired",
  "qualifiedUmpire",
  "otherContributions",
  "lowParticipationReason",
  "sectionServiceMember",
  "hkfcServiceMember",
  "sectionServiceSponsor",
  "hkfcServiceSponsor",
  "sponsorRecommendation",
  "recommendedReduction",
  "memberSubmittedAt",
  "sponsorSubmittedAt",
  "officerSubmittedAt",
  "playerStatement",
  "officerFormUrl",
] as const;
