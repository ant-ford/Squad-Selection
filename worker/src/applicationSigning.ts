/**
 * The sponsor, Chairman and Membership Officer sign a new HKFC member's
 * application (Supabase backend), replacing Fillout forms 4 and 5, Page 7
 * and the Make routes that moved the stage and emailed the next signer.
 *
 *  - When the application is submitted, each of the three gets one email
 *    and a My Tasks line; they sign in any order (owner decision).
 *  - The sponsor reviews the application and gives their assessment, with
 *    AI drafts from the Airtable fields' own prompts to start from.
 *  - Each signs with their saved signature, or draws one that is kept.
 *  - sign_application (migration 20261001200000) records it and sets the
 *    stage; when all three have signed, the Membership Officer is told it's
 *    ready to accept on the New Joiner board.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import type { MyTask, TaskRole } from "./myTasks";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, inList, SupabaseError } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { invalidateForTables } from "./airtableWebhook";
import { sendEmail } from "./mailer";
import { cleanDraft, complete } from "./reviewDrafts";
import { savedSignature, signatureFor } from "./signatures";
import { TABLES } from "../../shared/schema/tableNames";
import { ROLE_LABEL, SIGN_ROLES, sponsorProblem, type SignRole, type SigningView, type SponsorAnswers } from "../../shared/signing";

const SIGNING_STAGES = ["3. Club Application (Signed)", "4. Sponsor (Signed)", "5. Chairman (Signed)"];
const READY_STAGE = "6. Membership Officer (Signed)";
const NEW_MEMBER = "New HKFC Member";

const OFFICE_COLUMN: Record<SignRole, "sponsored_by_sponsor_id" | "sponsored_by_chair_id" | "sponsored_by_officer_id"> = {
  sponsor: "sponsored_by_sponsor_id",
  chair: "sponsored_by_chair_id",
  officer: "sponsored_by_officer_id",
};
const TASK_ROLE: Record<SignRole, TaskRole> = { sponsor: "Sponsor", chair: "Chairman", officer: "Membership Officer" };

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Signing applications moves into Eddy at the switch-over. Until then, use the Fillout form.", 409, "NOT_YET");
  }
}

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");

interface ApplicantRow {
  id: string;
  api_id: string;
  email: string | null;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  status: string | null;
  applicant_stage: string | null;
  category_type: string | null;
  sports_background: string | null;
  personal_interest: string | null;
  participation_details: string | null;
  playing_level: string[] | null;
  playing_position: string | null;
  registered_team: string | null;
  selected_team_sos: string | null;
  sports_background_sponsor: string | null;
  training_comments_sponsor: string | null;
  applicant_level_sponsor: string | null;
  sports_background_draft: string | null;
  training_comments_draft: string | null;
  sponsored_by_sponsor_id: string | null;
  sponsored_by_chair_id: string | null;
  sponsored_by_officer_id: string | null;
}
const APPLICANT_COLUMNS =
  "id,api_id,email,preferred_name,given_names,surname,status,applicant_stage,category_type,sports_background,personal_interest,participation_details,playing_level,playing_position,registered_team,selected_team_sos,sports_background_sponsor,training_comments_sponsor,applicant_level_sponsor,sports_background_draft,training_comments_draft,sponsored_by_sponsor_id,sponsored_by_chair_id,sponsored_by_officer_id";

interface ApplicationRow {
  id: string;
  person_id: string;
  application_type: string;
  submitted_at: string;
  sponsor_signed_at: string | null;
  sponsor_signature_file_id: string | null;
  chair_signed_at: string | null;
  chair_signature_file_id: string | null;
  officer_signed_at: string | null;
  officer_signature_file_id: string | null;
}
const APPLICATION_COLUMNS =
  "id,person_id,application_type,submitted_at,sponsor_signed_at,sponsor_signature_file_id,chair_signed_at,chair_signature_file_id,officer_signed_at,officer_signature_file_id";

interface Holder {
  officeId: string;
  personId: string;
  apiId: string;
  firstName: string | null;
  name: string | null;
  email: string | null;
}

const nameOf = (p: { preferred_name: string | null; given_names: string | null; surname: string | null }) =>
  [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "the applicant";

/** Who holds each office (by office id). */
async function holders(env: Env, officeIds: string[]): Promise<Record<string, Holder>> {
  const ids = [...new Set(officeIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await db(env).select<{
    id: string;
    people: { id: string; api_id: string; preferred_name: string | null; given_names: string | null; surname: string | null; email: string | null } | null;
  }>("offices", `select=id,people!offices_person_id_fkey(id,api_id,preferred_name,given_names,surname,email)&id=${inList(ids)}`);
  const out: Record<string, Holder> = {};
  for (const r of rows) {
    if (!r.people) continue;
    out[r.id] = {
      officeId: r.id,
      personId: r.people.id,
      apiId: r.people.api_id,
      firstName: r.people.preferred_name || r.people.given_names,
      name: nameOf(r.people),
      email: r.people.email,
    };
  }
  return out;
}

async function loadApplication(env: Env, apiId: string) {
  const d = db(env);
  const p = await d.one<ApplicantRow>("people", `select=${APPLICANT_COLUMNS}&api_id=${eq(apiId)}`);
  if (!p) throw new HttpError("Application not found.", 404, "NOT_FOUND");
  const app = await d.one<ApplicationRow>("applications", `select=${APPLICATION_COLUMNS}&person_id=${eq(p.id)}&order=submitted_at.desc&limit=1`);
  if (!app) throw new HttpError("They haven't submitted an application yet.", 404, "NOT_FOUND");
  const who = await holders(env, SIGN_ROLES.map((r) => p[OFFICE_COLUMN[r]] ?? ""));
  const holderOf = (r: SignRole) => who[p[OFFICE_COLUMN[r]] ?? ""];
  return { p, app, holderOf };
}

const rolesOf = (user: AuthorizedUser, holderOf: (r: SignRole) => Holder | undefined) => SIGN_ROLES.filter((r) => holderOf(r)?.apiId === user.personId);

/** Membership Officers and Section Captains may look at any application; the three signers at theirs. */
const officerViewer = (user: AuthorizedUser) => user.officerRoles.some((r) => r.office === "membershipOfficer" || r.office === "sectionCaptain");

const signedAt = (app: ApplicationRow, r: SignRole) => (r === "sponsor" ? app.sponsor_signed_at : r === "chair" ? app.chair_signed_at : app.officer_signed_at);
const signatureFile = (app: ApplicationRow, r: SignRole) =>
  r === "sponsor" ? app.sponsor_signature_file_id : r === "chair" ? app.chair_signature_file_id : app.officer_signature_file_id;

export async function getSigningView(env: Env, user: AuthorizedUser, apiId: string): Promise<SigningView> {
  requireSupabase(env);
  const { p, app, holderOf } = await loadApplication(env, apiId);
  const myRoles = rolesOf(user, holderOf);
  if (!myRoles.length && !officerViewer(user)) throw new HttpError("This application is for its sponsor, Chairman and Membership Officer.", 403, "NOT_YOURS");
  const d = db(env);
  const [photo, trials, clubs] = await Promise.all([
    d.one<{ id: string }>("files", `select=id&person_id=${eq(p.id)}&family_member_id=is.null&kind=eq.photo&order=created_at.desc&limit=1`),
    d.select<{ trial_date: string | null; participation_types: string[] | null; highest_division: string | null }>(
      "applicant_trials",
      `select=id,trial_date,participation_types,highest_division&person_id=${eq(p.id)}&order=ordinal`,
    ),
    d.select<{ club: string | null; since_year: number | null }>("previous_clubs", `select=id,club,since_year&person_id=${eq(p.id)}&order=ordinal`),
  ]);
  const signatures = {} as SigningView["signatures"];
  for (const r of SIGN_ROLES) {
    const file = signatureFile(app, r);
    signatures[r] = { name: holderOf(r)?.name ?? null, signedAt: signedAt(app, r), signatureUrl: file ? await fileLink(env, file) : null };
  }
  const saved = myRoles.length ? await savedSignature(env, user.personId) : null;
  return {
    id: p.api_id,
    name: nameOf(p),
    photoUrl: photo ? await fileLink(env, photo.id) : null,
    applicationType: app.application_type,
    categoryType: p.category_type,
    submittedAt: app.submitted_at,
    stage: p.applicant_stage,
    applicant: {
      sportsBackground: p.sports_background,
      personalInterest: p.personal_interest,
      participationDetails: p.participation_details,
      playingLevel: p.playing_level ?? [],
      playingPosition: p.playing_position,
      registeredTeam: p.registered_team,
      selectedTeamSos: p.selected_team_sos,
      trials: trials.map((t) => ({ date: t.trial_date, types: t.participation_types ?? [], highestDivision: t.highest_division })),
      clubs: clubs.filter((c) => c.club).map((c) => ({ club: c.club!, sinceYear: c.since_year })),
    },
    sponsorAssessment: app.sponsor_signed_at
      ? { sportsBackground: p.sports_background_sponsor, trainingComments: p.training_comments_sponsor, level: p.applicant_level_sponsor }
      : null,
    signatures,
    myRoles,
    drafts: { sportsBackground: p.sports_background_draft, trainingComments: p.training_comments_draft },
    savedSignatureUrl: saved ? await fileLink(env, saved) : null,
  };
}

// The Airtable AI fields' prompts ("Sports Background / Achievement of the
// Applicant", "Training Comments"), told nothing that names the applicant.
const BACKGROUND_PROMPT = [
  'You are a persuasive writer tasked with crafting a compelling business case for an applicant seeking to join a club as a field hockey ("hockey") player. You are the applicant\'s sponsor. Use your expertise in the applicant\'s sports and personal interests to highlight the strengths and potential contributions to the Club. Do not include any perceived shortfalls.',
  "Analyze the provided sports background and personal/family interests to identify key points that support the applicant's case. Focus on practical contributions and emphasize any unique qualities or experiences that make the applicant a valuable addition.",
  "The vocabulary and expressions to match someone from South Africa or Britain. It should not sound American. It should be concise, professional and factual. Not excessive emotive language.",
  "Output the business case as a concise and persuasive paragraph, written in plain text, natural human language (it shouldn't sound like AI, no emojis, no dashes) and limited to 40 words. Do not include any additional text or headings. Refer to them as \"the applicant\" and assume no gender. If you cannot complete the request, output nothing.",
].join("\n\n");
const TRAINING_PROMPT = [
  "You are a sponsor supporting the application of a new joiner to a club. Your role is to provide a brief comment on the applicant's training, coaching, or playing to justify their selection. This should be less than 35 words.",
  'Use the applicant\'s drafted "Participation Details" and the "Number of Trials" attended as a base to craft your comments. Focus on highlighting key aspects of their participation that are relevant to their application.',
  'Output format: Write a concise comment in plain text, focusing on the applicant\'s strengths and areas of improvement. Do not include any additional text or headings. Assume no gender. For example, "The applicant has shown great dedication in training sessions and has improved significantly in their playing skills." If there is nothing to go on, output nothing.',
].join("\n\n");

/**
 * The sponsor's AI drafts, made the first time they open the application
 * and kept on People (the columns the Airtable AI fields filled).
 */
export async function draftSponsorAnswers(env: Env, user: AuthorizedUser, apiId: string): Promise<SigningView["drafts"]> {
  requireSupabase(env);
  const { p, holderOf } = await loadApplication(env, apiId);
  if (!rolesOf(user, holderOf).includes("sponsor")) throw new HttpError("The drafts are for the sponsor.", 403, "NOT_YOURS");
  if (p.sports_background_draft || p.training_comments_draft || !env.OPENROUTER_API_KEY) {
    return { sportsBackground: p.sports_background_draft, trainingComments: p.training_comments_draft };
  }
  const trials = await db(env).select<{ id: string }>("applicant_trials", `select=id&person_id=${eq(p.id)}`);
  const [background, training] = await Promise.allSettled([
    p.sports_background
      ? complete(env, BACKGROUND_PROMPT, `Sports Background: ${p.sports_background}\nPersonal Interest (optional): ${p.personal_interest ?? ""}`)
      : Promise.resolve(""),
    p.participation_details || trials.length
      ? complete(env, TRAINING_PROMPT, `Number of Trials: ${trials.length}\nParticipation Details: ${p.participation_details ?? ""}`)
      : Promise.resolve(""),
  ]);
  const drafts = {
    sportsBackground: background.status === "fulfilled" ? cleanDraft(background.value, 600) || null : null,
    trainingComments: training.status === "fulfilled" ? cleanDraft(training.value, 600) || null : null,
  };
  for (const r of [background, training]) if (r.status === "rejected") console.error("Sponsor draft failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  if (drafts.sportsBackground || drafts.trainingComments) {
    await db(env).update("people", `id=${eq(p.id)}`, { sports_background_draft: drafts.sportsBackground, training_comments_draft: drafts.trainingComments });
  }
  return drafts;
}

export function sponsorAnswersFrom(body: Record<string, unknown>): SponsorAnswers {
  const a = (body.answers ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  return { playingPosition: s("playingPosition"), team: s("team"), sportsBackground: s("sportsBackground"), trainingComments: s("trainingComments"), level: s("level") };
}

/** One signature, as the role given; the sponsor's with their assessment. */
export async function signApplication(env: Env, user: AuthorizedUser, apiId: string, body: Record<string, unknown>): Promise<{ stage: string }> {
  requireSupabase(env);
  const role = body.role as SignRole;
  if (!SIGN_ROLES.includes(role)) throw new HttpError("Unknown signer.", 400, "INVALID_INPUT");
  const { p, holderOf } = await loadApplication(env, apiId);
  if (holderOf(role)?.apiId !== user.personId) throw new HttpError(`You're not the ${ROLE_LABEL[role]} on this application.`, 403, "NOT_YOURS");
  const answers = role === "sponsor" ? sponsorAnswersFrom(body) : null;
  if (answers) {
    const bad = sponsorProblem(answers);
    if (bad) throw new HttpError(bad, 400, "INVALID_INPUT");
  }
  const drawn = typeof body.signature === "string" ? body.signature : undefined;
  const signature = await signatureFor(env, user, drawn, "Sign the application.");
  let stage: string;
  try {
    stage = await db(env).rpc<string>("sign_application", { p_person: apiId, p_actor: user.personId, p_role: role, p: answers ?? {}, p_signature: signature });
  } catch (err) {
    if (err instanceof SupabaseError && ["22023", "P0002", "42501"].includes(err.code ?? "")) {
      const message = `${err.message.replace(/^Supabase .*?failed \(\d+\): /, "")}.`;
      throw new HttpError(message, err.code === "42501" ? 403 : 400, "INVALID_INPUT");
    }
    throw err;
  }
  await invalidateForTables(env, [TABLES.player]);
  if (stage === READY_STAGE) {
    await notifyReady(env, p, holderOf("officer")).catch((err) => console.error("Ready email not sent:", err instanceof Error ? err.message : err));
  }
  return { stage };
}

/** Each signer's one email when the application comes in (from apply.ts submit). */
export async function notifySigners(env: Env, personApiId: string): Promise<void> {
  const { p, app, holderOf } = await loadApplication(env, personApiId);
  if (app.application_type !== NEW_MEMBER) return;
  const name = nameOf(p);
  const link = `${appOrigin(env)}/sign-application/${p.api_id}`;
  for (const role of SIGN_ROLES) {
    const h = holderOf(role);
    if (!h?.email) {
      console.error(`No ${role} with an email on application ${app.id}`);
      continue;
    }
    const ask = role === "sponsor" ? "review it, add your support and sign it" : "review and sign it";
    try {
      await sendEmail(env, {
        toPersonId: h.personId,
        to: h.email,
        subject: `Please sign ${name}'s membership application`,
        text: [
          `Dear ${h.firstName ?? ROLE_LABEL[role]},`,
          "",
          `${name} has submitted their application to join the Club, and you're their ${role === "sponsor" ? "sponsor" : ROLE_LABEL[role]}. Please ${ask} in Eddy:`,
          link,
          "",
          "The sponsor, Chairman and Membership Officer can sign in any order.",
          "",
          "Many thanks,",
          "HKFC Hockey Section",
        ].join("\n"),
        template: `application-sign-${role}`,
        from: env.REVIEW_EMAIL_FROM || undefined,
      });
    } catch (err) {
      console.error(`Signing email to the ${role} not sent:`, err instanceof Error ? err.message : err);
    }
  }
}

async function notifyReady(env: Env, p: ApplicantRow, officer: Holder | undefined): Promise<void> {
  if (!officer?.email) return;
  const name = nameOf(p);
  await sendEmail(env, {
    toPersonId: officer.personId,
    to: officer.email,
    subject: `${name}'s application is signed`,
    text: [
      `Dear ${officer.firstName ?? "Membership Officer"},`,
      "",
      `The sponsor, Chairman and you have all signed ${name}'s membership application. Once the Club confirms, you can accept them on the New Joiner board:`,
      `${appOrigin(env)}/membership`,
      "",
      "HKFC Hockey Section",
    ].join("\n"),
    template: "application-ready",
    from: env.REVIEW_EMAIL_FROM || undefined,
  });
}

/**
 * The My Tasks lines for applications waiting on signatures (one for each
 * of the three who hasn't signed yet) and ready to accept (the Membership
 * Officer), by the signer's People id.
 */
export async function signingTasks(env: Env): Promise<Record<string, MyTask[]>> {
  const d = db(env);
  const people = await d.select<ApplicantRow>(
    "people",
    `select=id,api_id,preferred_name,given_names,surname,applicant_stage,sponsored_by_sponsor_id,sponsored_by_chair_id,sponsored_by_officer_id&status=eq.Applicant&applicant_stage=${inList([...SIGNING_STAGES, READY_STAGE])}`,
  );
  if (!people.length) return {};
  const apps = await d.select<ApplicationRow>("applications", `select=${APPLICATION_COLUMNS}&person_id=${inList(people.map((x) => x.id))}&order=submitted_at.desc`);
  const who = await holders(env, people.flatMap((x) => SIGN_ROLES.map((r) => x[OFFICE_COLUMN[r]] ?? "")));
  const out: Record<string, MyTask[]> = {};
  const add = (apiId: string | undefined, task: MyTask) => {
    if (apiId) (out[apiId] ??= []).push(task);
  };
  for (const x of people) {
    const app = apps.find((a) => a.person_id === x.id);
    if (!app || app.application_type !== NEW_MEMBER) continue;
    const subject = nameOf(x);
    if (x.applicant_stage === READY_STAGE) {
      add(who[x.sponsored_by_officer_id ?? ""]?.apiId, { id: `accept:${x.api_id}`, key: "accept", subject, url: "/membership" });
      continue;
    }
    for (const r of SIGN_ROLES) {
      if (signedAt(app, r)) continue;
      add(who[x[OFFICE_COLUMN[r]] ?? ""]?.apiId, { id: `application:${x.api_id}:${r}`, key: "application", subject, role: TASK_ROLE[r], url: `/sign-application/${x.api_id}` });
    }
  }
  return out;
}
