/**
 * The personal-details questions shared by the member details update and the
 * new joiner (applicant) form, as data: each question's People column, its
 * choices and rules. The Worker validates against it and the screens are
 * drawn from it, so the two can't disagree.
 *
 * Who is asked what (an Audience): members; applicants who are existing
 * HKFC members; applicants who are new HKFC members. The applicants' rules
 * follow the Fillout form's own visibility settings.
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
import { joinPhone, normaliseHkid, phoneProblem, splitPhone } from "./phone";

export type FieldType = "text" | "email" | "phone" | "date" | "select" | "multi" | "suggest" | "textarea" | "number" | "yesno" | "hkid";

/** Who is answering: a member, or an applicant who is an existing or a new HKFC member. */
export type Audience = "member" | "existing" | "new";
export const APPLICANTS: Audience[] = ["existing", "new"];

export interface FieldSpec {
  key: string;
  /** The People column. */
  column: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  /** Options in labelled groups (districts by region); `options` is then every one of them. */
  groups?: readonly { label: string; options: readonly string[] }[];
  /** Required of everyone asked (true), or only of these. */
  required?: boolean | Audience[];
  hint?: string;
  /** Who is asked; everyone when absent. */
  audiences?: Audience[];
}

export type SectionKey = "application" | "personal" | "emergency" | "contact" | "work" | "guardian" | "hockey" | "background" | "billing";

export interface SectionSpec {
  key: SectionKey;
  title: string;
  intro?: string;
  fields: FieldSpec[];
  /** Shown only to under-18s. */
  underEighteenOnly?: boolean;
  /** Who is asked; everyone when absent. */
  audiences?: Audience[];
}

export const isRequired = (f: FieldSpec, who: Audience) => f.required === true || (Array.isArray(f.required) && f.required.includes(who));

/** A person's audience from their People record. */
export function audienceOf(status: string | null, applicantType: string | null): Audience {
  if (status !== "Applicant") return "member";
  return applicantType === "Existing HKFC Member" ? "existing" : "new";
}

export const NATIONALITIES = [
  "American", "Argentinian", "Australian", "Belgian", "British", "Canadian", "Chinese / Hong Kong", "Dutch", "Finnish", "French",
  "German", "Indian", "Irish", "Japanese", "Korean", "Malaysian", "New Zealander", "Pakistani", "Singaporean", "South African", "Swiss",
] as const;

/** Districts by the region they're in (Hong Kong Island is "Hong Kong" in the address). */
export const DISTRICT_GROUPS = [
  {
    label: "Hong Kong Island",
    region: "Hong Kong",
    options: [
      "Aberdeen", "Admiralty", "Ap Lei Chau", "Braemar Hill", "Causeway Bay", "Central", "Chai Wan", "Eastern", "Happy Valley",
      "Jardine's Lookout", "Kennedy Town", "Mid-Levels", "North Point", "Pokfulam", "Quarry Bay", "Sai Ying Pun", "Shau Kei Wan",
      "Shek O", "Sheung Wan", "Southern", "Stanley", "Taikoo Shing", "Tin Hau", "Wan Chai",
    ],
  },
  {
    label: "Kowloon",
    region: "Kowloon",
    options: [
      "Ho Man Tin", "Hung Hom", "Kowloon Bay", "Kowloon City", "Kowloon Tong", "Kwun Tong", "Sham Shui Po", "Tai Kok Tsui",
      "Tsim Sha Tsui", "Tsz Wan Shan", "West Kowloon", "Yau Tsim Mong",
    ],
  },
  {
    label: "New Territories and Islands",
    region: "New Territories",
    options: [
      "Clear Water Bay", "Discovery Bay", "Kwai Chung", "Ma On Shan", "Sai Kung", "Shatin", "Sheung Shui", "Tai Po", "Tai Wai",
      "Tin Shui Wai", "Tsing Yi", "Tsuen Wan", "Tuen Mun", "Yuen Long",
    ],
  },
] as const;

export const HK_DISTRICTS: readonly string[] = DISTRICT_GROUPS.flatMap((g) => g.options);

/** The region a district is in, for filling it in when the district is chosen. */
export const regionOfDistrict = (district: string) => DISTRICT_GROUPS.find((g) => (g.options as readonly string[]).includes(district))?.region ?? null;

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

/** An address; `required` lists who must give its main parts (applicants, for the home address). */
const address = (prefix: "home" | "business", label: string, flatTypes: readonly string[], required?: Audience[]): FieldSpec[] => [
  { key: `${prefix}FlatType`, column: `${prefix}_flat_type`, label: `${label}: flat, room, apartment…`, type: "select", options: flatTypes, required },
  { key: `${prefix}Unit`, column: `${prefix}_unit`, label: "Letter / number / reference", type: "text", required },
  { key: `${prefix}Floor`, column: `${prefix}_floor`, label: "Floor", type: "text" },
  { key: `${prefix}Block`, column: `${prefix}_block`, label: "Block", type: "text" },
  { key: `${prefix}Building`, column: `${prefix}_building`, label: "Building", type: "text" },
  { key: `${prefix}Street`, column: `${prefix}_street`, label: "Street", type: "text", required },
  { key: `${prefix}District`, column: `${prefix}_district`, label: "District", type: "suggest", options: HK_DISTRICTS, groups: DISTRICT_GROUPS, required },
  { key: `${prefix}Region`, column: `${prefix}_region`, label: "Region", type: "select", options: REGIONS, required },
];

export const PROFILE_SECTIONS: SectionSpec[] = [
  {
    key: "application",
    title: "Your application",
    audiences: APPLICANTS,
    fields: [
      {
        key: "applicantType",
        column: "applicant_type",
        label: "Type of application",
        type: "select",
        options: ["Existing HKFC Member", "New HKFC Member"],
        required: true,
        hint: "Child or Junior Associate members switching to a Junior or Sports Preferred membership apply as a New HKFC Member.",
      },
      { key: "membershipNo", column: "membership_no", label: "Your HKFC membership no.", type: "text", required: true, audiences: ["existing"] },
      {
        key: "memberType",
        column: "member_type",
        label: "Member type",
        type: "select",
        options: ["Main", "Spouse", "Child", "Partner"],
        required: true,
        audiences: ["existing"],
        hint: "Main only if you're the primary member.",
      },
      {
        key: "categoryType",
        column: "category_type",
        label: "Membership category",
        type: "select",
        options: ["Sports Preferred", "Junior (21-27)", "Junior (under 21)", "Sports Debenture", "Sports Subscriber"],
        required: true,
      },
      { key: "playerCoach", column: "player_coach", label: "Joining as", type: "multi", options: ["Player", "Coach"], required: true, audiences: ["new"] },
      { key: "billingChannels", column: "billing_channels", label: "Send club bills to", type: "multi", options: CHANNELS, required: true, audiences: ["new"] },
      { key: "correspondenceChannels", column: "correspondence_channels", label: "Send club letters to", type: "multi", options: CHANNELS, required: true, audiences: ["new"] },
    ],
  },
  {
    key: "personal",
    title: "Personal details",
    fields: [
      { key: "salutation", column: "salutation", label: "Title", type: "select", options: ["Mr", "Mrs", "Ms", "Miss", "Dr", "Professor"], audiences: ["new"] },
      { key: "surname", column: "surname", label: "Surname", type: "text", required: true },
      { key: "givenNames", column: "given_names", label: "Given name(s)", type: "text", required: true, hint: "As on your HKID or passport." },
      { key: "preferredName", column: "preferred_name", label: "Preferred name", type: "text", required: true, hint: "What the app and your teammates call you." },
      { key: "chineseName", column: "chinese_name", label: "Chinese name", type: "text" },
      { key: "dateOfBirth", column: "date_of_birth", label: "Date of birth", type: "date", required: true },
      { key: "gender", column: "gender", label: "Gender", type: "select", options: ["Male", "Female"], required: true },
      { key: "hkidNo", column: "hkid_no", label: "HKID no.", type: "hkid", required: true, hint: "As on the card, with the digit in brackets: A123456(7)" },
      { key: "passportNo", column: "passport_no", label: "Passport no.", type: "text" },
      { key: "nationality", column: "nationality", label: "Nationality", type: "suggest", options: NATIONALITIES, required: true },
      { key: "maritalStatus", column: "marital_status", label: "Marital status", type: "select", options: ["Single", "Married", "Partner"], audiences: APPLICANTS, required: true },
      { key: "placeOfBirth", column: "place_of_birth", label: "Place of birth", type: "text", audiences: ["new"], required: true },
      { key: "arrivedInHkOn", column: "arrived_in_hk_on", label: "Date of arrival in Hong Kong", type: "date", audiences: ["new"], required: true },
      {
        key: "academicQualifications",
        column: "academic_qualifications",
        label: "Academic qualifications",
        type: "multi",
        options: ["Secondary", "Diploma / Certificate / Associate Degree", "Bachelor's Degree", "Post-Graduate / Master's Degree", "Doctorate / PHD / Post-Doctorate", "Other"],
        audiences: ["new"],
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
      ...address("home", "Home address", ["Flat", "Room", "Apartment", "Suite", "House"], APPLICANTS),
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
      { key: "active", column: "active", label: "Will you be an active member this season?", type: "yesno", required: true, audiences: ["member"] },
      { key: "playingPosition", column: "playing_position", label: "Playing position", type: "select", options: ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible/Varies"], required: true },
      {
        key: "playingLevel",
        column: "playing_level",
        label: "Levels you've played at",
        type: "multi",
        options: ["Premier League", "Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Division 6"],
        required: APPLICANTS,
      },
      { key: "selectionComments", column: "selection_comments", label: "Selection comments and coach/S&C requests", type: "textarea", audiences: ["member"] },
      { key: "improvementIdeas", column: "improvement_ideas", label: "Feedback and ideas", type: "textarea", audiences: ["member"] },
    ],
  },
  {
    key: "background",
    title: "About you",
    intro: "This is for your sponsor and the club. Tell us about your hockey career and the other sports you've been involved with, and what you and your family enjoy.",
    audiences: ["new"],
    fields: [
      { key: "sportsBackground", column: "sports_background", label: "Sports background and involvement", type: "textarea", required: true },
      { key: "personalInterest", column: "personal_interest", label: "Personal and family interests", type: "textarea", required: true },
    ],
  },
  {
    key: "billing",
    title: "Bank and billing",
    intro: "For the club's direct debit of your monthly account, on your Sports Associate membership forms.",
    // New joiners who are new HKFC members (owner, 2026-10-01; the Fillout form's rule).
    audiences: ["new"],
    fields: [
      { key: "billPayer", column: "bill_payer", label: "Who pays the club account?", type: "select", options: ["Applicant", "Spouse / Partner", "Guardian / Parent"] },
      { key: "bankName", column: "bank_name", label: "Bank", type: "select", options: Object.keys(BANKS) },
      { key: "bankBranchNo", column: "bank_branch_no", label: "Branch no.", type: "text", required: true },
      { key: "bankAccountNo", column: "bank_account_no", label: "Account no.", type: "text", required: true },
      { key: "bankContactNo", column: "bank_contact_no", label: "Contact no. for the bank", type: "phone" },
      { key: "bankPaymentLimit", column: "bank_payment_limit", label: "Payment limit", type: "select", options: ["Unlimited", "Each Payment", "Each Month"], required: true },
      { key: "bankPaymentLimitAmount", column: "bank_payment_limit_amount", label: "Limit amount (HK$)", type: "number", hint: "Unless the limit is Unlimited." },
      { key: "guardianBankAccountName", column: "guardian_bank_account_name", label: "Parent or guardian's name on the account", type: "text", hint: "If a parent or guardian pays." },
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

/** Whether a section is asked of this audience. */
export const sectionFor = (section: SectionSpec, who: Audience) => !section.audiences || section.audiences.includes(who);

/** The fields a person answers in a section. */
export function fieldsFor(section: SectionSpec, who: Audience): FieldSpec[] {
  return section.fields.filter((f) => !f.audiences || f.audiences.includes(who));
}

/** Rules across fields that the field list can't say on its own. */
export function sectionProblem(key: SectionKey, v: ProfileValues): string | null {
  if (key === "billing") {
    const amount = v.bankPaymentLimitAmount;
    if (v.bankPaymentLimit && v.bankPaymentLimit !== "Unlimited" && (amount === null || amount === undefined || amount === "")) {
      return "Give the limit amount.";
    }
    if (v.billPayer === "Guardian / Parent" && !(typeof v.guardianBankAccountName === "string" && v.guardianBankAccountName.trim())) {
      return "Give the parent or guardian's name on the account.";
    }
  }
  return null;
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
  /** Which questions they're asked. */
  audience: Audience;
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
export function checkValue(f: FieldSpec, v: unknown, who: Audience = "member"): string | null {
  const required = isRequired(f, who);
  if (f.type === "yesno") {
    if (v === true || v === false) return null;
    return required ? `${f.label} Choose yes or no.` : null;
  }
  if (f.type === "number") {
    if (v === null || v === undefined || v === "") return required ? `${f.label} is needed.` : null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e10 ? null : `${f.label}: that isn't a number.`;
  }
  if (f.type === "multi") {
    if (v !== undefined && v !== null && !Array.isArray(v)) return `${f.label}: choose from the list.`;
    const list = (v ?? []) as unknown[];
    if (list.some((x) => typeof x !== "string" || !f.options!.includes(x))) return `${f.label}: choose from the list.`;
    if (required && list.length === 0) return `${f.label} is needed.`;
    return null;
  }
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : null;
  if (s === null) return `${f.label}: that isn't a valid answer.`;
  if (!s) return required ? `${f.label} is needed.` : null;
  if (s.length > (f.type === "textarea" ? 2000 : 200)) return `${f.label} is too long.`;
  if (f.type === "select" && !f.options!.includes(s)) return `${f.label}: choose from the list.`;
  if (f.type === "email" && !/^\S+@\S+\.\S+$/.test(s)) return `${f.label}: that doesn't look like an email address.`;
  if (f.type === "phone") {
    const problem = phoneProblem(s);
    if (problem) return `${f.label}: ${problem}.`;
  }
  if (f.type === "hkid" && !normaliseHkid(s)) return `${f.label}: check the number and the digit in brackets, e.g. A123456(7).`;
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${f.label}: that isn't a date.`;
  return null;
}

/** Whether they've confirmed their details since this season began (1 July, Hong Kong time). */
export function checkedThisSeason(checkedAt: string | null, day: string): boolean {
  return !!checkedAt && hkDateKey(checkedAt) >= `${seasonStartYear(day)}-07-01`;
}

/** An answer as stored: HKID numbers written A123456(7), phone numbers "+852 9123 4567". */
export function normaliseValue(f: FieldSpec, v: string): string {
  if (f.type === "hkid") return normaliseHkid(v) ?? v;
  if (f.type === "phone") {
    const { code, number } = splitPhone(v);
    return joinPhone(code, number) || v;
  }
  return v;
}

/**
 * An address the way Hong Kong Post writes it, one line per part, from the
 * fields of a home or business address:
 *   Flat B, 12/F, Block 3
 *   Example Court
 *   1 Sample Road
 *   Mid-Levels, Hong Kong
 */
export function formatHkAddress(v: ProfileValues, prefix: "home" | "business"): string[] {
  const get = (k: string) => {
    const x = v[`${prefix}${k}`];
    return typeof x === "string" ? x.trim() : "";
  };
  const unit = get("Unit");
  const flat = unit ? `${get("FlatType") || "Flat"} ${unit}` : "";
  const floorRaw = get("Floor");
  const floor = !floorRaw ? "" : /^g$/i.test(floorRaw) ? "G/F" : /\/F$|floor$/i.test(floorRaw) ? floorRaw : `${floorRaw.replace(/\s*F$/i, "")}/F`;
  const blockRaw = get("Block");
  const block = !blockRaw ? "" : /^(block|tower|house|phase)\b/i.test(blockRaw) ? blockRaw : `Block ${blockRaw}`;
  return [
    [flat, floor, block].filter(Boolean).join(", "),
    get("Building"),
    get("Street"),
    [get("District"), get("Region")].filter(Boolean).join(", "),
  ].filter(Boolean);
}
