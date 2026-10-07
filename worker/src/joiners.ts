/**
 * The Section Captain's part of the New Joiner process,
 * replacing Fillout forms 1 and 2 and the Make scenario's Section Captain
 * routes. See shared/joiners.ts for the flow, joinerEmails.ts for the
 * wording.
 *
 *  - Section Captains (the Section Captains office) propose and edit new
 *    joiners and send the three emails.
 *  - The Kit Convenor and the Men's Convenor see their request in My
 *    Tasks, open it (/joiner-task/:id) and mark it done.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { invalidatePeople } from "./invalidation";
import { invalidateCache } from "./cache";
import { sendEmail } from "./mailer";
import { invitationEmail, kitEmail, registrationEmail, type Sender } from "./joinerEmails";
import { joinPhone, splitPhone } from "../../shared/phone";
import { AGREEMENT_PDFS, NEW_MEMBERS_INFO_SHEET } from "../../shared/application";
import { isUnderEighteen } from "./declarations";
import { joinerTrial } from "./trials";
import { recordRegistered } from "./registration";
import { activeOfficeHolders, contactOf, senderFor, type OfficeHolderRow } from "./officeContacts";
import { TRIAL_STAGE } from "../../shared/trials";
import { hkDateKey } from "../../shared/hkDateKey";
import {
  EMPTY_JOINER,
  joinerProblem,
  type JoinerForm,
  type JoinerOptions,
  type JoinerStepKey,
  type JoinerStepState,
  type JoinerView,
  type OfficeChoice,
} from "../../shared/joiners";

const INVITED_STAGE = "2. Section Captain Invitation";
/** Stages an invitation can be sent (or sent again) from. */
const INVITABLE = [null, "1. Trial Application", INVITED_STAGE];

const isCaptain = (user: AuthorizedUser) => user.officerRoles.some((r) => r.office === "sectionCaptain");

function requireCaptain(user: AuthorizedUser): void {
  if (!isCaptain(user)) throw new HttpError("Only Section Captains propose new joiners.", 403, "OFFICER_ACCESS_REQUIRED");
}

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");

type OfficeRow = OfficeHolderRow;

/** Every Active office with its holder. */
const activeOffices = (env: Env): Promise<OfficeRow[]> => activeOfficeHolders(env);

export async function getJoinerOptions(env: Env, user: AuthorizedUser): Promise<JoinerOptions> {
  requireCaptain(user);
  const rows = await activeOffices(env);
  const of = (role: string): OfficeChoice[] =>
    rows
      .filter((r) => r.role === role && r.people)
      .map((r) => ({ id: r.id, name: contactOf(r).name ?? "?", designation: r.designation ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const teams = await db(env).select<{ team_name: string }>("teams", "select=team_name&active=eq.true&order=team_name");
  return {
    teams: teams.map((t) => t.team_name),
    sponsors: of("sponsor"),
    officers: of("membership_officer"),
    chairs: of("section_chair"),
    kitConvenors: of("kit_convenor"),
    hockeyConvenors: of("hockey_convenor"),
  };
}

interface JoinerRow {
  id: string;
  api_id: string;
  email: string | null;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  chinese_name: string | null;
  date_of_birth: string | null;
  hkid_no: string | null;
  passport_no: string | null;
  nationality: string | null;
  gender: string | null;
  mobile_no: string | null;
  status: string | null;
  applicant_stage: string | null;
  applicant_type: string | null;
  category_type: string | null;
  player_coach: string[] | null;
  selected_team_sos: string | null;
  registered_team: string | null;
  playing_position: string | null;
  shirt_number_id: string | null;
  sponsored_by_sponsor_id: string | null;
  sponsored_by_officer_id: string | null;
  sponsored_by_chair_id: string | null;
  sponsored_by_kit_convenor_id: string | null;
  sponsored_by_hockey_convenor_id: string | null;
}

const JOINER_COLUMNS =
  "id,api_id,email,preferred_name,given_names,surname,chinese_name,date_of_birth,hkid_no,passport_no,nationality,gender,mobile_no,status,applicant_stage,applicant_type,category_type,player_coach,selected_team_sos,registered_team,playing_position,shirt_number_id,sponsored_by_sponsor_id,sponsored_by_officer_id,sponsored_by_chair_id,sponsored_by_kit_convenor_id,sponsored_by_hockey_convenor_id";

async function loadJoiner(env: Env, apiId: string): Promise<JoinerRow> {
  const p = await db(env).one<JoinerRow>("people", `select=${JOINER_COLUMNS}&api_id=${eq(apiId)}`);
  if (!p) throw new HttpError("That person was not found.", 404, "NOT_FOUND");
  return p;
}

function toForm(p: JoinerRow): JoinerForm {
  return {
    applicantType: p.applicant_type ?? "",
    email: p.email ?? "",
    preferredName: p.preferred_name ?? "",
    gender: p.gender ?? "",
    mobileNo: p.mobile_no ?? "",
    categoryType: p.category_type ?? "",
    playerCoach: p.player_coach ?? [],
    selectedTeamSos: p.selected_team_sos ?? "",
    registeredTeam: p.registered_team ?? "",
    playingPosition: p.playing_position ?? "",
    sponsorId: p.sponsored_by_sponsor_id ?? "",
    officerId: p.sponsored_by_officer_id ?? "",
    chairId: p.sponsored_by_chair_id ?? "",
    kitConvenorId: p.sponsored_by_kit_convenor_id ?? "",
    hockeyConvenorId: p.sponsored_by_hockey_convenor_id ?? "",
  };
}

/** The form from a request body, with only the expected keys and types. */
export function parseJoinerForm(body: Record<string, unknown>): JoinerForm {
  const f = (body.form ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY_JOINER };
  for (const k of Object.keys(EMPTY_JOINER) as (keyof JoinerForm)[]) {
    if (k === "playerCoach") out.playerCoach = Array.isArray(f.playerCoach) ? f.playerCoach.filter((x): x is string => typeof x === "string") : [];
    else out[k] = text(f[k]);
  }
  out.email = out.email.toLowerCase();
  if (out.mobileNo) out.mobileNo = joinPhone(splitPhone(out.mobileNo).code, splitPhone(out.mobileNo).number) || out.mobileNo;
  return out;
}

/** Each office picked must be an Active office of that kind. */
async function checkOffices(env: Env, f: JoinerForm): Promise<void> {
  const want: [string, string, string][] = [
    [f.sponsorId, "sponsor", "sponsor"],
    [f.officerId, "membership_officer", "Membership Officer"],
    [f.chairId, "section_chair", "Chairman"],
    [f.kitConvenorId, "kit_convenor", "Kit Convenor"],
    [f.hockeyConvenorId, "hockey_convenor", "Men's Convenor"],
  ];
  const ids = want.map(([id]) => id).filter(Boolean);
  if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new HttpError("Choose each office from the list.", 400, "INVALID_INPUT");
  const rows = ids.length ? await db(env).select<{ id: string; role: string }>("offices", `select=id,role&status=eq.Active&id=${inList(ids)}`) : [];
  for (const [id, role, label] of want) {
    if (id && !rows.some((r) => r.id === id && r.role === role)) throw new HttpError(`Choose the ${label} from the list.`, 400, "INVALID_INPUT");
  }
}

function formColumns(f: JoinerForm) {
  return {
    email: f.email,
    preferred_name: f.preferredName,
    gender: f.gender,
    mobile_no: f.mobileNo || null,
    applicant_type: f.applicantType,
    category_type: f.categoryType,
    player_coach: f.playerCoach,
    selected_team_sos: f.selectedTeamSos || null,
    registered_team: f.registeredTeam,
    playing_position: f.playingPosition,
    sponsored_by_sponsor_id: f.sponsorId,
    sponsored_by_officer_id: f.officerId,
    sponsored_by_chair_id: f.chairId,
    sponsored_by_kit_convenor_id: f.kitConvenorId || null,
    sponsored_by_hockey_convenor_id: f.hockeyConvenorId || null,
  };
}

/** Somebody already in the process past the invitation, or a member, can't be proposed again. */
function refuseIfUnderway(p: Pick<JoinerRow, "status" | "applicant_stage">): void {
  if (p.status === "Member") throw new HttpError("That email belongs to a member already.", 409, "ALREADY_MEMBER");
  if (p.applicant_stage && !INVITABLE.includes(p.applicant_stage) && p.applicant_stage !== "Rejected") {
    throw new HttpError(`They're already in the New Joiner process (${p.applicant_stage}).`, 409, "ALREADY_APPLYING");
  }
}

async function personUuid(env: Env, apiId: string): Promise<string | null> {
  return (await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(apiId)}`))?.id ?? null;
}

/**
 * Proposes a new joiner (Fillout form 1). Someone already in People under
 * that email (a trialist, say) is updated rather than duplicated. With
 * `invite`, the invitation goes straight away, as the Fillout form did.
 */
export async function createJoiner(env: Env, actor: AuthorizedUser, body: Record<string, unknown>): Promise<{ id: string; invited: boolean }> {
  requireCaptain(actor);
  const form = parseJoinerForm(body);
  const bad = joinerProblem(form);
  if (bad) throw new HttpError(bad, 400, "INVALID_INPUT");
  await checkOffices(env, form);
  const d = db(env);
  // Emails are unique whatever their case; ilike's wildcards are checked exactly below.
  const matches = await d.select<{ id: string; api_id: string; email: string; status: string | null; applicant_stage: string | null }>(
    "people",
    `select=id,api_id,email,status,applicant_stage&email=ilike.${encodeURIComponent(form.email)}`,
  );
  const existing = matches.find((m) => m.email.toLowerCase() === form.email);
  let apiId: string;
  if (existing) {
    refuseIfUnderway(existing);
    await d.update("people", `id=${eq(existing.id)}`, { ...formColumns(form), status: "Applicant" });
    apiId = existing.api_id;
  } else {
    const [row] = await d.insert<{ api_id: string }>("people", [{ ...formColumns(form), status: "Applicant", active: false }]);
    apiId = row.api_id;
  }
  await log(env, actor, existing ? "update" : "create", apiId, Object.keys(formColumns(form)));
  await invalidatePeople(env);
  const invite = body.invite === true;
  if (invite) await inviteJoiner(env, actor, apiId);
  return { id: apiId, invited: invite };
}

/** Changes a proposed joiner's details (Fillout form 2's fields). */
export async function updateJoiner(env: Env, actor: AuthorizedUser, apiId: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  requireCaptain(actor);
  const p = await loadJoiner(env, apiId);
  const form = parseJoinerForm(body);
  const bad = joinerProblem(form);
  if (bad) throw new HttpError(bad, 400, "INVALID_INPUT");
  await checkOffices(env, form);
  if (form.email !== (p.email ?? "").toLowerCase()) {
    const clash = await db(env).select<{ id: string; email: string }>("people", `select=id,email&email=ilike.${encodeURIComponent(form.email)}`);
    if (clash.some((c) => c.id !== p.id && c.email.toLowerCase() === form.email)) throw new HttpError("Someone else in Eddy has that email.", 409, "EMAIL_TAKEN");
  }
  await db(env).update("people", `id=${eq(p.id)}`, formColumns(form));
  await log(env, actor, "update", apiId, Object.keys(formColumns(form)));
  await invalidatePeople(env);
  return { ok: true };
}

async function log(env: Env, actor: AuthorizedUser, action: string, apiId: string, fields: string[]) {
  const [actorId, entityId] = [actor.personUuid || null, await personUuid(env, apiId)];
  await db(env)
    .insert("activity_log", [{ actor_person_id: actorId, action: `joiner-${action}`, entity: "people", entity_id: entityId, fields }])
    .catch((err) => console.error("activity_log write failed:", err instanceof Error ? err.message : err));
}

/** The acting captain, as the emails are signed and sent. */
function signedBy(env: Env, actor: AuthorizedUser, offices: OfficeRow[]): { sender: Sender; from: string | undefined } {
  const own = offices.find((o) => o.role === "section_captain" && o.people?.api_id === actor.personId);
  const name = contactOf(own).name ?? "HKFC Hockey";
  const designation = own?.designation || "Section Captain";
  // From the captain's own club mailbox, else the configured captain.
  return { sender: { name, designation }, from: senderFor(env, name, own?.office_email) };
}

/** Stage 2 and the invitation email (Make: "1. New Joiner Process"). Sending again is allowed. */
export async function inviteJoiner(env: Env, actor: AuthorizedUser, apiId: string): Promise<{ ok: true }> {
  requireCaptain(actor);
  const p = await loadJoiner(env, apiId);
  refuseIfUnderway(p);
  if (!p.email) throw new HttpError("Give their email address first.", 400, "INVALID_INPUT");
  if (!p.sponsored_by_officer_id || !p.sponsored_by_sponsor_id) throw new HttpError("Choose the sponsor and Membership Officer first.", 400, "INVALID_INPUT");
  const offices = await activeOffices(env);
  const byId = (id: string | null) => offices.find((o) => o.id === id);
  const sponsor = byId(p.sponsored_by_sponsor_id);
  const officer = byId(p.sponsored_by_officer_id);
  const vcs = offices.filter((o) => o.role === "section_captain" && /vice/i.test(o.designation ?? ""));
  const newMember = p.applicant_type === "New HKFC Member";
  const { sender, from } = signedBy(env, actor, offices);
  const app = appOrigin(env);
  const { subject, text: body } = invitationEmail({
    preferredName: p.preferred_name || "there",
    email: p.email,
    newMember,
    viceCaptains: vcs.map((o) => contactOf(o).name).filter((n): n is string => !!n),
    viceCaptainEmail: contactOf(vcs[0]).email ?? "mensvicecaptain@hkfchockey.com",
    officerName: contactOf(officer).name,
    officerEmail: contactOf(officer).email ?? "mensmembership@hkfchockey.com",
    sponsorName: newMember ? contactOf(sponsor).name : null,
    app,
    infoSheetUrl: NEW_MEMBERS_INFO_SHEET ? `${app}${NEW_MEMBERS_INFO_SHEET}` : null,
    termsUrl: `${app}${AGREEMENT_PDFS.samTerms}`,
    sender,
  });
  // The vice captains, and a new member's sponsor; not the membership inbox (owner, 2 Oct 2026).
  const cc = [...new Set([...vcs.map((o) => contactOf(o).email), newMember ? sponsor?.people?.email : null].filter((e): e is string => !!e))];
  await sendEmail(env, { toPersonId: p.id, to: p.email, subject, text: body, template: "joiner-invitation", cc, from });
  await db(env).update("people", `id=${eq(p.id)}`, { status: "Applicant", applicant_stage: INVITED_STAGE });
  await log(env, actor, "invite", apiId, ["applicant_stage"]);
  await invalidatePeople(env);
  return { ok: true };
}

/** The person's kit sizes, most recently given first. */
async function sizesOf(env: Env, personId: string) {
  const rows = await db(env).select<{ item: string; size: string | null }>("kit_sizes", `select=item,size,updated_at&person_id=${eq(personId)}&order=updated_at.desc`);
  const size = (item: string) => rows.find((r) => r.item === item)?.size ?? null;
  return { shirt: size("shirt"), shorts: size("shorts"), socks: size("socks") };
}

async function shirtNoOf(env: Env, p: Pick<JoinerRow, "shirt_number_id">): Promise<number | null> {
  if (!p.shirt_number_id) return null;
  return (await db(env).one<{ shirt_no: number }>("shirt_numbers", `select=shirt_no&id=${eq(p.shirt_number_id)}`))?.shirt_no ?? null;
}

/** Who each step waits on, as shown in messages. */
const STEP_ROLE: Record<JoinerStepKey, string> = { kit: "Kit Convenor", registration: "Men's Convenor" };
/** steps.waiting_on_role keeps the stored wording (the office title is a separate decision). */
const STEP_WAITING_ROLE: Record<JoinerStepKey, string> = { kit: "Kit Convenor", registration: "Hockey Convenor" };

/**
 * Opens (or re-points) the convenor's step, sends the email, and undoes a
 * new step if the email fails, so a request is either made or not.
 */
async function request(
  env: Env,
  actor: AuthorizedUser,
  apiId: string,
  key: JoinerStepKey,
  body: Record<string, unknown>,
): Promise<{ ok: true }> {
  requireCaptain(actor);
  const p = await loadJoiner(env, apiId);
  const convenorId = text(body.convenorId);
  const role = key === "kit" ? "kit_convenor" : "hockey_convenor";
  const offices = await activeOffices(env);
  const convenor = offices.find((o) => o.id === convenorId && o.role === role);
  if (!convenor?.people) throw new HttpError(`Choose the ${STEP_ROLE[key]} from the list.`, 400, "INVALID_INPUT");
  const to = contactOf(convenor).email;
  if (!to) throw new HttpError(`The ${STEP_ROLE[key]} has no email address in Eddy.`, 400, "INVALID_INPUT");
  const d = db(env);
  await d.update("people", `id=${eq(p.id)}`, key === "kit" ? { sponsored_by_kit_convenor_id: convenor.id } : { sponsored_by_hockey_convenor_id: convenor.id });

  const open = await d.one<{ id: string }>("steps", `select=id&process=eq.new_joiner&step=eq.${key}&person_id=${eq(p.id)}&done_at=is.null`);
  const waiting = { waiting_on_person_id: convenor.people.id, waiting_on_role: STEP_WAITING_ROLE[key] };
  const stepId = open
    ? (await d.update<{ id: string }>("steps", `id=${eq(open.id)}`, { ...waiting, started_at: new Date().toISOString() }))[0].id
    : (await d.insert<{ id: string }>("steps", [{ process: "new_joiner", step: key, person_id: p.id, ...waiting }]))[0].id;

  try {
    const { sender, from } = signedBy(env, actor, offices);
    const taskUrl = `${appOrigin(env)}/joiner-task/${stepId}`;
    const sponsor = offices.find((o) => o.id === p.sponsored_by_sponsor_id);
    const preferredName = p.preferred_name || p.given_names || "the new joiner";
    const email =
      key === "kit"
        ? kitEmail({
            convenorName: contactOf(convenor).firstName,
            preferredName,
            mobileNo: p.mobile_no,
            sponsorName: contactOf(sponsor).firstName,
            shirtNo: await shirtNoOf(env, p),
            sizes: await sizesOf(env, p.id),
            taskUrl,
            sender,
          })
        : registrationEmail({ convenorName: contactOf(convenor).firstName, preferredName, rows: await registrationRows(env, p), taskUrl, sender });
    const cc = [p.email, key === "kit" ? sponsor?.people?.email : null].filter((e): e is string => !!e);
    await sendEmail(env, { toPersonId: convenor.people.id, to, subject: email.subject, text: email.text, template: `joiner-${key}`, stepId, cc, from });
  } catch (err) {
    if (!open) await d.remove("steps", `id=${eq(stepId)}`).catch(() => undefined);
    throw err;
  }
  await log(env, actor, key, apiId, [key === "kit" ? "sponsored_by_kit_convenor_id" : "sponsored_by_hockey_convenor_id"]);
  invalidateCache(`joiner-tasks:${convenor.people.api_id}`);
  return { ok: true };
}

/** The details HKHA registration needs (the Fillout form's list). */
async function registrationRows(env: Env, p: JoinerRow): Promise<[string, string | null][]> {
  return [
    ["Team", p.registered_team],
    ["Shirt No", (await shirtNoOf(env, p))?.toString() ?? null],
    ["Surname", p.surname],
    ["Given Names", p.given_names],
    ["Chinese Name", p.chinese_name],
    ["Date of Birth", p.date_of_birth],
    ["HKID No.", p.hkid_no],
    ["Passport No.", p.passport_no],
    ["Nationality", p.nationality],
    ["Email", p.email],
    ["Tel.", p.mobile_no],
    // Without an HKID a player is a visiting player, with restrictions (owner, 2026-10-01).
    ...(!p.hkid_no && p.passport_no ? ([["Note", "No HKID: a visiting player"]] as [string, string][]) : []),
  ];
}

export const requestKit = (env: Env, actor: AuthorizedUser, apiId: string, body: Record<string, unknown>) => request(env, actor, apiId, "kit", body);
export const requestRegistration = (env: Env, actor: AuthorizedUser, apiId: string, body: Record<string, unknown>) =>
  request(env, actor, apiId, "registration", body);

interface StepRow {
  id: string;
  step: string;
  person_id: string;
  started_at: string;
  done_at: string | null;
  waiting_on_person_id: string | null;
  waiter: { preferred_name: string | null; given_names: string | null; surname: string | null } | null;
}

const toStepState = (s: StepRow | undefined): JoinerStepState | null =>
  s
    ? {
        id: s.id,
        startedAt: s.started_at,
        doneAt: s.done_at,
        waitingOn: s.waiter ? [s.waiter.preferred_name || s.waiter.given_names, s.waiter.surname].filter(Boolean).join(" ") : null,
      }
    : null;

/** A joiner's details and where each action stands, for the captain's screen. */
export async function getJoiner(env: Env, actor: AuthorizedUser, apiId: string): Promise<JoinerView> {
  requireCaptain(actor);
  const p = await loadJoiner(env, apiId);
  const d = db(env);
  const [steps, invites] = await Promise.all([
    d.select<StepRow>(
      "steps",
      `select=id,step,person_id,started_at,done_at,waiting_on_person_id,waiter:people!steps_waiting_on_person_id_fkey(preferred_name,given_names,surname)&process=eq.new_joiner&person_id=${eq(p.id)}&order=started_at.desc`,
    ),
    d.select<{ sent_at: string }>("email_log", `select=sent_at&template=eq.joiner-invitation&status=eq.sent&to_person_id=${eq(p.id)}&order=sent_at.desc&limit=1`),
  ]);
  return {
    id: p.api_id,
    form: toForm(p),
    stage: p.applicant_stage,
    status: p.status,
    invitedAt: invites[0]?.sent_at ?? null,
    kit: toStepState(steps.find((s) => s.step === "kit")),
    registration: toStepState(steps.find((s) => s.step === "registration")),
    trial: p.applicant_stage === TRIAL_STAGE ? await joinerTrial(env, p.id) : null,
  };
}

// ── The convenors' side ─────────────────────────────────────────────────

export interface JoinerTask {
  id: string;
  kind: JoinerStepKey;
  applicant: string;
  startedAt: string;
  doneAt: string | null;
  /** Kit: sizes and number. Registration: the HKHA details. */
  rows: [string, string | null][];
  /** Registration: links to the photo and ID documents (valid for an hour or so). */
  files: { label: string; url: string }[];
}

async function loadStep(env: Env, user: AuthorizedUser, stepId: string): Promise<{ step: StepRow; me: string | null }> {
  if (!/^[0-9a-f-]{36}$/.test(stepId)) throw new HttpError("Task not found.", 404, "NOT_FOUND");
  const d = db(env);
  const [step, me] = await Promise.all([
    d.one<StepRow>("steps", `select=id,step,person_id,started_at,done_at,waiting_on_person_id&process=eq.new_joiner&id=${eq(stepId)}`),
    Promise.resolve(user.personUuid || null),
  ]);
  if (!step || (step.step !== "kit" && step.step !== "registration")) throw new HttpError("Task not found.", 404, "NOT_FOUND");
  // The convenor it waits on, or a Section Captain.
  if (step.waiting_on_person_id !== me && !isCaptain(user)) throw new HttpError("This task is for someone else.", 403, "NOT_YOURS");
  return { step, me };
}

export async function getJoinerTask(env: Env, user: AuthorizedUser, stepId: string): Promise<JoinerTask> {
  const { step } = await loadStep(env, user, stepId);
  const p = await db(env).one<JoinerRow>("people", `select=${JOINER_COLUMNS}&id=${eq(step.person_id)}`);
  if (!p) throw new HttpError("Task not found.", 404, "NOT_FOUND");
  const kind = step.step as JoinerStepKey;
  const applicant = [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "New joiner";
  let rows: [string, string | null][];
  const files: JoinerTask["files"] = [];
  if (kind === "kit") {
    const sizes = await sizesOf(env, p.id);
    rows = [
      ["Shirt No", (await shirtNoOf(env, p))?.toString() ?? null],
      ["Shirt size", sizes.shirt],
      ["Shorts size", sizes.shorts],
      ["Socks size", sizes.socks],
      ["Mobile", p.mobile_no],
    ];
  } else {
    rows = await registrationRows(env, p);
    const docs = await db(env).select<{ id: string; kind: string }>(
      "files",
      `select=id,kind,created_at&person_id=${eq(p.id)}&family_member_id=is.null&kind=in.(photo,hkid,passport,u18_registration_form)&order=created_at.desc`,
    );
    const label: Record<string, string> = { photo: "Photo", hkid: "HKID", passport: "Passport", u18_registration_form: "U18 Registration Form" };
    const under18 = isUnderEighteen(p.date_of_birth, hkDateKey(new Date().toISOString()));
    for (const k of Object.keys(label)) {
      const f = docs.find((x) => x.kind === k);
      if (f && (k !== "u18_registration_form" || under18)) files.push({ label: label[k], url: await fileLink(env, f.id) });
    }
  }
  return { id: step.id, kind, applicant, startedAt: step.started_at, doneAt: step.done_at, rows, files };
}

export async function completeJoinerTask(env: Env, user: AuthorizedUser, stepId: string): Promise<{ ok: true }> {
  const { step, me } = await loadStep(env, user, stepId);
  if (!step.done_at) await db(env).update("steps", `id=${eq(step.id)}&done_at=is.null`, { done_at: new Date().toISOString(), done_by_person_id: me });
  // Registered with HKHA: off the Convenor's "Needs registering" list too.
  if (step.step === "registration") await recordRegistered(env, [step.person_id], me);
  invalidateCache(`joiner-tasks:${user.personId}`);
  return { ok: true };
}

/** Open kit and registration requests waiting on this person, for My Tasks. */
export async function openJoinerTasks(env: Env, me: string): Promise<{ id: string; kind: JoinerStepKey; subject: string }[]> {
  if (!me) return [];
  const rows = await db(env).select<{ id: string; step: string; who: { preferred_name: string | null; given_names: string | null; surname: string | null } | null }>(
    "steps",
    `select=id,step,who:people!steps_person_id_fkey(preferred_name,given_names,surname)&process=eq.new_joiner&step=in.(kit,registration)&waiting_on_person_id=${eq(me)}&done_at=is.null&order=started_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.step as JoinerStepKey,
    subject: [r.who?.preferred_name || r.who?.given_names, r.who?.surname].filter(Boolean).join(" ") || "A new joiner",
  }));
}
