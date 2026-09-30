/**
 * The personal-details questions shared by the member details update and the
 * new joiner (applicant) form, as data: each question's People column, its
 * choices and rules. The Worker validates against it and the screens are
 * drawn from it, so the two can't disagree.
 *
 * Owner decisions, 2026-10-01: one set of sections for both forms;
 * members check them one section per screen at the start of each season;
 * membership fields (type, category, number, dates) are officers' and shown
 * read-only; the sign-in email isn't changed here.
 *
 * Choices are stored as the Airtable forms' words, so the answers already
 * given carry on. Nationality and district suggest the usual answers but
 * take any, because the Airtable lists have duplicates and typos.
 */

import { hkDateKey } from "./hkDateKey";
import { seasonStartYear } from "./membershipInsights";

export type FieldType = "text" | "email" | "phone" | "date" | "select" | "multi" | "suggest" | "textarea";

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
}

export type SectionKey = "personal" | "emergency" | "contact" | "work" | "guardian";

export interface SectionSpec {
  key: SectionKey;
  title: string;
  intro?: string;
  fields: FieldSpec[];
  /** Shown only to under-18s. */
  underEighteenOnly?: boolean;
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

/** The fields a person answers in a section: applicant-only ones for applicants alone. */
export function fieldsFor(section: SectionSpec, applicant: boolean): FieldSpec[] {
  return section.fields.filter((f) => applicant || !f.applicantOnly);
}

export type ProfileValues = Record<string, string | string[] | null>;

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
