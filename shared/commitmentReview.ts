/**
 * The commitment review's questions and answer choices, shared by the review
 * screen and the Worker. The choices are the Airtable fields' own, and the
 * database checks the same lists (submit_* in the 20260930130000 migration).
 */

export const GAMES_UMPIRED = ["0", "1", "2", "3", "4", "5+"] as const;

export const PRACTICES = ["Very Regular 70%+", "Moderate 50-70%", "Hardly Ever <50%"] as const;

export const SOCIAL_FUNCTIONS = ["Start of Season", "Christmas Party", "End of Season", "Hockey Section AGM", "None"] as const;

export const RECOMMENDED_REDUCTIONS = ["None", "1 year", "1.5 years", "2 years"] as const;

/** Who is looking at a review, and so what they see and may do. */
export type ReviewRole = "member" | "sponsor" | "officer" | "viewer";

/** The step a review is at, and whose it is. */
export const STEP_OF_STAGE: Record<string, Exclude<ReviewRole, "viewer"> | undefined> = {
  "Notified Member": "member",
  "Member Submitted (with Sponsor)": "sponsor",
  "Sponsor Submitted (with Membership Officer)": "officer",
};

export interface MemberReport {
  gamesUmpired: string;
  practices: string;
  socialFunctions: string[];
  otherContributions: string;
  sectionService: string;
  hkfcService: string;
  lowParticipationReason: string;
  /** Office ids: the member's sponsor and, optionally, the Membership Officer. */
  sponsor: string;
  officer?: string;
}

export interface SponsorReview {
  sectionService: string;
  hkfcService: string;
  recommendation: string;
  /** A newly drawn signature (PNG data URL); omitted to sign with the saved one. */
  signature?: string;
}

export interface OfficerReview {
  playersAvailable: string;
  optimumPlayers: string;
  isPlayerNeeded: string;
  otherComments: string;
  otherInformation: string;
  recommendedReduction: string;
  signature?: string;
}

export interface ReviewOffice {
  id: string;
  name: string;
  designation: string | null;
}

/** GET /api/reviews/:id. Fields a role may not see are left out, not blanked. */
export interface ReviewView {
  id: string;
  stage: string;
  roles: ReviewRole[];
  /** The step the viewer can do now, if any. */
  canDo: Exclude<ReviewRole, "viewer"> | null;
  member: {
    name: string;
    membershipNo: string | null;
    yearNo: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    team: string | null;
    position: string | null;
    qualifiedUmpire: string | null;
  };
  attendance: {
    matchesPlayed: number | null;
    matchesTeamPlayed: number | null;
    matchesNotAvailable: number | null;
    teamsPlayed: string[];
  };
  report: (Omit<MemberReport, "sponsor" | "officer"> & { submittedAt: string | null }) | null;
  sponsor: { office: string | null; name: string | null };
  officer: { office: string | null; name: string | null };
  sponsorReview: (Omit<SponsorReview, "signature"> & { submittedAt: string | null; signatureUrl: string | null }) | null;
  officerReview: (Omit<OfficerReview, "signature"> & { submittedAt: string | null; signatureUrl: string | null }) | null;
  /** For the member's report: who they can pick, with their usual sponsor first. */
  options?: { sponsors: ReviewOffice[]; officers: ReviewOffice[]; usualSponsor: string | null };
  /** For a signer: their saved signature, to sign with in one tap. */
  savedSignatureUrl?: string | null;
}
