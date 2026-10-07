/**
 * An application's PDF, made when it is ready and sent once the Membership
 * Officer has checked it (owner, 2 Oct 2026: check, then send):
 *
 *  - a new HKFC member: the consolidated application (applicationSpec.ts),
 *    made when the Membership Officer signs, the last of the three
 *    signatures, for the Club's membership office (CLUB_MEMBERSHIP_EMAIL);
 *  - an existing HKFC member: their Section Membership (levy) form, made
 *    when they submit, for the front desk (FRONT_DESK_EMAIL). Sending it
 *    accepts them, as the Make scenario did.
 *
 * The PDF is kept on the applicant (files kind 'application_form' or
 * 'section_membership_form', like the imported ones) and recorded on the
 * application (applications.pdf_file_id); sending records sent_at, sent_by
 * and sent_to. The email goes in the officer's name, with a copy to them.
 */
import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { invalidatePeople } from "../invalidation";
import { people as peopleData } from "../data/people";
import { recordMembershipEvent } from "../membership";
import { ACCEPTED_STAGE } from "../../../shared/membershipStages";
import { db, eq, inList } from "../data/supabase";
import { fileLink } from "../data/supabase/files";
import { sendEmail } from "../mailer";
import { officeAddress, senderFor } from "../officeContacts";
import { documentFilename, fileAssets, renderPdf, storeDocument, templateAsset, type Asset } from "./render";
import { ASSET, applicationSpec, levySpec, type Address, type ApplicationFacts, type FamilyPerson, type Signer, type SupportingDocument, type Work } from "./applicationSpec";
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
  application_type: string;
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

export type ApplicationPdf = "application" | "levy";

const NEW_MEMBER = "New HKFC Member";

/** Which PDF an application gets: a new member's whole application, an existing member's levy form. */
export const pdfFor = (applicationType: string): ApplicationPdf => (applicationType === NEW_MEMBER ? "application" : "levy");

/**
 * Gathers everything, renders and keeps an application's PDF (the latest
 * application's), and records it on the application. Null when there is
 * no application.
 */
export async function makeApplicationPdf(env: Env, personApiId: string): Promise<MadeApplication | null> {
  const d = db(env);
  const p = await d.one<Row>("people", `select=${PERSON_COLUMNS}&api_id=${eq(personApiId)}`);
  if (!p) return null;
  const personId = String(p.id);
  const [app, family, relatives, clubs, trials, files] = await Promise.all([
    d.one<ApplicationRow>(
      "applications",
      `select=id,application_type,submitted_at,signature_file_id,spouse_signature_file_id,guardian_signature_file_id,guardian_account_signature_file_id,sponsor_signed_at,sponsor_signature_file_id,chair_signed_at,chair_signature_file_id,officer_signed_at,officer_signature_file_id&person_id=${eq(personId)}&order=submitted_at.desc&limit=1`,
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
  const which = pdfFor(app.application_type);
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

  // The bytes the spec draws, by asset name: the levy form needs only its
  // template and the applicant's signature.
  const assets: Record<string, Asset> =
    which === "levy"
      ? { [ASSET.levy]: await templateAsset(env, "section-membership-levy") }
      : {
          [ASSET.sam]: await templateAsset(env, "sports-associate-application"),
          [ASSET.levy]: await templateAsset(env, "section-membership-levy"),
          [ASSET.pledge]: await templateAsset(env, "commitment-pledge"),
        };
  const allImages: [string, string | null | undefined][] = [
    [ASSET.photo, newest("photo")?.id],
    [ASSET.signature, app.signature_file_id],
    [ASSET.spouseSignature, app.spouse_signature_file_id],
    [ASSET.spousePhoto, spouseRow ? newest("photo", String(spouseRow.id))?.id : null],
    [ASSET.sponsorSignature, app.sponsor_signature_file_id],
    [ASSET.chairSignature, app.chair_signature_file_id],
    [ASSET.officerSignature, app.officer_signature_file_id],
  ];
  childRows.forEach((c, i) => {
    allImages.push([ASSET.childPhoto(i + 1), newest("photo", String(c.id))?.id]);
    allImages.push([ASSET.childSignature(i + 1), newest("signature", String(c.id))?.id]);
  });
  const payer = str(p, "bill_payer");
  const accountSignature =
    payer === "Guardian / Parent" ? app.guardian_account_signature_file_id : payer === "Spouse / Partner" ? app.spouse_signature_file_id : app.signature_file_id;
  allImages.push([ASSET.accountSignature, accountSignature]);

  const day = app.submitted_at.slice(0, 10);
  const minor = which === "application" && isUnderEighteen(str(p, "date_of_birth"), day);
  if (minor) allImages.push([ASSET.guardianSignature, app.guardian_signature_file_id]);
  const images = which === "levy" ? allImages.filter(([name]) => name === ASSET.signature) : allImages;

  // Supporting documents, in the checklist's order: chosen first, so every
  // image and document is fetched together below.
  const leftOut: string[] = [];
  const supporting: (SupportingDocument & { fileId: string })[] = [];
  const addDoc = (file: FileRow | null, caption: string) => {
    if (!file || which === "levy") return;
    const kind = pageKind(file.content_type);
    if (!kind) {
      leftOut.push(caption);
      return;
    }
    supporting.push({ asset: `doc-${supporting.length + 1}`, caption, kind, fileId: file.id });
  };
  const name = [str(p, "preferred_name") || str(p, "given_names"), str(p, "surname")].filter(Boolean).join(" ");
  addDoc(newest("hkid") ?? newest("passport"), `${name}: ${newest("hkid") ? "HKID" : "passport"}`);
  addDoc(newest("marriage_certificate"), `${name}: marriage certificate`);
  if (spouseRow) addDoc(newest("hkid", String(spouseRow.id)), "Spouse / partner: HKID");
  for (const [i, c] of childRows.entries()) {
    addDoc(newest("birth_certificate", String(c.id)), `Child ${i + 1}: birth certificate`);
    addDoc(newest("hkid", String(c.id)), `Child ${i + 1}: HKID`);
  }

  const fetched = await fileAssets(env, [...images.map(([, id]) => id ?? ""), ...supporting.map((s) => s.fileId)]);
  for (const [assetName, fileId] of images) {
    const a = fileId ? fetched.get(fileId) : undefined;
    // Drawn images must be PNG or JPEG; anything else is left off.
    if (a && (a.type === "image/png" || a.type === "image/jpeg")) assets[assetName] = a;
  }
  for (const s of supporting) assets[s.asset] = fetched.get(s.fileId)!;

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
    supporting: supporting.map(({ fileId: _fileId, ...doc }) => doc),
  };
  if (minor) assets[ASSET.u18] = await templateAsset(env, "u18-registration");

  const rendered = await renderPdf(env, which === "levy" ? levySpec(facts) : applicationSpec(facts), assets);
  if (rendered.warnings.length) console.warn(`Application ${personApiId}: ${rendered.warnings.join("; ")}`);
  const filename = documentFilename(which === "levy" ? "HKFC Section Membership Application" : "HKFC Membership Application", name);
  const fileId = await storeDocument(env, rendered.pdf, { kind: which === "levy" ? "section_membership_form" : "application_form", filename, personId });
  await d.update("applications", `id=${eq(app.id)}`, { pdf_file_id: fileId });
  return { fileId, filename, leftOut };
}

/** "Name <address>" as its address. */
const addressOf = (v: string) => v.match(/<([^>]+)>/)?.[1] ?? v.trim();

/** Where an application's PDF goes: a new member's to the Club's membership office, an existing member's levy form to the front desk. */
export function recipientFor(env: Env, applicationType: string): { to: string | null; greeting: string; label: string } {
  return pdfFor(applicationType) === "application"
    ? { to: env.CLUB_MEMBERSHIP_EMAIL ? addressOf(env.CLUB_MEMBERSHIP_EMAIL) : null, greeting: env.CLUB_MEMBERSHIP_CONTACT || "Membership Services", label: "the Club's membership office" }
    : { to: env.FRONT_DESK_EMAIL ? addressOf(env.FRONT_DESK_EMAIL) : null, greeting: "Front Desk", label: "the front desk" };
}

/** Officers may send any application: the application's own Membership Officer, or another standing in. */
const isMembershipOfficer = (user: AuthorizedUser) => user.officerRoles.some((r) => r.office === "membershipOfficer");

/**
 * The Membership Officer has checked the PDF and sends it: to the Club's
 * membership office (a new member), or to the front desk (an existing
 * member, who is then accepted). Sending again needs `again`.
 */
export async function sendApplication(env: Env, user: AuthorizedUser, personApiId: string, again = false): Promise<{ sentAt: string; sentTo: string }> {
  if (!isMembershipOfficer(user)) throw new HttpError("Only a Membership Officer sends applications on.", 403, "FORBIDDEN");
  const d = db(env);
  const p = await d.one<{
    id: string;
    email: string | null;
    guardian_email: string | null;
    preferred_name: string | null;
    given_names: string | null;
    surname: string | null;
    applicant_stage: string | null;
    sponsored_by_sponsor_id: string | null;
    sponsored_by_chair_id: string | null;
  }>(
    "people",
    `select=id,email,guardian_email,preferred_name,given_names,surname,applicant_stage,sponsored_by_sponsor_id,sponsored_by_chair_id&api_id=${eq(personApiId)}`,
  );
  if (!p) throw new HttpError("Application not found.", 404, "NOT_FOUND");
  const app = await d.one<{ id: string; application_type: string; officer_signed_at: string | null; pdf_file_id: string | null; sent_at: string | null }>(
    "applications",
    `select=id,application_type,officer_signed_at,pdf_file_id,sent_at&person_id=${eq(p.id)}&order=submitted_at.desc&limit=1`,
  );
  if (!app) throw new HttpError("They haven't submitted an application yet.", 404, "NOT_FOUND");
  const which = pdfFor(app.application_type);
  if (which === "application" && !app.officer_signed_at) throw new HttpError("The Membership Officer signs it before it is sent.", 409, "NOT_READY");
  if (!app.pdf_file_id) throw new HttpError("The PDF isn't ready yet. Make it, check it, then send it.", 409, "NOT_READY");
  if (app.sent_at && !again) throw new HttpError("It has been sent already.", 409, "ALREADY_SENT");
  const { to, greeting, label } = recipientFor(env, app.application_type);
  if (!to) throw new HttpError(`There is no address on record for ${label}.`, 500, "SERVER_MISCONFIGURED");

  // The sender: the officer pressing Send, in their office's name.
  // From sign-in (auth_context): no read.
  if (!user.personUuid) throw new HttpError("Your People record was not found.", 403, "FORBIDDEN");
  const me = {
    id: user.personUuid,
    preferred_name: user.person.preferredName ?? null,
    given_names: user.person.givenNames ?? null,
    surname: user.person.surname ?? null,
    email: user.person.email ?? null,
  };
  const myOffice = await d.one<{ designation: string | null; office_email: string | null }>(
    "offices",
    `select=designation,office_email&person_id=${eq(me.id)}&role=eq.membership_officer&status=eq.Active&limit=1`,
  );
  const officerName = holderName(me as OfficeRow["people"]);
  const mailbox = officeAddress(myOffice?.office_email, me.email);
  const name = [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
  const file = await d.one<{ filename: string | null }>("files", `select=filename&id=${eq(app.pdf_file_id)}`);

  let body: string[];
  if (which === "application") {
    const ids = [p.sponsored_by_sponsor_id, p.sponsored_by_chair_id].filter((x): x is string => !!x);
    const offices = ids.length ? await d.select<OfficeRow>("offices", `select=id,designation,office_email,people!offices_person_id_fkey(id,preferred_name,given_names,surname,email,membership_no)&id=${inList(ids)}`) : [];
    const sponsor = offices.find((o) => o.id === p.sponsored_by_sponsor_id);
    const chair = offices.find((o) => o.id === p.sponsored_by_chair_id);
    body = [
      `Please find attached ${name}'s application for Sports Associate Membership, with their Section Membership Application (Hockey), the Hockey Section Commitment Pledge, and their supporting documents.`,
      "",
      `It has been signed by their sponsor${sponsor?.people ? ` (${holderName(sponsor.people)})` : ""}, the Hockey Section Chairman${chair?.people ? ` (${holderName(chair.people)})` : ""} and me as Membership Officer.`,
    ];
  } else {
    body = [`Please find attached ${name}'s Section Membership Application to join the Hockey Section. They are an existing member of the Club; please apply the Hockey Section levy to their account.`];
  }
  await sendEmail(env, {
    toPersonId: me.id,
    to,
    subject: which === "application" ? `Sports Associate Membership application: ${name}` : `Hockey Section levy application: ${name}`,
    text: [`Dear ${greeting},`, "", ...body, "", "Best regards,", officerName, `${myOffice?.designation || "Membership Officer"} – HKFC Hockey Section`].join("\n"),
    template: which === "application" ? "application-to-club" : "levy-to-front-desk",
    // An existing member's levy form copies them and any parent or guardian (owner, 2 Oct 2026).
    cc: which === "levy" ? [...new Set([p.email, p.guardian_email].filter((e): e is string => !!e && e.includes("@")))] : undefined,
    // In the officer's name; replies go to them.
    // The shared From rule (officeContacts.ts): only an hkfchockey.com mailbox
    // can be the sender; anything else sends as REVIEW_EMAIL_FROM.
    from: senderFor(env, officerName, mailbox),
    replyTo: mailbox ?? undefined,
    attachments: [{ filename: file?.filename || "Application.pdf", path: await fileLink(env, app.pdf_file_id) }],
  });
  const sentAt = new Date().toISOString();
  await d.update("applications", `id=${eq(app.id)}`, { sent_at: sentAt, sent_by: me.id, sent_to: to });

  // An existing member is accepted once their levy form is with the front desk (as Make did).
  if (which === "levy" && p.applicant_stage !== ACCEPTED_STAGE) {
    await peopleData(env).update(personApiId, { status: "Member", applicantStage: ACCEPTED_STAGE, active: true });
    await recordMembershipEvent(env, user, {
      eventType: "Approved",
      personId: personApiId,
      previousStage: p.applicant_stage ?? undefined,
      newStage: ACCEPTED_STAGE,
      notes: "Existing HKFC member: levy form sent to the front desk",
    });
    await invalidatePeople(env);
  }
  return { sentAt, sentTo: to };
}
