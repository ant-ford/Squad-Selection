/**
 * The new joiner (applicant) form (Supabase backend), replacing Fillout
 * form 3. The shared details sections save through details.ts; this module
 * holds the applicant's own parts (family, private clubs, trials attended),
 * family members' documents, and the submit: it checks the application is
 * complete, stores the signatures, records what was agreed and moves the
 * application from the applicant (stage 2) to the sponsor (stage 3).
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, SupabaseError } from "./data/supabase";
import { invalidateForTables } from "./airtableWebhook";
import { isUnderEighteen } from "./declarations";
import { signatureBytes } from "./signatures";
import { uploadBytes } from "./details";
import { TABLES } from "../../shared/schema/tableNames";
import { hkDateKey } from "../../shared/hkDateKey";
import {
  APPLICATION_VERSION,
  MAX_CHILDREN,
  MAX_CLUBS,
  MAX_RELATIVES,
  MAX_TRIALS,
  PRIVATE_CLUBS,
  childNeedsHkid,
  childProblem,
  childSigns,
  relativeProblem,
  requiredTicks,
  spouseProblem,
  trialProblem,
  type ApplyView,
  type FamilyMemberDetails,
  type PrivateClub,
  type Relative,
  type TrialAttended,
} from "../../shared/application";
import { PROFILE_SECTIONS, audienceOf, checkValue, fieldsFor, sectionFor, sectionProblem, type Audience, type ProfileValues } from "../../shared/profile";

interface PersonRow {
  id: string;
  api_id: string;
  status: string | null;
  applicant_type: string | null;
  applicant_stage: string | null;
  date_of_birth: string | null;
  marital_status: string | null;
  bill_payer: string | null;
  participation_details: string | null;
  [column: string]: unknown;
}

interface FamilyRow {
  id: string;
  relation: "spouse" | "child";
  ordinal: number;
  [column: string]: unknown;
}

/** Family member answer <-> family_members column. */
const FAMILY_COLUMNS: Record<keyof Omit<FamilyMemberDetails, "id">, string> = {
  salutation: "salutation",
  surname: "surname",
  givenNames: "given_names",
  chineseName: "chinese_name",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  hkidNo: "hkid_no",
  passportNo: "passport_no",
  nationality: "nationality",
  email: "email",
  mobileNo: "mobile_no",
  weddingAnniversary: "wedding_anniversary",
  companyName: "company_name",
  workPosition: "work_position",
  natureOfBusiness: "nature_of_business",
  officeEmail: "office_email",
  officeTelephoneNo: "office_telephone_no",
};

const today = () => hkDateKey(new Date().toISOString());

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("The application moves into Eddy at the switch-over. Until then, use the New Joiner Form link.", 409, "NOT_YET");
  }
}

/** The signed-in applicant (every column: the submit checks them all). */
async function loadApplicant(env: Env, personApiId: string): Promise<PersonRow> {
  const p = await db(env).one<PersonRow>("people", `select=*&api_id=${eq(personApiId)}`);
  if (!p) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  if (p.status !== "Applicant") throw new HttpError("The application form is for applicants.", 403, "NOT_AN_APPLICANT");
  return p;
}

const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function toMember(r: FamilyRow): FamilyMemberDetails {
  const out = { id: r.id } as FamilyMemberDetails & Record<string, unknown>;
  for (const [k, col] of Object.entries(FAMILY_COLUMNS)) {
    const v = r[col];
    out[k] = typeof v === "string" ? v : v ?? (k === "surname" || k === "givenNames" || k === "dateOfBirth" || k === "gender" ? "" : null);
  }
  return out;
}

function memberColumns(m: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, col] of Object.entries(FAMILY_COLUMNS)) {
    out[col] = k === "dateOfBirth" || k === "weddingAnniversary" ? dateOrNull(m[k]) : text(m[k]);
  }
  return out;
}

export async function getApply(env: Env, user: AuthorizedUser): Promise<ApplyView> {
  requireSupabase(env);
  const p = await loadApplicant(env, user.personId);
  const d = db(env);
  const [family, relatives, clubs, trials, apps, ownFiles] = await Promise.all([
    d.select<FamilyRow>("family_members", `select=*&person_id=${eq(p.id)}&order=relation,ordinal`),
    d.select<{ name: string | null; membership_no: string | null; relationship: string | null }>("relatives", `select=id,name,membership_no,relationship&person_id=${eq(p.id)}&order=ordinal`),
    d.select<{ club: string | null; since_year: number | null }>("previous_clubs", `select=id,club,since_year&person_id=${eq(p.id)}&order=ordinal`),
    d.select<{ trial_date: string | null; participation_types: string[]; highest_division: string | null }>(
      "applicant_trials",
      `select=id,trial_date,participation_types,highest_division&person_id=${eq(p.id)}&order=ordinal`,
    ),
    d.select<{ submitted_at: string }>("applications", `select=id,submitted_at&person_id=${eq(p.id)}&order=submitted_at.desc&limit=1`),
    d.select<{ kind: string }>("files", `select=id,kind&person_id=${eq(p.id)}&family_member_id=is.null&kind=eq.marriage_certificate`),
  ]);
  // Their family's documents only (imported ones are filed on the family member alone).
  const familyFiles = family.length
    ? await d.select<{ kind: string; family_member_id: string }>(
        "files",
        `select=id,kind,family_member_id&family_member_id=in.(${family.map((f) => f.id).join(",")})&kind=in.(photo,hkid,birth_certificate)`,
      )
    : [];
  const filesOf = (memberId: string) => {
    const mine = familyFiles.filter((f) => f.family_member_id === memberId);
    return { photo: mine.some((f) => f.kind === "photo"), hkid: mine.some((f) => f.kind === "hkid"), birthCertificate: mine.some((f) => f.kind === "birth_certificate") };
  };
  const spouse = family.find((f) => f.relation === "spouse");
  return {
    stage: p.applicant_stage,
    submittedAt: apps[0]?.submitted_at ?? null,
    spouse: spouse ? { ...toMember(spouse), files: filesOf(spouse.id) } : null,
    children: family.filter((f) => f.relation === "child").map((c) => ({ ...toMember(c), files: filesOf(c.id) })),
    relatives: relatives.map((r) => ({ name: r.name ?? "", membershipNo: r.membership_no ?? "", relationship: r.relationship ?? "" })),
    clubs: clubs.map((c) => ({ club: c.club ?? "", sinceYear: c.since_year })),
    trials: trials.map((t) => ({ date: t.trial_date ? String(t.trial_date).slice(0, 10) : "", types: t.participation_types ?? [], division: t.highest_division ?? "" })),
    participationDetails: p.participation_details,
    hasMarriageCertificate: ownFiles.length > 0,
  };
}

/** Spouse, children and close relatives. Saving replaces what was there; returns the family members' ids. */
export async function saveFamily(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const p = await loadApplicant(env, user.personId);
  const spouse = body.spouse && typeof body.spouse === "object" ? (body.spouse as FamilyMemberDetails) : null;
  const children = Array.isArray(body.children) ? (body.children as FamilyMemberDetails[]) : [];
  const relatives = Array.isArray(body.relatives) ? (body.relatives as Relative[]) : [];
  if (children.length > MAX_CHILDREN || relatives.length > MAX_RELATIVES) throw new HttpError("Too many family members.", 400, "INVALID_INPUT");
  const problem = (spouse && spouseProblem(spouse)) || children.map((c, i) => childProblem(c, i + 1)).find(Boolean) || relatives.map((r, i) => relativeProblem(r, i + 1)).find(Boolean);
  if (problem) throw new HttpError(problem, 400, "INVALID_INPUT");

  const d = db(env);
  const rows = [
    ...(spouse ? [{ person_id: p.id, relation: "spouse", ordinal: 1, ...memberColumns(spouse as unknown as Record<string, unknown>) }] : []),
    ...children.map((c, i) => ({ person_id: p.id, relation: "child", ordinal: i + 1, ...memberColumns(c as unknown as Record<string, unknown>) })),
  ];
  const saved = rows.length ? await d.upsert<FamilyRow>("family_members", rows, "person_id,relation,ordinal") : [];
  // Anyone no longer listed goes, with their documents (files cascade).
  const keep = saved.map((r) => r.id);
  await d.remove("family_members", `person_id=${eq(p.id)}${keep.length ? `&id=not.in.(${keep.join(",")})` : ""}`);
  await d.remove("relatives", `person_id=${eq(p.id)}`);
  if (relatives.length) {
    await d.insert("relatives", relatives.map((r, i) => ({ person_id: p.id, ordinal: i + 1, name: text(r.name), membership_no: text(r.membershipNo, 40), relationship: r.relationship })));
  }
  return {
    spouseId: saved.find((r) => r.relation === "spouse")?.id ?? null,
    childIds: saved.filter((r) => r.relation === "child").sort((a, b) => a.ordinal - b.ordinal).map((r) => r.id),
  };
}

export async function saveClubs(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const p = await loadApplicant(env, user.personId);
  const clubs = Array.isArray(body.clubs) ? (body.clubs as PrivateClub[]) : [];
  if (clubs.length > MAX_CLUBS) throw new HttpError("Up to four clubs.", 400, "INVALID_INPUT");
  const year = new Date().getFullYear();
  for (const c of clubs) {
    if (!(PRIVATE_CLUBS as readonly string[]).includes(c.club)) throw new HttpError("Choose each club from the list.", 400, "INVALID_INPUT");
    if (c.sinceYear !== null && (!Number.isInteger(c.sinceYear) || c.sinceYear < 1900 || c.sinceYear > year)) throw new HttpError("That isn't a year.", 400, "INVALID_INPUT");
  }
  const d = db(env);
  await d.remove("previous_clubs", `person_id=${eq(p.id)}`);
  if (clubs.length) await d.insert("previous_clubs", clubs.map((c, i) => ({ person_id: p.id, ordinal: i + 1, club: c.club, since_year: c.sinceYear })));
  return { ok: true };
}

export async function saveTrials(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const p = await loadApplicant(env, user.personId);
  const trials = Array.isArray(body.trials) ? (body.trials as TrialAttended[]) : [];
  if (trials.length > MAX_TRIALS) throw new HttpError("Up to five trials.", 400, "INVALID_INPUT");
  const problem = trials.map((t, i) => trialProblem(t, i + 1)).find(Boolean);
  if (problem) throw new HttpError(problem, 400, "INVALID_INPUT");
  const details = text(body.participationDetails, 2000);
  if (trials.length && !details) throw new HttpError("Tell us how the trials went (participation details).", 400, "INVALID_INPUT");
  const d = db(env);
  await d.remove("applicant_trials", `person_id=${eq(p.id)}`);
  if (trials.length) {
    await d.insert("applicant_trials", trials.map((t, i) => ({ person_id: p.id, ordinal: i + 1, trial_date: t.date, participation_types: t.types, highest_division: t.division })));
  }
  await d.update("people", `id=${eq(p.id)}`, { participation_details: trials.length ? details : null });
  return { ok: true };
}

/** A family member's photo, HKID copy or birth certificate (replaces the old one); or the applicant's marriage certificate. */
export async function uploadApplicantFile(env: Env, user: AuthorizedUser, memberId: string | null, kind: string, body: Record<string, unknown>) {
  requireSupabase(env);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const allowed = memberId ? ["photo", "hkid", "birth_certificate"] : ["marriage_certificate"];
  if (!allowed.includes(kind)) throw new HttpError("Unknown upload.", 404, "NOT_FOUND");
  const { bytes, type } = uploadBytes(kind === "photo" ? "photo" : "hkid", body.dataUrl);
  const p = await loadApplicant(env, user.personId);
  const d = db(env);
  if (memberId) {
    const member = await d.one<{ id: string }>("family_members", `select=id&id=${eq(memberId)}&person_id=${eq(p.id)}`);
    if (!member) throw new HttpError("That family member was not found.", 404, "NOT_FOUND");
  }
  const owner = memberId ? `family_member_id=${eq(memberId)}` : `person_id=${eq(p.id)}&family_member_id=is.null`;
  const old = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&${owner}&kind=${eq(kind)}`);
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[type] ?? "bin";
  const key = `people/${p.id}/${memberId ? `family/${memberId}/` : ""}${kind}/${crypto.randomUUID()}.${ext}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  await d.insert("files", [
    { r2_key: key, kind, person_id: p.id, family_member_id: memberId, filename: `${kind}.${ext}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  if (old.length) {
    await d.remove("files", `id=in.(${old.map((o) => o.id).join(",")})`);
    await Promise.all(old.map((o) => env.FILES!.delete(o.r2_key)));
  }
  return { ok: true };
}

/** Stores one drawn signature; returns its files id. */
async function storeDrawn(env: Env, personId: string, memberId: string | null, kind: string, dataUrl: unknown): Promise<string> {
  if (typeof dataUrl !== "string") throw new HttpError("A signature is missing.", 400, "INVALID_INPUT");
  const bytes = signatureBytes(dataUrl);
  const key = `signatures/${personId}/${crypto.randomUUID()}.png`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES!.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { sha256 } });
  const [file] = await db(env).insert<{ id: string }>("files", [
    { r2_key: key, kind, person_id: personId, family_member_id: memberId, filename: `${kind}.png`, content_type: "image/png", bytes: bytes.length, sha256 },
  ]);
  return file.id;
}

/** Everything the application still needs, as the applicant would read it; empty when complete. */
export function applicationGaps(p: PersonRow, view: ApplyView, who: Audience, hasPhoto: boolean, hasHkid: boolean, day: string): string[] {
  const gaps: string[] = [];
  const values: ProfileValues = {};
  for (const s of PROFILE_SECTIONS) for (const f of s.fields) values[f.key] = (p[f.column] as ProfileValues[string]) ?? null;
  const under18 = isUnderEighteen(p.date_of_birth, day);
  for (const s of PROFILE_SECTIONS) {
    if (!sectionFor(s, who) || (s.underEighteenOnly && !under18)) continue;
    const bad = fieldsFor(s, who).map((f) => checkValue(f, values[f.key], who)).find(Boolean) ?? sectionProblem(s.key, values);
    if (bad) gaps.push(`${s.title}: ${bad}`);
  }
  if (!hasPhoto) gaps.push("Personal details: upload your photo.");
  if (!hasHkid) gaps.push("Personal details: upload a copy of your HKID.");
  if (p.marital_status === "Married" && !view.hasMarriageCertificate) gaps.push("Personal details: upload your marriage certificate.");
  if (view.spouse) {
    if (!view.spouse.files.photo) gaps.push("Family: upload your spouse or partner's photo.");
    if (!view.spouse.files.hkid) gaps.push("Family: upload your spouse or partner's HKID.");
  }
  view.children.forEach((c, i) => {
    if (!c.files.photo) gaps.push(`Family: upload child ${i + 1}'s photo.`);
    if (!c.files.birthCertificate) gaps.push(`Family: upload child ${i + 1}'s birth certificate.`);
    if (childNeedsHkid(c.dateOfBirth, day) && !c.files.hkid) gaps.push(`Family: upload child ${i + 1}'s HKID.`);
  });
  if (who === "new" && view.trials.length && !view.participationDetails) gaps.push("Trials: tell us how the trials went.");
  return gaps;
}

/**
 * Submits the application: checks it's complete, stores the signatures,
 * records the boxes ticked and moves it on to the sponsor.
 */
export async function submitApplication(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  if (body.version !== APPLICATION_VERSION) {
    throw new HttpError("The wording has changed since this page was opened. Reload to read the current version.", 409, "WORDING_CHANGED");
  }
  const p = await loadApplicant(env, user.personId);
  const who = audienceOf(p.status, p.applicant_type);
  const day = today();
  const view = await getApply(env, user);
  const own = await db(env).select<{ kind: string }>("files", `select=id,kind&person_id=${eq(p.id)}&family_member_id=is.null&kind=in.(photo,hkid)`);
  const gaps = applicationGaps(p, view, who, own.some((f) => f.kind === "photo"), own.some((f) => f.kind === "hkid"), day);
  if (gaps.length) throw new HttpError(`Not quite finished: ${gaps[0]}`, 400, "INCOMPLETE");

  const under18 = isUnderEighteen(p.date_of_birth, day);
  const required = requiredTicks(who, under18);
  const accepted = Array.isArray(body.accepted) ? body.accepted.filter((k): k is string => typeof k === "string" && required.includes(k)) : [];
  if (required.some((k) => !accepted.includes(k))) throw new HttpError("Tick every box to agree.", 400, "INVALID_INPUT");

  const sig = (body.signatures ?? {}) as Record<string, unknown>;
  const signature = await storeDrawn(env, p.id, null, "signature", sig.applicant);
  const spouseSignature = view.spouse ? await storeDrawn(env, p.id, view.spouse.id ?? null, "signature", sig.spouse) : null;
  const guardianSignature = under18 ? await storeDrawn(env, p.id, null, "guardian_consent_signature", sig.guardian) : null;
  const guardianAccountSignature =
    who === "new" && p.bill_payer === "Guardian / Parent" ? await storeDrawn(env, p.id, null, "guardian_account_signature", sig.guardianAccount) : null;
  const childSigs = (sig.children ?? {}) as Record<string, unknown>;
  for (const c of view.children) {
    if (c.id && childSigns(c.dateOfBirth, day)) await storeDrawn(env, p.id, c.id, "signature", childSigs[c.id]);
  }

  try {
    await db(env).rpc("submit_application", {
      p_actor: user.personId,
      p: {
        applicationType: p.applicant_type ?? "New HKFC Member",
        version: APPLICATION_VERSION,
        accepted,
        required,
        signature,
        spouseSignature,
        guardianSignature,
        guardianAccountSignature,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseError && (err.code === "22023" || err.code === "P0002")) {
      throw new HttpError(`${err.message.replace(/^Supabase .*?failed \(\d+\): /, "")}.`, 400, "INVALID_INPUT");
    }
    throw err;
  }
  await invalidateForTables(env, [TABLES.player]);
  return { ok: true };
}
