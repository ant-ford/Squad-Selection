/**
 * The personal-details questions shared by the member details update and the
 * new joiner (applicant) form, as data: each question's People column, its
 * choices and rules. The Worker validates against it and the screens are
 * drawn from it, so the two can't disagree.
 *
 * Owner decisions, 2026-10-01: one set of sections for both forms;
 * members check them one section per screen at the start of each season;
 * bank and billing details are asked of new joiners only;
 * membership fields (type, category, number, dates) are officers' and shown
 * read-only; the sign-in email isn't changed here.
 *
 * Choices are stored as the Airtable forms' words, so the answers already
 * given carry on. Nationality and district suggest the usual answers but
 * take any, because the Airtable lists have duplicates and typos.
 */

import { hkDateKey } from "./hkDateKey";
import { seasonStartYear } from "./membershipInsights";

export type FieldType = "text" | "email" | "phone" | "date" | "select" | "multi" | "suggest" | "textarea" | "number" | "yesno";

export interface FieldSpec {
  key: string;
  /** The People column. */
  column: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  required?: boolean;
  hint?: string;
  /** Asked of applicants only (the club application needs it). */
  applicantOnly?: boolean;
  /** Asked of members only. */
  memberOnly?: boolean;
}

export type SectionKey = "personal" | "emergency" | "contact" | "work" | "guardian" | "hockey" | "billing";

export interface SectionSpec {
  key: SectionKey;
  title: string;
  intro?: string;
  fields: FieldSpec[];
  /** Shown only to under-18s. */
  underEighteenOnly?: boolean;
  /** Asked of new joiners (applicants) only. */
  applicantOnly?: boolean;
}

export const NATIONALITIES = [
  "American", "Argentinian", "Australian", "Belgian", "British", "Canadian", "Chinese / Hong Kong", "Dutch", "Finnish", "French",
  "German", "Indian", "Irish", "Japanese", "Korean", "Malaysian", "New Zealander", "Pakistani", "Singaporean", "South African", "Swiss",
] as const;

export const HK_DISTRICTS = [
  "Aberdeen", "Admiralty", "Ap Lei Chau", "Braemar Hill", "Causeway Bay", "Central", "Chai Wan", "Clear Water Bay", "Discovery Bay",
  "Eastern", "Happy Valley", "Ho Man Tin", "Hung Hom", "Jardine's Lookout", "Kennedy Town", "Kowloon Bay", "Kowloon City",
  "Kowloon Tong", "Kwai Chung", "Kwun Tong", "Ma On Shan", "Mid-Levels", "North Point", "Pokfulam", "Quarry Bay", "Sai Kung",
  "Sai Ying Pun", "Sham Shui Po", "Shatin", "Shau Kei Wan", "Shek O", "Sheung Shui", "Sheung Wan", "Southern", "Stanley",
  "Tai Kok Tsui", "Tai Po", "Tai Wai", "Taikoo Shing", "Tin Hau", "Tin Shui Wai", "Tsim Sha Tsui", "Tsing Yi", "Tsuen Wan",
  "Tsz Wan Shan", "Tuen Mun", "Wan Chai", "West Kowloon", "Yau Tsim Mong", "Yuen Long",
] as const;

export const REGIONS = ["Hong Kong", "Kowloon", "New Territories"] as const;

/** Hong Kong banks and their bank codes (the Airtable form's list). */
export const BANKS: Record<string, string> = {
  "Airstar Bank": "395", "Ant Bank (Hong Kong)": "393", "Bank of China (Hong Kong)": "012", "Bank of Communications (Hong Kong)": "382",
  "China CITIC Bank International": "018", "China Construction Bank (Asia)": "009", "Chiyu Banking Corporation": "039", "Chong Hing Bank": "041",
  "Citibank (Hong Kong)": "250", "Citibank, N.A.": "006", "CMB Wing Lung Bank": "020", "Credit Agricole Corporate and Investment Bank": "005",
  "Dah Sing Bank": "040", "DBS Bank (Hong Kong)": "016", "Fubon Bank (Hong Kong)": "128", "Fusion Bank": "391", "Hang Seng Bank": "024",
  HSBC: "004", "Industrial and Commercial Bank of China (Asia)": "072", "JPMorgan Chase Bank, N.A.": "007", "Livi Bank": "388", "Mox Bank": "389",
  "Nanyang Commercial Bank": "043", "OCBC Wing Hang Bank": "035", "Ping An OneConnect Bank (PAO Bank)": "392", "Public Bank (Hong Kong)": "028",
  "Shanghai Commercial Bank": "025", "Standard Chartered Bank (Hong Kong) Limited": "003", "Tai Yau Bank": "038", "The Bank of East Asia": "015",
  "WeLab Bank": "390", "ZA Bank": "387",
};

const CHANNELS = ["Personal Email", "Office Email", "Spouse Personal Email", "Spouse Office Email"] as const;

const address = (prefix: "home" | "business", label: string, flatTypes: readonly string[]): FieldSpec[] => [
  { key: `${prefix}FlatType`, column: `${prefix}_flat_type`, label: `${label}: flat, room, apartment…`, type: "select", options: flatTypes },
  { key: `${prefix}Unit`, column: `${prefix}_unit`, label: "Letter / number / reference", type: "text" },
  { key: `${prefix}Floor`, column: `${prefix}_floor`, label: "Floor", type: "text" },
  { key: `${prefix}Block`, column: `${prefix}_block`, label: "Block", type: "text" },
  { key: `${prefix}Building`, column: `${prefix}_building`, label: "Building", type: "text" },
  { key: `${prefix}Street`, column: `${prefix}_street`, label: "Street", type: "text" },
  { key: `${prefix}District`, column: `${prefix}_district`, label: "District", type: "suggest", options: HK_DISTRICTS },
  { key: `${prefix}Region`, column: `${prefix}_region`, label: "Region", type: "select", options: REGIONS },
];

export const PROFILE_SECTIONS: SectionSpec[] = [
  {
    key: "personal",
    title: "Personal details",
    fields: [
      { key: "salutation", column: "salutation", label: "Title", type: "select", options: ["Mr", "Mrs", "Ms", "Miss", "Dr", "Professor"], applicantOnly: true },
      { key: "surname", column: "surname", label: "Surname", type: "text", required: true },
      { key: "givenNames", column: "given_names", label: "Given name(s)", type: "text", required: true, hint: "As on your HKID or passport." },
      { key: "preferredName", column: "preferred_name", label: "Preferred name", type: "text", required: true, hint: "What the app and your teammates call you." },
      { key: "chineseName", column: "chinese_name", label: "Chinese name", type: "text" },
      { key: "dateOfBirth", column: "date_of_birth", label: "Date of birth", type: "date", required: true },
      { key: "gender", column: "gender", label: "Gender", type: "select", options: ["Male", "Female"], required: true },
      { key: "hkidNo", column: "hkid_no", label: "HKID no.", type: "text", required: true, hint: "e.g. A123456(7)" },
      { key: "passportNo", column: "passport_no", label: "Passport no.", type: "text" },
      { key: "nationality", column: "nationality", label: "Nationality", type: "suggest", options: NATIONALITIES, required: true },
      { key: "placeOfBirth", column: "place_of_birth", label: "Place of birth", type: "text", applicantOnly: true },
      { key: "maritalStatus", column: "marital_status", label: "Marital status", type: "select", options: ["Single", "Married", "Partner"], applicantOnly: true },
      { key: "arrivedInHkOn", column: "arrived_in_hk_on", label: "Date of arrival in Hong Kong", type: "date", applicantOnly: true },
      {
        key: "academicQualifications",
        column: "academic_qualifications",
        label: "Academic qualifications",
        type: "multi",
        options: ["Secondary", "Diploma / Certificate / Associate Degree", "Bachelor's Degree", "Post-Graduate / Master's Degree", "Doctorate / PHD / Post-Doctorate", "Other"],
        applicantOnly: true,
      },
      {
        key: "aeTraining",
        column: "ae_training",
        label: "First aid or A&E training",
        type: "select",
        options: ["Yes, I work in the medical field", "Yes, I have basic A&E knowledge or first aid training", "No, I do not have medical training"],
        applicantOnly: true,
      },
    ],
  },
  {
    key: "emergency",
    title: "Emergency contact",
    fields: [
      { key: "emergencyContact", column: "emergency_contact", label: "Emergency contact person", type: "text", required: true },
      { key: "emergencyContactNo", column: "emergency_contact_no", label: "Their phone no.", type: "phone", required: true },
      { key: "medicalConditions", column: "medical_conditions", label: "Medical conditions (if any)", type: "textarea", hint: "Anything a first-aider should know." },
    ],
  },
  {
    key: "contact",
    title: "Contact details",
    fields: [
      { key: "mobileNo", column: "mobile_no", label: "Mobile no. (WhatsApp)", type: "phone", required: true },
      { key: "telephoneNo", column: "telephone_no", label: "Home telephone no.", type: "phone" },
      ...address("home", "Home address", ["Flat", "Room", "Apartment", "Suite", "House"]),
    ],
  },
  {
    key: "work",
    title: "Work",
    intro: "Optional. The club's forms ask for it.",
    fields: [
      { key: "companyName", column: "company_name", label: "Company", type: "text" },
      { key: "workPosition", column: "work_position", label: "Position", type: "text" },
      { key: "natureOfBusiness", column: "nature_of_business", label: "Nature of business", type: "text" },
      { key: "officeEmail", column: "office_email", label: "Office email", type: "email" },
      { key: "officeTelephoneNo", column: "office_telephone_no", label: "Office telephone no.", type: "phone" },
      ...address("business", "Business address", ["Flat", "Room", "Apartment", "Suite"]),
    ],
  },
  {
    key: "hockey",
    title: "Your hockey this season",
    fields: [
      { key: "active", column: "active", label: "Will you be an active member this season?", type: "yesno", required: true, memberOnly: true },
      { key: "playingPosition", column: "playing_position", label: "Playing position", type: "select", options: ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible/Varies"], required: true },
      {
        key: "playingLevel",
        column: "playing_level",
        label: "Levels you've played at",
        type: "multi",
        options: ["Premier League", "Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Division 6"],
      },
      { key: "selectionComments", column: "selection_comments", label: "Selection comments and coach/S&C requests", type: "textarea", memberOnly: true },
      { key: "improvementIdeas", column: "improvement_ideas", label: "Feedback and ideas", type: "textarea", memberOnly: true },
    ],
  },
  {
    key: "billing",
    title: "Bank and billing",
    intro: "For the club's direct debit of your monthly account, on your Sports Associate membership forms.",
    // New joiners only (owner, 2026-10-01): used once, for their associate membership forms.
    applicantOnly: true,
    fields: [
      { key: "billPayer", column: "bill_payer", label: "Who pays the club account?", type: "select", options: ["Applicant", "Spouse / Partner", "Guardian / Parent"] },
      { key: "bankName", column: "bank_name", label: "Bank", type: "select", options: Object.keys(BANKS) },
      { key: "bankBranchNo", column: "bank_branch_no", label: "Branch no.", type: "text" },
      { key: "bankAccountNo", column: "bank_account_no", label: "Account no.", type: "text" },
      { key: "bankContactNo", column: "bank_contact_no", label: "Contact no. for the bank", type: "phone" },
      { key: "bankPaymentLimit", column: "bank_payment_limit", label: "Payment limit", type: "select", options: ["Unlimited", "Each Payment", "Each Month"] },
      { key: "bankPaymentLimitAmount", column: "bank_payment_limit_amount", label: "Limit amount (HK$)", type: "number", hint: "Unless the limit is Unlimited." },
      { key: "guardianBankAccountName", column: "guardian_bank_account_name", label: "Parent or guardian's name on the account", type: "text", hint: "If a parent or guardian pays." },
      { key: "billingChannels", column: "billing_channels", label: "Send bills to", type: "multi", options: CHANNELS },
      { key: "correspondenceChannels", column: "correspondence_channels", label: "Send club letters to", type: "multi", options: CHANNELS },
    ],
  },
  {
    key: "guardian",
    title: "Parent or guardian",
    intro: "You're under 18, so we need a parent or guardian's contact details.",
    underEighteenOnly: true,
    fields: [
      { key: "guardianSurname", column: "guardian_surname", label: "Surname", type: "text", required: true },
      { key: "guardianGivenNames", column: "guardian_given_names", label: "Given name(s)", type: "text", required: true },
      { key: "guardianEmail", column: "guardian_email", label: "Email", type: "email", required: true },
      { key: "guardianMobileNo", column: "guardian_mobile_no", label: "Mobile no.", type: "phone", required: true },
    ],
  },
];

/** The fields a person answers in a section: applicant-only ones for applicants, member-only ones for members. */
export function fieldsFor(section: SectionSpec, applicant: boolean): FieldSpec[] {
  return section.fields.filter((f) => (applicant ? !f.memberOnly : !f.applicantOnly));
}

export type ProfileValues = Record<string, string | string[] | boolean | null>;

/** The officers' membership fields, shown read-only to members. */
export interface MembershipFacts {
  memberType: string | null;
  categoryType: string | null;
  playerCoach: string[];
  membershipNo: string | null;
  joinDate: string | null;
  commitmentEndDate: string | null;
}

/** Kit sizes in the details form: the current supplier's. */
export interface DetailsKit {
  supplier: string;
  sizes: { shirt: string | null; shorts: string | null; socks: string | null; goalieSmock: string | null; goalieSmockStyle: string | null };
  /** Their number's shirt is printed, so its size can't change here. */
  printedShirt: { shirtNo: number; size: string | null } | null;
  goalkeeper: boolean;
}

/** GET /api/details/me. */
export interface MyDetails {
  season: string;
  applicant: boolean;
  underEighteen: boolean;
  /** The sign-in email; changing it goes through the Membership Officer. */
  email: string | null;
  values: ProfileValues;
  membership: MembershipFacts;
  /** A signed link to their current photo, if any. */
  photoUrl: string | null;
  hasHkidCopy: boolean;
  kit: DetailsKit | null;
  /** When they last confirmed their details (the start-of-season check). */
  checkedAt: string | null;
}

/** Loose checks, the same in the browser and the Worker. */
export function checkValue(f: FieldSpec, v: unknown): string | null {
  if (f.type === "yesno") {
    if (v === true || v === false) return null;
    return f.required ? `${f.label} Choose yes or no.` : null;
  }
  if (f.type === "number") {
    if (v === null || v === undefined || v === "") return f.required ? `${f.label} is needed.` : null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e10 ? null : `${f.label}: that isn't a number.`;
  }
  if (f.type === "multi") {
    if (v !== undefined && v !== null && !Array.isArray(v)) return `${f.label}: choose from the list.`;
    const list = (v ?? []) as unknown[];
    if (list.some((x) => typeof x !== "string" || !f.options!.includes(x))) return `${f.label}: choose from the list.`;
    if (f.required && list.length === 0) return `${f.label} is needed.`;
    return null;
  }
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : null;
  if (s === null) return `${f.label}: that isn't a valid answer.`;
  if (!s) return f.required ? `${f.label} is needed.` : null;
  if (s.length > (f.type === "textarea" ? 2000 : 200)) return `${f.label} is too long.`;
  if (f.type === "select" && !f.options!.includes(s)) return `${f.label}: choose from the list.`;
  if (f.type === "email" && !/^\S+@\S+\.\S+$/.test(s)) return `${f.label}: that doesn't look like an email address.`;
  if (f.type === "phone" && !/^\+?[\d\s()-]{6,24}$/.test(s)) return `${f.label}: that doesn't look like a phone number.`;
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${f.label}: that isn't a date.`;
  return null;
}

/** Whether they've confirmed their details since this season began (1 July, Hong Kong time). */
export function checkedThisSeason(checkedAt: string | null, day: string): boolean {
  return !!checkedAt && hkDateKey(checkedAt) >= `${seasonStartYear(day)}-07-01`;
}
