/**
 * Makes and sends the consolidated application (applicationSpec.ts) once
 * the Membership Officer signs a new member's application, the last of the
 * three signatures (applicationSigning.ts): kept on the applicant (files
 * kind 'application_form', like the imported ones) and emailed, with the
 * PDF attached, to the Club's membership office (CLUB_MEMBERSHIP_EMAIL),
 * from the Membership Officer, who gets a copy (owner, 1 Oct 2026: the
 * officer signs, then it goes to the office).
 */
import type { Env } from "../env";
import { db, eq, inList } from "../data/supabase";
import { fileLink } from "../data/supabase/files";
import { sendEmail } from "../mailer";
import { documentFilename, fileAsset, renderPdf, storeDocument, templateAsset, type Asset } from "./render";
import { ASSET, applicationSpec, type Address, type ApplicationFacts, type FamilyPerson, type Signer, type SupportingDocument, type Work } from "./applicationSpec";
import { isUnderEighteen } from "../declarations";
import { BANKS } from "../../../shared/profile";

const PERSON_COLUMNS = [
  "id", "api_id", "salutation", "surname", "given_names", "preferred_name", "chinese_name", "gender", "date_of_birth", "place_of_birth",
  "arrived_in_hk_on", "hkid_no", "passport_no", "nationality", "marital_status", "email", "telephone_no", "mobile_no",
  "home_flat_type", "home_unit", "home_floor", "home_block", "home_building", "home_street", "home_district", "home_region",
  "company_name", "business_flat_type", "business_unit", "business_floor", "business_block", "business_building", "business_street",
  "business_district", "business_region", "work_position", "nature_of_business", "office_telephone_no", "office_email",
  "academic_qualifications", "sports_background", "personal_interest", "category_type", "player_coach", "member_type",
  "billing_channels", "correspondence_channels", "bill_payer", "bank_name", "bank_branch_no", "bank_account_no", "bank_contact_no",
  "bank_payment_limit", "bank_payment_limit_amount", "guardian_bank_account_name", "membership_no", "playing_position",
  "selected_team_sos", "registered_team", "sports_background_sponsor", "training_comments_sponsor", "applicant_level_sponsor",
  "guardian_surname", "guardian_given_names", "guardian_mobile_no", "guardian_email", "shirt_number_id",
  "sponsored_by_sponsor_id", "sponsored_by_chair_id", "sponsored_by_officer_id",
].join(",");

type Row = Record<string, string | number | string[] | null>;

const FAMILY_COLUMNS =
  "id,relation,ordinal,salutation,surname,given_names,chinese_name,gender,date_of_birth,hkid_no,passport_no,nationality,email,mobile_no,wedding_anniversary,company_name,business_flat_type,business_unit,business_floor,business_block,business_building,business_street,business_district,business_region,work_position,nature_of_business,office_email,office_telephone_no";

interface FileRow {
  id: string;
  kind: string;
  family_member_id: string | null;
  content_type: string | null;
  created_at: string;
}

interface ApplicationRow {
  id: string;
  submitted_at: string;
  signature_file_id: string | null;
  spouse_signature_file_id: string | null;
  guardian_signature_file_id: string | null;
  guardian_account_signature_file_id: string | null;
  sponsor_signed_at: string | null;
  sponsor_signature_file_id: string | null;
  chair_signed_at: string | null;
  chair_signature_file_id: string | null;
  officer_signed_at: string | null;
  officer_signature_file_id: string | null;
}

interface OfficeRow {
  id: string;
  designation: string | null;
  office_email: string | null;
  people: { id: string; preferred_name: string | null; given_names: string | null; surname: string | null; email: string | null; membership_no: string | null } | null;
}

const str = (r: Row, k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
const list = (r: Row, k: string) => (Array.isArray(r[k]) ? (r[k] as string[]) : []);
const num = (r: Row, k: string) => (r[k] === null || r[k] === undefined ? null : Number(r[k]));

function address(r: Row, prefix: "home" | "business"): Address {
  return {
    flatType: str(r, `${prefix}_flat_type`),
    unit: str(r, `${prefix}_unit`),
    floor: str(r, `${prefix}_floor`),
    block: str(r, `${prefix}_block`),
    building: str(r, `${prefix}_building`),
    street: str(r, `${prefix}_street`),
    district: str(r, `${prefix}_district`),
    region: str(r, `${prefix}_region`),
  };
}

const work = (r: Row, tel = "office_telephone_no"): Work => ({
  company: str(r, "company_name"),
  address: address(r, "business"),
  position: str(r, "work_position"),
  natureOfBusiness: str(r, "nature_of_business"),
  officeTel: str(r, tel),
  officeEmail: str(r, "office_email"),
});

const familyPerson = (r: Row): FamilyPerson => ({
  salutation: str(r, "salutation"),
  surname: str(r, "surname"),
  givenNames: str(r, "given_names"),
  chineseName: str(r, "chinese_name"),
  gender: str(r, "gender"),
  dateOfBirth: str(r, "date_of_birth"),
  idNumber: str(r, "hkid_no") || str(r, "passport_no"),
  nationality: str(r, "nationality"),
  email: str(r, "email"),
  mobileNo: str(r, "mobile_no"),
});

const holderName = (p: OfficeRow["people"]) => [p?.preferred_name || p?.given_names, p?.surname].filter(Boolean).join(" ");

function signer(o: OfficeRow | undefined, fallback: string, signedAt: string | null): Signer {
  return { name: holderName(o?.people ?? null), designation: o?.designation || fallback, membershipNo: o?.people?.membership_no ?? null, signedAt };
}

/** Uploaded files the club gets as pages: images as they are, PDFs appended; anything else is left out. */
const pageKind = (contentType: string | null): SupportingDocument["kind"] | null =>
  contentType === "image/jpeg" || contentType === "image/png" ? "image" : contentType === "application/pdf" ? "pdf" : null;

export interface MadeApplication {
  fileId: string;
  filename: string;
  /** Uploads that are not images or PDFs, so not in the PDF (by caption). */
  leftOut: string[];
}

/** Gathers everything, renders and keeps the consolidated application. Null when there is no application. */
export async function makeApplicationPdf(env: Env, personApiId: string): Promise<MadeApplication | null> {
  const d = db(env);
  const p = await d.one<Row>("people", `select=${PERSON_COLUMNS}&api_id=${eq(personApiId)}`);
  if (!p) return null;
  const personId = String(p.id);
  const [app, family, relatives, clubs, trials, files] = await Promise.all([
    d.one<ApplicationRow>(
      "applications",
      `select=id,submitted_at,signature_file_id,spouse_signature_file_id,guardian_signature_file_id,guardian_account_signature_file_id,sponsor_signed_at,sponsor_signature_file_id,chair_signed_at,chair_signature_file_id,officer_signed_at,officer_signature_file_id&person_id=${eq(personId)}&order=submitted_at.desc&limit=1`,
    ),
    d.select<Row>("family_members", `select=${FAMILY_COLUMNS}&person_id=${eq(personId)}&order=relation,ordinal`),
    d.select<Row>("relatives", `select=name,membership_no,relationship&person_id=${eq(personId)}&order=ordinal`),
    d.select<Row>("previous_clubs", `select=club,since_year&person_id=${eq(personId)}&order=ordinal`),
    d.select<Row>("applicant_trials", `select=trial_date,participation_types,highest_division&person_id=${eq(personId)}&order=ordinal`),
    d.select<FileRow>(
      "files",
      `select=id,kind,family_member_id,content_type,created_at&person_id=${eq(personId)}&kind=${inList(["photo", "hkid", "passport", "marriage_certificate", "birth_certificate", "signature"])}&order=created_at.desc`,
    ),
  ]);
  if (!app) return null;
  const officeIds = [p.sponsored_by_sponsor_id, p.sponsored_by_chair_id, p.sponsored_by_officer_id].filter((x): x is string => typeof x === "string");
  const offices = officeIds.length
    ? await d.select<OfficeRow>(
        "offices",
        `select=id,designation,office_email,people!offices_person_id_fkey(id,preferred_name,given_names,surname,email,membership_no)&id=${inList(officeIds)}`,
      )
    : [];
  const office = (id: unknown) => offices.find((o) => o.id === id);

  const spouseRow = family.find((f) => f.relation === "spouse") ?? null;
  const childRows = family.filter((f) => f.relation === "child").slice(0, 4);
  /** The newest file of a kind: the applicant's own (no family member), or a family member's. */
  const newest = (kind: string, familyMemberId: string | null = null) =>
    files.find((f) => f.kind === kind && f.family_member_id === familyMemberId) ?? null;

  // The bytes the spec draws, by asset name.
  const assets: Record<string, Asset> = {
    [ASSET.sam]: await templateAsset(env, "sports-associate-application"),
    [ASSET.levy]: await templateAsset(env, "section-membership-levy"),
    [ASSET.pledge]: await templateAsset(env, "commitment-pledge"),
  };
  const images: [string, string | null | undefined][] = [
    [ASSET.photo, newest("photo")?.id],
    [ASSET.signature, app.signature_file_id],
    [ASSET.spouseSignature, app.spouse_signature_file_id],
    [ASSET.spousePhoto, spouseRow ? newest("photo", String(spouseRow.id))?.id : null],
    [ASSET.sponsorSignature, app.sponsor_signature_file_id],
    [ASSET.chairSignature, app.chair_signature_file_id],
    [ASSET.officerSignature, app.officer_signature_file_id],
  ];
  childRows.forEach((c, i) => {
    images.push([ASSET.childPhoto(i + 1), newest("photo", String(c.id))?.id]);
    images.push([ASSET.childSignature(i + 1), newest("signature", String(c.id))?.id]);
  });
  const payer = str(p, "bill_payer");
  const accountSignature =
    payer === "Guardian / Parent" ? app.guardian_account_signature_file_id : payer === "Spouse / Partner" ? app.spouse_signature_file_id : app.signature_file_id;
  images.push([ASSET.accountSignature, accountSignature]);

  const day = app.submitted_at.slice(0, 10);
  const minor = isUnderEighteen(str(p, "date_of_birth"), day);
  if (minor) images.push([ASSET.guardianSignature, app.guardian_signature_file_id]);

  for (const [name, fileId] of images) {
    if (!fileId) continue;
    const a = await fileAsset(env, fileId);
    // Drawn images must be PNG or JPEG; anything else is left off.
    if (a.type === "image/png" || a.type === "image/jpeg") assets[name] = a;
  }

  // Supporting documents, in the checklist's order.
  const leftOut: string[] = [];
  const supporting: SupportingDocument[] = [];
  const addDoc = async (file: FileRow | null, caption: string) => {
    if (!file) return;
    const kind = pageKind(file.content_type);
    if (!kind) {
      leftOut.push(caption);
      return;
    }
    const asset = `doc-${supporting.length + 1}`;
    assets[asset] = await fileAsset(env, file.id);
    supporting.push({ asset, caption, kind });
  };
  const name = [str(p, "preferred_name") || str(p, "given_names"), str(p, "surname")].filter(Boolean).join(" ");
  await addDoc(newest("hkid") ?? newest("passport"), `${name}: ${newest("hkid") ? "HKID" : "passport"}`);
  await addDoc(newest("marriage_certificate"), `${name}: marriage certificate`);
  if (spouseRow) await addDoc(newest("hkid", String(spouseRow.id)), "Spouse / partner: HKID");
  for (const [i, c] of childRows.entries()) {
    await addDoc(newest("birth_certificate", String(c.id)), `Child ${i + 1}: birth certificate`);
    await addDoc(newest("hkid", String(c.id)), `Child ${i + 1}: HKID`);
  }

  const bankName = str(p, "bank_name");
  const accountName =
    payer === "Guardian / Parent"
      ? str(p, "guardian_bank_account_name") ?? ""
      : payer === "Spouse / Partner" && spouseRow
        ? [str(spouseRow, "given_names"), str(spouseRow, "surname")].filter(Boolean).join(" ")
        : [str(p, "given_names"), str(p, "surname")].filter(Boolean).join(" ");
  const shirt = minor && p.shirt_number_id ? await d.one<{ shirt_no: number }>("shirt_numbers", `select=shirt_no&id=${eq(String(p.shirt_number_id))}`) : null;

  const facts: ApplicationFacts = {
    submittedAt: app.submitted_at,
    categoryType: str(p, "category_type"),
    playerCoach: list(p, "player_coach"),
    memberType: str(p, "member_type"),
    membershipNo: str(p, "membership_no"),
    applicant: {
      ...familyPerson(p),
      placeOfBirth: str(p, "place_of_birth"),
      arrivedOn: str(p, "arrived_in_hk_on"),
      maritalStatus: str(p, "marital_status"),
      homeTel: str(p, "telephone_no"),
      home: address(p, "home"),
      work: work(p),
    },
    relatives: relatives.map((r) => ({ name: str(r, "name"), membershipNo: str(r, "membership_no"), relationship: str(r, "relationship") })),
    qualifications: list(p, "academic_qualifications"),
    clubs: clubs.map((c) => ({ club: str(c, "club"), sinceYear: num(c, "since_year") })),
    sportsBackground: str(p, "sports_background"),
    personalInterest: str(p, "personal_interest"),
    billing: list(p, "billing_channels"),
    correspondence: list(p, "correspondence_channels"),
    spouse: spouseRow ? { ...familyPerson(spouseRow), weddingAnniversary: str(spouseRow, "wedding_anniversary"), work: work(spouseRow) } : null,
    children: childRows.map(familyPerson),
    trials: trials.map((t) => ({ date: str(t, "trial_date"), types: list(t, "participation_types"), division: str(t, "highest_division") })),
    team: str(p, "selected_team_sos") || str(p, "registered_team"),
    position: str(p, "playing_position"),
    sponsorAssessment: {
      sportsBackground: str(p, "sports_background_sponsor"),
      trainingComments: str(p, "training_comments_sponsor"),
      level: str(p, "applicant_level_sponsor"),
    },
    sponsor: signer(office(p.sponsored_by_sponsor_id), "Sponsor", app.sponsor_signed_at),
    chair: signer(office(p.sponsored_by_chair_id), "Chairperson", app.chair_signed_at),
    officer: signer(office(p.sponsored_by_officer_id), "Membership Officer", app.officer_signed_at),
    bank: bankName || str(p, "bank_account_no")
      ? {
          payer,
          bankName,
          bankCode: bankName ? BANKS[bankName] ?? null : null,
          branchNo: str(p, "bank_branch_no"),
          accountNo: str(p, "bank_account_no"),
          contactNo: str(p, "bank_contact_no"),
          limit: str(p, "bank_payment_limit"),
          limitAmount: num(p, "bank_payment_limit_amount"),
          accountName,
        }
      : null,
    u18: minor
      ? {
          surname: str(p, "surname") ?? "",
          givenNames: str(p, "given_names") ?? "",
          idNumber: str(p, "hkid_no") || str(p, "passport_no") || "",
          dateOfBirth: str(p, "date_of_birth"),
          nationality: str(p, "nationality") ?? "",
          mobileNo: str(p, "mobile_no") ?? "",
          email: str(p, "email") ?? "",
          team: str(p, "selected_team_sos") || str(p, "registered_team") || "",
          jerseyNo: shirt?.shirt_no ?? null,
          guardianSurname: str(p, "guardian_surname") ?? "",
          guardianGivenNames: str(p, "guardian_given_names") ?? "",
          guardianMobileNo: str(p, "guardian_mobile_no") ?? "",
          guardianEmail: str(p, "guardian_email") ?? "",
          signedAt: app.submitted_at,
        }
      : null,
    assets: Object.keys(assets),
    supporting,
  };
  if (minor) assets[ASSET.u18] = await templateAsset(env, "u18-registration");

  const rendered = await renderPdf(env, applicationSpec(facts), assets);
  if (rendered.warnings.length) console.warn(`Application ${personApiId}: ${rendered.warnings.join("; ")}`);
  const filename = documentFilename("HKFC Membership Application", name);
  const fileId = await storeDocument(env, rendered.pdf, { kind: "application_form", filename, personId });
  return { fileId, filename, leftOut };
}

/** "Name <address>" from CLUB_MEMBERSHIP_EMAIL, as its address. */
const addressOf = (v: string) => v.match(/<([^>]+)>/)?.[1] ?? v.trim();

/**
 * After the Membership Officer signs: makes the PDF and sends it to the
 * Club's membership office in the officer's name, with a copy to them.
 */
export async function sendApplicationToClub(env: Env, personApiId: string): Promise<void> {
  const made = await makeApplicationPdf(env, personApiId);
  if (!made) return;
  const d = db(env);
  const p = await d.one<{ preferred_name: string | null; given_names: string | null; surname: string | null; sponsored_by_officer_id: string | null; sponsored_by_sponsor_id: string | null; sponsored_by_chair_id: string | null }>(
    "people",
    `select=preferred_name,given_names,surname,sponsored_by_officer_id,sponsored_by_sponsor_id,sponsored_by_chair_id&api_id=${eq(personApiId)}`,
  );
  if (!p) return;
  const ids = [p.sponsored_by_officer_id, p.sponsored_by_sponsor_id, p.sponsored_by_chair_id].filter((x): x is string => !!x);
  const offices = ids.length
    ? await d.select<OfficeRow>("offices", `select=id,designation,office_email,people!offices_person_id_fkey(id,preferred_name,given_names,surname,email,membership_no)&id=${inList(ids)}`)
    : [];
  const officer = offices.find((o) => o.id === p.sponsored_by_officer_id);
  const sponsor = offices.find((o) => o.id === p.sponsored_by_sponsor_id);
  const chair = offices.find((o) => o.id === p.sponsored_by_chair_id);
  const to = env.CLUB_MEMBERSHIP_EMAIL;
  if (!to || !officer?.people) {
    console.warn(`Application ${personApiId}: PDF kept, but not sent (${to ? "no Membership Officer" : "CLUB_MEMBERSHIP_EMAIL is not set"})`);
    return;
  }
  const name = [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
  const officerName = holderName(officer.people);
  const officerMailbox = officer.office_email || officer.people.email;
  const text = [
    `Dear ${env.CLUB_MEMBERSHIP_CONTACT || "Membership Services"},`,
    "",
    `Please find attached ${name}'s application for Sports Associate Membership, with their Section Membership Application (Hockey), the Hockey Section Commitment Pledge, and their supporting documents.`,
    "",
    `It has been signed by their sponsor${sponsor?.people ? ` (${holderName(sponsor.people)})` : ""}, the Hockey Section Chairman${chair?.people ? ` (${holderName(chair.people)})` : ""} and me as Membership Officer.`,
    ...(made.leftOut.length ? ["", `Not included because of their file type, so I'll send these separately: ${made.leftOut.join("; ")}.`] : []),
    "",
    "Best regards,",
    officerName,
    `${officer.designation || "Membership Officer"} – HKFC Hockey Section`,
  ].join("\n");
  await sendEmail(env, {
    toPersonId: officer.people.id,
    to: addressOf(to),
    subject: `Sports Associate Membership application: ${name}`,
    text,
    template: "application-to-club",
    // In the officer's name (they get a blind copy); replies go to them.
    from: officerMailbox ? `${officerName} <${officerMailbox}>` : env.REVIEW_EMAIL_FROM || undefined,
    replyTo: officerMailbox ?? undefined,
    attachments: [{ filename: made.filename, path: await fileLink(env, made.fileId) }],
  });
}
