/**
 * The consolidated membership application, as one PDF: the Club's Sports
 * Associate Membership Application (12 pages), the Section Membership
 * (levy) Application, the Hockey Commitment Pledge, HockeyHK's under-18
 * form when the applicant is under 18, and the supporting documents. It
 * replaces the four Fillout PDFs, SPAM Page 7 and the Make scenario's
 * iLovePDF merge and "Supporting Documents" zip.
 *
 * Pure: facts in, a RenderSpec out (application.ts gathers the facts and
 * the files). The Sports Associate form and the levy form are fillable;
 * the pledge, the Direct Debit Authorisation (page 10) and page 5's photo
 * go at measured positions. Fields "for office use only" stay blank, and
 * so does the Direct Debit's payment limit, which the club pre-fills.
 */
import type { DocumentPart, ImageItem, RenderSpec, TextItem } from "./render";
import { PDF_TEMPLATES } from "./templates";
import { ddmmyyyy } from "./playerStatement";
import { u18Spec, type U18Facts } from "./u18Registration";
import { ageOn } from "../../../shared/application";

export interface Address {
  flatType: string | null;
  unit: string | null;
  floor: string | null;
  block: string | null;
  building: string | null;
  street: string | null;
  district: string | null;
  region: string | null;
}

export interface Work {
  company: string | null;
  address: Address;
  position: string | null;
  natureOfBusiness: string | null;
  officeTel: string | null;
  officeEmail: string | null;
}

export interface FamilyPerson {
  salutation: string | null;
  surname: string | null;
  givenNames: string | null;
  chineseName: string | null;
  /** Spouse: Male / Female. Child: M / F. */
  gender: string | null;
  dateOfBirth: string | null;
  /** HKID, else passport. */
  idNumber: string | null;
  nationality: string | null;
  email: string | null;
  mobileNo: string | null;
}

export interface Spouse extends FamilyPerson {
  weddingAnniversary: string | null;
  work: Work;
}

export interface Signer {
  name: string;
  designation: string;
  membershipNo: string | null;
  signedAt: string | null;
}

export interface Bank {
  payer: string | null;
  bankName: string | null;
  bankCode: string | null;
  branchNo: string | null;
  accountNo: string | null;
  contactNo: string | null;
  limit: string | null;
  limitAmount: number | null;
  /** The name(s) on the account: the bill payer's. */
  accountName: string;
}

export interface SupportingDocument {
  asset: string;
  caption: string;
  kind: "image" | "pdf";
}

export interface ApplicationFacts {
  /** ISO timestamp the applicant submitted. */
  submittedAt: string;
  categoryType: string | null;
  playerCoach: string[];
  memberType: string | null;
  membershipNo: string | null;
  applicant: FamilyPerson & {
    placeOfBirth: string | null;
    arrivedOn: string | null;
    maritalStatus: string | null;
    homeTel: string | null;
    home: Address;
    work: Work;
  };
  relatives: { name: string | null; membershipNo: string | null; relationship: string | null }[];
  qualifications: string[];
  clubs: { club: string | null; sinceYear: number | null }[];
  sportsBackground: string | null;
  personalInterest: string | null;
  billing: string[];
  correspondence: string[];
  spouse: Spouse | null;
  children: FamilyPerson[];
  trials: { date: string | null; types: string[]; division: string | null }[];
  team: string | null;
  position: string | null;
  sponsorAssessment: { sportsBackground: string | null; trainingComments: string | null; level: string | null };
  sponsor: Signer;
  chair: Signer;
  officer: Signer;
  bank: Bank | null;
  /** Under 18 on the day they submitted: the U18 form goes in, from these. */
  u18: U18Facts | null;
  /** Names of the assets that exist (photos and signatures, by the ASSET names below). */
  assets: string[];
  supporting: SupportingDocument[];
}

/** Asset names the spec refers to; application.ts supplies the bytes. */
export const ASSET = {
  sam: "sam",
  levy: "levy",
  pledge: "pledge",
  u18: "u18",
  photo: "photo-applicant",
  spousePhoto: "photo-spouse",
  childPhoto: (n: number) => `photo-child-${n}`,
  signature: "signature-applicant",
  spouseSignature: "signature-spouse",
  childSignature: (n: number) => `signature-child-${n}`,
  sponsorSignature: "signature-sponsor",
  chairSignature: "signature-chair",
  officerSignature: "signature-officer",
  accountSignature: "signature-account",
  guardianSignature: "guardian-signature",
} as const;

const s = (v: string | null | undefined) => (v ?? "").trim();
const fullName = (p: { givenNames: string | null; surname: string | null }) => [s(p.givenNames), s(p.surname)].filter(Boolean).join(" ");

/** mm/yyyy. */
export function mmyyyy(value: string | null): string {
  const m = /^(\d{4})-(\d{2})/.exec(value ?? "");
  return m ? `${m[2]}/${m[1]}` : "";
}

/** Splits text into lines of at most the given character counts, by word; the last line takes the rest. */
export function wrap(text: string | null, widths: number[]): string[] {
  const words = s(text).replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = widths.map(() => "");
  let i = 0;
  for (const word of words) {
    const next = lines[i] ? `${lines[i]} ${word}` : word;
    if (next.length > widths[i] && lines[i] && i < widths.length - 1) {
      i++;
      lines[i] = word;
    } else {
      lines[i] = next;
    }
  }
  return lines;
}

/** Characters that fit a line of a field this many points wide (Helvetica at about 9 pt). */
const chars = (points: number) => Math.floor(points / 4.4);

const unitOf = (a: Address) => [s(a.flatType), s(a.unit)].filter(Boolean).join(" ");
const districtOf = (a: Address) => [s(a.district), s(a.region)].filter(Boolean).join(", ");

const CATEGORY_FIELD: Record<string, string> = {
  "Sports Preferred": "Sports Preferred",
  "Sports Debenture": "Sports Debenture",
  "Sports Subscriber": "Sports Subscriber",
  "Junior (21-27)": "Junior (21-27)",
  "Junior (under 21)": "Junior under 21",
};

const QUALIFICATION_FIELD: Record<string, string> = {
  Secondary: "Secondary",
  "Diploma / Certificate / Associate Degree": "toggle_2",
  "Bachelor's Degree": "Bachelors Degree",
  "Post-Graduate / Master's Degree": "PostGraduate  Masters Degree",
  "Doctorate / PHD / Post-Doctorate": "Doctorate  PHD  PostDoctorate",
  Other: "Others_2",
};

/** Billing and correspondence ticks (page 3), by channel. */
const BILLING_FIELD: Record<string, string> = {
  "Personal Email": "Main Cardholder Personal Email",
  "Office Email": "toggle_11",
  "Spouse Personal Email": "Spouse  Partner Personal Email",
  "Spouse Office Email": "toggle_12",
};
const CORRESPONDENCE_FIELD: Record<string, string> = {
  "Personal Email": "Main Cardholder Personal Email_2",
  "Office Email": "toggle_15",
  "Spouse Personal Email": "Spouse  Partner Personal Email_2",
  "Spouse Office Email": "toggle_16",
};

const SALUTATIONS = ["Mr", "Mrs", "Ms", "Miss", "Professor", "Dr"];

function samFields(f: ApplicationFacts): Record<string, string | boolean> {
  const a = f.applicant;
  const day = f.submittedAt.slice(0, 10);
  const signed = ddmmyyyy(f.submittedAt);
  const fields: Record<string, string | boolean> = {};
  const put = (name: string, value: string | null | undefined) => {
    if (s(value)) fields[name] = s(value);
  };
  const tick = (name: string, on: boolean) => {
    if (on) fields[name] = true;
  };

  // Page 1: the checklist.
  tick("Duly completed all sections on application form by applicant", true);
  tick("Sections Designated Sports Association DSA Societies must complete attendance record and signed as", !!f.sponsor.signedAt);
  tick("Copies of Hong Kong Identity Cards for the principal applicant spouse applicant and children applicants", f.supporting.some((d) => /HKID|passport/i.test(d.caption)));
  tick("Copy of Marriage Cert", f.supporting.some((d) => /marriage/i.test(d.caption)));
  tick("Copy of Birth Cert", f.supporting.some((d) => /birth/i.test(d.caption)));
  tick("Fill in Pledge Form and original handwritten signed copy Direct Debit Authorisation Form", true);
  tick("Two passportsize photos of the principal applicant one passport size photo of the spous applicant", f.assets.includes(ASSET.photo));

  // Page 2: A. category, B. member details.
  tick("Hockey", true);
  const category = CATEGORY_FIELD[s(f.categoryType)];
  if (category) tick(category, true);
  tick("Player", f.playerCoach.includes("Player"));
  tick("Coach", f.playerCoach.includes("Coach"));
  if (SALUTATIONS.includes(s(a.salutation))) fields.salutation = s(a.salutation);
  put("Principal Member Surname", a.surname);
  put("Principal Member Given Name", a.givenNames);
  put("Principal Member Chinese Name", a.chineseName);
  put("Principal Member DOB", ddmmyyyy(a.dateOfBirth));
  if (a.dateOfBirth) put("Principal Member Age", String(ageOn(a.dateOfBirth, day)));
  tick("Male", a.gender === "Male");
  tick("Female", a.gender === "Female");
  tick("Married", a.maritalStatus === "Married");
  tick("Single", a.maritalStatus === "Single");
  tick("Partner", a.maritalStatus === "Partner");
  put("Principal Member Place of Birth", a.placeOfBirth);
  put("Principle Member Arrival Date", mmyyyy(a.arrivedOn));
  put("Principal Member ID/Passport", a.idNumber);
  put("Principal Member Nationality", a.nationality);
  put("Principal Member Home", unitOf(a.home));
  put("Principal Member Home Flat", a.home.floor);
  put("Principal Member Home Block", a.home.block);
  put("Principal Member Home Building", a.home.building);
  put("Principal Member Home Street", a.home.street);
  put("Principal Member Home District", districtOf(a.home));
  put("Principal Member Home Tel", a.homeTel);
  put("Principal Member Home Mobile", a.mobileNo);
  put("Principal Member Personal Email", a.email);
  put("Principal Member Company", a.work.company);
  put("Principal Member Office", unitOf(a.work.address));
  put("Principal Member Office Floor", a.work.address.floor);
  put("Principal Member Office Block", a.work.address.block);
  put("Principal Member Office Building", a.work.address.building);
  put("Principal Member Office Street", a.work.address.street);
  put("Principal Member Office District", districtOf(a.work.address));
  put("Principal Member Office Position", a.work.position);
  put("Principal Member Business Nature", a.work.natureOfBusiness);
  put("Principal Member Office Tel", a.work.officeTel);
  put("Principal Member Office Email", a.work.officeEmail);

  // Page 3: relatives, qualifications, clubs, background, channels.
  f.relatives.slice(0, 3).forEach((r, i) => {
    put(`Close Relatives Member Name ${i + 1}`, r.name);
    put(`Close Relatives Member No ${i + 1}`, r.membershipNo);
    put(`Close Relatives Member Relationship ${i + 1}`, r.relationship);
  });
  for (const q of f.qualifications) if (QUALIFICATION_FIELD[q]) tick(QUALIFICATION_FIELD[q], true);
  f.clubs.slice(0, 4).forEach((c, i) => {
    put(`Name of Private Club ${i + 1}`, c.club);
    put(`Year From Private Club ${i + 1}`, c.sinceYear ? String(c.sinceYear) : null);
  });
  wrap(f.sportsBackground, [chars(382), chars(382), chars(382)]).forEach((line, i) => put(`Sports Background ${i + 1}`, line));
  wrap(f.personalInterest, [chars(382), chars(382), chars(382)]).forEach((line, i) => put(`Personal Interest ${i + 1}`, line));
  for (const c of f.billing) if (BILLING_FIELD[c]) tick(BILLING_FIELD[c], true);
  for (const c of f.correspondence) if (CORRESPONDENCE_FIELD[c]) tick(CORRESPONDENCE_FIELD[c], true);

  // Page 4: C. spouse, D. children.
  const sp = f.spouse;
  if (sp) {
    if (SALUTATIONS.includes(s(sp.salutation))) fields.salutation_2 = `${s(sp.salutation)}_2`;
    put("Spouse Surname", sp.surname);
    put("Spouse Given Name", sp.givenNames);
    put("Spouse Chinese Name", sp.chineseName);
    put("Spouse DOB", ddmmyyyy(sp.dateOfBirth));
    if (sp.dateOfBirth) put("Spouse Age", String(ageOn(sp.dateOfBirth, day)));
    if (sp.gender === "Male" || sp.gender === "Female") fields.Gender = `${sp.gender}_2`;
    put("Spouse Wedding Anniversary", ddmmyyyy(sp.weddingAnniversary));
    put("Spouse ID/Passport", sp.idNumber);
    put("Spouse Nationality", sp.nationality);
    put("Spouse Personal Email", sp.email);
    put("Spouse Mobile", sp.mobileNo);
    put("Spouse Company", sp.work.company);
    put("Spouse Office", unitOf(sp.work.address));
    put("Spouse Office Floor", sp.work.address.floor);
    put("Spouse Office Block", sp.work.address.block);
    put("Spouse Office Building", sp.work.address.building);
    put("Spouse Office Street", sp.work.address.street);
    put("Spouse Office District", districtOf(sp.work.address));
    put("Spouse Position", sp.work.position);
    put("Spouse Business Nature", sp.work.natureOfBusiness);
    put("Spouse Office Tel", sp.work.officeTel);
    put("Spouse Office Email", sp.work.officeEmail);
  }
  f.children.slice(0, 4).forEach((c, i) => {
    const n = i + 1;
    put(`Children ${n} Surname`, c.surname);
    put(`Children ${n} Given Name`, c.givenNames);
    put(`Children ${n} DOB`, ddmmyyyy(c.dateOfBirth));
    put(`Children ${n} Gender`, c.gender);
    put(`Children ${n} ID/Passport`, c.idNumber);
  });

  // Page 5: signature dates (the photos and signatures are images).
  if (f.assets.includes(ASSET.signature)) put("Principal Member's Signature Date", signed);
  if (sp && f.assets.includes(ASSET.spouseSignature)) put("Spouse's Signature Date 1", signed);

  // Page 6: F. commitment pledge (the extension block below stays blank).
  put("Applicant Name", fullName(a));
  put("Membership No", f.membershipNo);
  if (f.assets.includes(ASSET.signature)) put("Applicant Signature Date 1", signed);

  // Page 7: G. the sponsor's (Team Captain / Coach) record, and the committee.
  const [first, ...later] = f.trials;
  const yes = (t: { types: string[] }, type: string) => (t.types.includes(type) ? "Yes" : "");
  if (first) {
    put("First Attendance Date", ddmmyyyy(first.date));
    put("First Training 1", yes(first, "Training"));
    put("First Coaching 1", yes(first, "Coaching"));
    put("First Playing", first.types.includes("Playing") ? s(first.division) || "Yes" : "");
  }
  later.slice(0, 4).forEach((t, i) => {
    const n = i + 1;
    put(`Sub Attendance Date ${n}`, ddmmyyyy(t.date));
    put(`Sub Training ${n}`, yes(t, "Training"));
    put(`Sub Coaching ${n}`, yes(t, "Coaching"));
    put(`Sub Playing ${n}`, t.types.includes("Playing") ? s(t.division) || "Yes" : "");
  });
  put("Applicant Team", f.team);
  put("Applicant Position", f.position);
  wrap(f.sponsorAssessment.sportsBackground, [chars(364), chars(364), chars(364)]).forEach((line, i) => put(`Applicant Achievement ${i + 1}`, line));
  wrap(f.sponsorAssessment.trainingComments, [chars(256), chars(510), chars(510)]).forEach((line, i) =>
    put(`Comments on the applicants training  coaching  playing section ${i + 1}`, line),
  );
  put("Level", f.sponsorAssessment.level);
  put("Captain/Coach Name", f.sponsor.name);
  put("Designation", f.sponsor.designation);
  put("Captain/Coach Membership No", f.sponsor.membershipNo);
  put("Captain/Coach Sign Date", ddmmyyyy(f.sponsor.signedAt));
  put("Section Member Name 1", f.chair.name);
  put("Section Member Designation 1", f.chair.designation);
  put("Section Member Membership No 1", f.chair.membershipNo);
  put("Section Member Signature Date 1", ddmmyyyy(f.chair.signedAt));
  put("Section Member Name 2", f.officer.name);
  put("Section Member Designation 2", f.officer.designation);
  put("Section Member Membership No 2", f.officer.membershipNo);
  put("Section Member Signature Date 2", ddmmyyyy(f.officer.signedAt));

  // Page 8: H. applicant agreement (office use stays blank).
  if (f.assets.includes(ASSET.signature)) put("Applicant Signatute Date 3", signed);
  if (sp && f.assets.includes(ASSET.spouseSignature)) put("Spouse Signature Date 2", signed);
  return fields;
}

function samFieldImages(f: ApplicationFacts): Record<string, string> {
  const images: Record<string, string> = {};
  const add = (field: string, asset: string) => {
    if (f.assets.includes(asset)) images[field] = asset;
  };
  add("Principal Member's Photo_af_image", ASSET.photo);
  add("Sponse's Photo", ASSET.spousePhoto);
  add("Principal Member's Signature", ASSET.signature);
  add("Signature of the Spouse 1", ASSET.spouseSignature);
  add("Signature of the Applicant 1", ASSET.signature);
  add("Signature of the Applicant 3", ASSET.signature);
  add("Signature of the Spouse 2", ASSET.spouseSignature);
  for (let n = 1; n <= 4; n++) {
    add(`Children ${n} Photo`, ASSET.childPhoto(n));
    add(`${n} Childs Specimen Signature`, ASSET.childSignature(n));
  }
  add("Captain/Coach Signature", ASSET.sponsorSignature);
  add("Section Member Signature 1", ASSET.chairSignature);
  add("Section Member Signature 2", ASSET.officerSignature);
  return images;
}

/** Page 10, HSBC's Direct Debit Authorisation: a flat scan, so text at measured positions. */
function directDebit(f: ApplicationFacts): { text: TextItem[]; images: ImageItem[] } {
  const b = f.bank;
  if (!b) return { text: [], images: [] };
  const text: TextItem[] = [];
  const at = (x: number, y: number, value: string | null | undefined, maxWidth?: number, size = 9) => {
    if (s(value)) text.push({ page: 10, x, y, text: s(value), maxWidth, size });
  };
  /** One character per box, centred on each box's middle. */
  const boxes = (value: string | null, first: number, step: number, count: number, y: number, size = 10) => {
    const v = s(value).replace(/[\s-]/g, "");
    if (!v) return;
    if (v.length > count) return at(first - step / 2 + 1, y, v, step * count - 2, size);
    [...v].forEach((ch, i) => text.push({ page: 10, x: first + i * step - 2.8, y, text: ch, size }));
  };
  const dateDigits = ddmmyyyy(f.submittedAt).replace(/\//g, "");
  boxes(dateDigits, 428.5, 17.1, 8, 803);
  at(50, 581, [s(b.bankName), s(b.branchNo) ? `branch ${s(b.branchNo)}` : ""].filter(Boolean).join(", "), 205);
  boxes(b.bankCode, 281.8, 13.7, 3, 581);
  boxes(b.branchNo, 357.5, 13, 3, 581);
  boxes(b.accountNo, 436, 13, 9, 581);
  at(50, 551.5, b.accountName.toUpperCase(), 490);
  at(50, 521, b.contactNo || f.applicant.mobileNo, 110);
  const h = f.applicant.home;
  const line1 = [unitOf(h), s(h.floor) && `${s(h.floor)}/F`, s(h.block) && `Block ${s(h.block)}`, s(h.building)].filter(Boolean).join(", ");
  const line2 = [s(h.street), districtOf(h)].filter(Boolean).join(", ");
  at(50, 457, line1, 490);
  at(50, 443, line2, 490);
  at(277, 397, s(f.membershipNo) || fullName(f.applicant).toUpperCase(), 225);
  const images: ImageItem[] = f.assets.includes(ASSET.accountSignature)
    ? [{ page: 10, x: 50, y: 102, width: 237, height: 27, asset: ASSET.accountSignature }]
    : [];
  return { text, images };
}

function levyPart(f: ApplicationFacts): DocumentPart {
  const a = f.applicant;
  const member = s(f.memberType) || "Main";
  const fields: Record<string, string | boolean> = {
    "Member Name": fullName(a),
    "Contact Tel No": s(a.mobileNo),
    "Email Address": s(a.email),
    "Hockey Section 70month": true,
    Main: member === "Main",
    Spouse: member === "Spouse",
    Child: member === "Child",
    Partner: member === "Partner",
  };
  if (s(f.membershipNo)) fields["Member No"] = s(f.membershipNo);
  if (f.assets.includes(ASSET.signature)) fields.Date = ddmmyyyy(f.submittedAt);
  return {
    kind: "template",
    asset: ASSET.levy,
    fields,
    fieldImages: f.assets.includes(ASSET.signature) ? { Signature: ASSET.signature } : undefined,
  };
}

/** The Hockey Section's Commitment Pledge (2026.04): signed, named and dated on page 2. */
function pledgePart(f: ApplicationFacts): DocumentPart {
  const signedIt = f.assets.includes(ASSET.signature);
  return {
    kind: "template",
    asset: ASSET.pledge,
    text: [
      { page: 2, x: 114, y: 136, text: fullName(f.applicant), maxWidth: 196, size: 10 },
      ...(signedIt ? [{ page: 2, x: 114, y: 111, text: ddmmyyyy(f.submittedAt), size: 10 }] : []),
    ],
    images: signedIt ? [{ page: 2, x: 114, y: 158, width: 196, height: 26, asset: ASSET.signature }] : [],
  };
}

/** An existing HKFC member's Section Membership Application (levy), on its own, for the front desk. */
export function levySpec(f: ApplicationFacts): RenderSpec {
  return { title: `${PDF_TEMPLATES["section-membership-levy"].title}: ${fullName(f.applicant)}`, parts: [levyPart(f)] };
}

export function applicationSpec(f: ApplicationFacts): RenderSpec {
  const dd = directDebit(f);
  const parts: DocumentPart[] = [
    {
      kind: "template",
      asset: ASSET.sam,
      fields: samFields(f),
      fieldImages: samFieldImages(f),
      text: dd.text,
      // Page 5's photo box for the applicant has no field (page 2's has).
      images: [...(f.assets.includes(ASSET.photo) ? [{ page: 5, x: 112, y: 394, width: 113, height: 141, asset: ASSET.photo }] : []), ...dd.images],
    },
    levyPart(f),
    pledgePart(f),
  ];
  if (f.u18) {
    const u18 = u18Spec(f.u18).parts[0];
    if (u18.kind === "template") parts.push({ ...u18, asset: ASSET.u18 });
  }
  for (const d of f.supporting) parts.push({ kind: d.kind, asset: d.asset, caption: d.caption });
  return { title: `${PDF_TEMPLATES["sports-associate-application"].title}: ${fullName(f.applicant)}`, parts };
}
