/**
 * The new joiner (applicant) form's own parts, beyond the shared details
 * sections (shared/profile.ts): family, private clubs, trials attended, the
 * agreements and signatures. Which applicant is asked what follows the
 * Fillout form's visibility settings (read 2026-10-01): new HKFC members give
 * clubs, trials and bank details and agree to the commitment pledge and the
 * Sports Associate terms; existing HKFC members agree to the hockey section's
 * notes; everyone gives family and close relatives and signs.
 *
 * The agreement wording is the Fillout form's, unchanged. Changing it means a
 * new APPLICATION_VERSION: each application records the version agreed to.
 */
import type { Audience } from "./profile";
import { normaliseHkid, phoneProblem } from "./phone";

export const APPLICATION_VERSION = "2026-10-01";

export const PRIVATE_CLUBS = [
  "Aberdeen Marina Club", "American Club", "China Club", "Clearwater Bay Golf and Country Club", "Foreign Correspondents' Club",
  "Hong Kong Club", "Hong Kong Country Club", "Hong Kong Cricket Club", "Hong Kong Jockey Club", "Kowloon Cricket Club",
  "Ladies Recreational Club", "Royal Hong Kong Yacht Club", "Marylebone Cricket Club", "Club zur Vahr (Bremen,Germany)",
] as const;
export const TRIAL_TYPES = ["Training", "Coaching", "Playing"] as const;
export const TRIAL_DIVISIONS = ["Premier League", "Division 1", "Division 2", "Division 3", "Division 4", "Division 5"] as const;
export const RELATIONSHIPS = ["Parent", "Brother", "Sister", "In-Law", "Child"] as const;
export const MAX_CHILDREN = 4;
export const MAX_RELATIVES = 3;
export const MAX_CLUBS = 4;
export const MAX_TRIALS = 5;

/** HKFC's own documents shown with the agreements (public/docs; from the owner, 2026-10-01). */
export const AGREEMENT_PDFS = {
  samTerms: "/docs/hkfc-sports-associate-membership-terms.pdf",
  pledge: "/docs/hkfc-hockey-commitment-pledge-2026-04.pdf",
} as const;

/**
 * The New Members Info Sheet the invitation links to (the Make scenario
 * attached it from Google Drive). Null until the club gives Eddy a copy;
 * the invitation then leaves the line out.
 */
export const NEW_MEMBERS_INFO_SHEET: string | null = null;

export interface AgreementItem {
  key: string;
  title: string;
  /** Paragraphs; {name} is the applicant's full name. */
  text: string[];
  tick: string;
  audiences: Audience[];
  pdf?: keyof typeof AGREEMENT_PDFS;
}

export const AGREEMENTS: AgreementItem[] = [
  {
    key: "commitment_pledge",
    title: "Commitment pledge",
    audiences: ["new"],
    pdf: "pledge",
    text: [
      "I, {name}, acknowledge that I have been accepted by the Club for a category of preferred Membership upon being proposed by a Section, a Designated Sports Activity or the Sports & Recreation Sub-committee (as the case may be) and that my commitment to the Club is an essential feature of preferred Membership, the details of which and the various procedures which I must follow being set out in Parts I & II of the Guidance Notes and Terms and Conditions in the PDF viewer below, which I have read, understood and retained.",
      "I confirm that I accept the period of commitment applicable to me set out in Paragraph 3 of Part I and the Terms and Conditions relating to my commitment set out in Paragraphs 6, 7, 9, 11, 19 and 21 of Parts I & II which are relevant to my category of preferred Membership (or such as shall be applicable, together with the attached Key Performance Indicator as to my commitment, if I am in the category of ‘Special’ Sports Preferred Associate).",
      "In particular, I understand that, (unless I am in the category of ‘Special’ Sports Preferred Associate with a defined alternative commitment), throughout my period of commitment, I must regularly participate in the activities (both sporting and social) of my preferring Section, Designated Sports Activity or Recreational Sporting Body and utilise the Club’s facilities, especially the Food & Beverage outlets (at which I must maintain a mandatory Food and Beverage (F&B) minimum spend).",
      "If the performance of my commitment is found by the General Committee to be inadequate in any respect, without good reason (as determined by the General Committee), I accept that I shall be deemed to be in breach of the matters set out in Article 3.8 of the Articles of Association and my Membership may be terminated in accordance with Article 3.8.",
    ],
    tick: "I understand and accept the terms and period of commitment applicable to me.",
  },
  {
    key: "sam_terms",
    title: "Applicant agreement",
    audiences: ["new"],
    pdf: "samTerms",
    text: [
      "I (\"Applicant\") wish to apply as a Sports Associate Member of The Hong Kong Football Club (\"the Club\"). In support of my application:",
      "I (\"Applicant\") confirm that I have read, understood and retained Section J \"Guidance Notes and Terms and Conditions\" of this Application Form and that I accept the Terms and Conditions set out in the relevant PART thereof, and of any amendments thereto set out from time to time in the Club's Articles of Association, and Bye-laws or Policy Statements of Hong Kong Football Club.",
      "I (\"Applicant\") declare that the above information is accurate, true and not misleading and agree to submit to the Club any documents to support the application.",
      "I (\"Applicant\") acknowledge that making false statements may lead to my / our application being rejected or membership granted being withdrawn.",
      "I (\"Applicant\") confirm that I / We have not been convicted of any criminal offence.",
      "I (\"Applicant\") confirm that I / We have not been bankrupt or served with a bankruptcy petition or equivalent.",
      "I (\"Applicant\") agree to pay the prevailing entrance fee for admission to membership and the monthly subscriptions and other fees as determined by the General Committee.",
      "I (\"Applicant\") understand and accept that any entrance fee and monthly subscription fee paid is not refundable, not transferable and cannot convert to the payment of any membership categories.",
      "I (\"Applicant\") confirm that the bank details on the Direct Debit Authorisation are true and accurate.",
      "I (\"Applicant\") acknowledge that applications will only proceed after all the Sections on the application form are duly completed with all the required documents provided.",
    ],
    tick: "I confirm that I have read and understood the above.",
  },
  {
    key: "hockey_notes",
    title: "Application to join hockey",
    audiences: ["existing"],
    text: [
      "Member’s application to join any Section/DSA/Society is subject to the approval by the respective Section/DSA/Society. Levy will automatically be applied to your Club account once your application is approved. Member should notify the respective Section/DSA/Society in writing one month in advance if he/she wants to resign.",
      "A full month/year levy will be charged upon approval of application. No pro-rata levy will be applied unless specified.",
      "There will be “no refund” of any levy charged upon resignation.",
      "The levy rate stated below is valid since 1 Jun 2025 but it is subject to change by the respective Section/DSA/Society from time to time.",
    ],
    tick: "I confirm that I have read and understood the above “Important Notes”.",
  },
];

/** The under-18's parent or guardian consent box (its wording is the waivers', shared/declarations.ts). */
export const GUARDIAN_CONSENT_KEY = "guardian_consent";

/** The boxes this applicant must tick. */
export function requiredTicks(who: Audience, underEighteen: boolean): string[] {
  return [...AGREEMENTS.filter((a) => a.audiences.includes(who)).map((a) => a.key), ...(underEighteen ? [GUARDIAN_CONSENT_KEY] : [])];
}

export interface FamilyMemberDetails {
  /** Set once saved; uploads and signatures attach to it. */
  id?: string;
  salutation?: string | null;
  surname: string;
  givenNames: string;
  chineseName?: string | null;
  dateOfBirth: string;
  gender: string;
  hkidNo?: string | null;
  passportNo?: string | null;
  nationality?: string | null;
  email?: string | null;
  mobileNo?: string | null;
  weddingAnniversary?: string | null;
  companyName?: string | null;
  workPosition?: string | null;
  natureOfBusiness?: string | null;
  officeEmail?: string | null;
  officeTelephoneNo?: string | null;
}

export interface Relative {
  name: string;
  membershipNo: string;
  relationship: string;
}

export interface PrivateClub {
  club: string;
  sinceYear: number | null;
}

export interface TrialAttended {
  date: string;
  types: string[];
  division: string;
}

/** Which files a family member has on file. */
export interface FamilyFiles {
  photo: boolean;
  hkid: boolean;
  birthCertificate: boolean;
}

/** GET /api/apply/me. */
export interface ApplyView {
  stage: string | null;
  submittedAt: string | null;
  spouse: (FamilyMemberDetails & { files: FamilyFiles }) | null;
  children: (FamilyMemberDetails & { files: FamilyFiles })[];
  relatives: Relative[];
  clubs: PrivateClub[];
  trials: TrialAttended[];
  participationDetails: string | null;
  hasMarriageCertificate: boolean;
}

/** Age in whole years on a day (YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const blank = (v: unknown) => !(typeof v === "string" && v.trim());
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** What's missing from a spouse's details (the Fillout form's required questions); null when complete. */
export function spouseProblem(s: FamilyMemberDetails): string | null {
  if (blank(s.surname) || blank(s.givenNames)) return "Give your spouse or partner's names.";
  if (!isDate(s.dateOfBirth)) return "Give your spouse or partner's date of birth.";
  if (!["Male", "Female"].includes(s.gender)) return "Give your spouse or partner's gender.";
  if (blank(s.salutation)) return "Give your spouse or partner's title.";
  if (blank(s.hkidNo) || !normaliseHkid(String(s.hkidNo))) return "Check your spouse or partner's HKID no., e.g. A123456(7).";
  if (blank(s.nationality)) return "Give your spouse or partner's nationality.";
  if (blank(s.email) || !/^\S+@\S+\.\S+$/.test(String(s.email))) return "Give your spouse or partner's email.";
  if (blank(s.mobileNo) || phoneProblem(String(s.mobileNo))) return "Check your spouse or partner's mobile no.";
  return null;
}

export function childProblem(c: FamilyMemberDetails, n: number): string | null {
  if (blank(c.surname) || blank(c.givenNames)) return `Give child ${n}'s names.`;
  if (!isDate(c.dateOfBirth)) return `Give child ${n}'s date of birth.`;
  if (!["M", "F"].includes(c.gender)) return `Give child ${n}'s gender.`;
  return null;
}

export function relativeProblem(r: Relative, n: number): string | null {
  if (blank(r.name) || blank(r.membershipNo)) return `Give relative ${n}'s name and membership no.`;
  if (!(RELATIONSHIPS as readonly string[]).includes(r.relationship)) return `Choose relative ${n}'s relationship.`;
  return null;
}

export function trialProblem(t: TrialAttended, n: number): string | null {
  if (!isDate(t.date)) return `Give the date of trial ${n}.`;
  if (!t.types.length || t.types.some((x) => !(TRIAL_TYPES as readonly string[]).includes(x))) return `Say how you took part in trial ${n}.`;
  if (!(TRIAL_DIVISIONS as readonly string[]).includes(t.division)) return `Give the highest division at trial ${n}.`;
  return null;
}

/**
 * Children's documents the Fillout form required: a photo and a birth
 * certificate for every child, their HKID from 18 to 26, and their own
 * signature over 10.
 */
export const childNeedsHkid = (dob: string, day: string) => {
  const a = ageOn(dob, day);
  return a >= 18 && a <= 26;
};
export const childSigns = (dob: string, day: string) => ageOn(dob, day) > 10;
