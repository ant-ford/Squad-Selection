/**
 * The sponsor, Chairman and Membership Officer signing a new HKFC member's
 * application (worker/src/applicationSigning.ts, replacing Fillout forms 4
 * and 5). They sign in that order (owner, 2026-10-01): the sponsor gives
 * their support, the Chairman reviews it, and the Membership Officer signs
 * last and sends the application to the Club's membership office.
 */
import { JOINER_POSITIONS, JOINER_TEAMS } from "./joiners";

export type SignRole = "sponsor" | "chair" | "officer";
export const SIGN_ROLES: SignRole[] = ["sponsor", "chair", "officer"];
export const ROLE_LABEL: Record<SignRole, string> = { sponsor: "Sponsor", chair: "Chairman", officer: "Membership Officer" };

/** Whose turn it is to sign, by the applicant's stage. */
export const TURN_BY_STAGE: Record<string, SignRole> = {
  "3. Club Application (Signed)": "sponsor",
  "4. Sponsor (Signed)": "chair",
  "5. Chairman (Signed)": "officer",
};

/** The Fillout form's choices for "the applicant presently has the ability to play/coach at…". */
export const SPONSOR_LEVELS = ["Premier League", "Division 1", "Division 2", "Division 3", "Division 4", "Division 5"] as const;

/** The sponsor's assessment, written to People with their signature. */
export interface SponsorAnswers {
  playingPosition: string;
  team: string;
  sportsBackground: string;
  trainingComments: string;
  level: string;
}

export function sponsorProblem(a: SponsorAnswers): string | null {
  if (!(JOINER_POSITIONS as readonly string[]).includes(a.playingPosition)) return "Choose their playing position.";
  if (!(JOINER_TEAMS as readonly string[]).includes(a.team)) return "Choose the team they'd play in.";
  if (!a.sportsBackground.trim()) return "Give their sports background and achievements.";
  if (a.sportsBackground.length > 2000) return "The sports background is too long.";
  if (!a.trainingComments.trim()) return "Comment on their training, coaching or playing.";
  if (a.trainingComments.length > 2000) return "The comments are too long.";
  if (!(SPONSOR_LEVELS as readonly string[]).includes(a.level)) return "Choose the level they can play at.";
  return null;
}

export interface SignatureState {
  /** Who holds the office this application names, if anyone. */
  name: string | null;
  signedAt: string | null;
  signatureUrl: string | null;
}

/** GET /api/applications/:id/sign. */
export interface SigningView {
  id: string;
  name: string;
  photoUrl: string | null;
  applicationType: string;
  categoryType: string | null;
  submittedAt: string;
  stage: string | null;
  applicant: {
    sportsBackground: string | null;
    personalInterest: string | null;
    participationDetails: string | null;
    playingLevel: string[];
    playingPosition: string | null;
    registeredTeam: string | null;
    selectedTeamSos: string | null;
    trials: { date: string | null; types: string[]; highestDivision: string | null }[];
    clubs: { club: string; sinceYear: number | null }[];
  };
  /** The sponsor's assessment once they've signed. */
  sponsorAssessment: { sportsBackground: string | null; trainingComments: string | null; level: string | null } | null;
  signatures: Record<SignRole, SignatureState>;
  /** The roles the signed-in person holds on this application. */
  myRoles: SignRole[];
  /** The AI drafts for the sponsor, once made. */
  drafts: { sportsBackground: string | null; trainingComments: string | null };
  savedSignatureUrl: string | null;
  /**
   * Once the application is ready to go on (a new member's signed by all
   * three, an existing member's submitted): the PDF to check and where it
   * goes. The Membership Officer checks it, then sends it.
   */
  sending?: ApplicationSending;
}

export interface ApplicationSending {
  /** The PDF, or null while it is being made. */
  pdfUrl: string | null;
  /** What it is: the whole application, or an existing member's levy form. */
  document: "application" | "levy";
  /** "the Club's membership office" / "the front desk", and its address. */
  recipient: string;
  to: string | null;
  sentAt: string | null;
  sentBy: string | null;
  sentTo: string | null;
  /** The viewer may make it again and send it (a Membership Officer). */
  canSend: boolean;
}
