/**
 * Commitment reviews in Eddy (Supabase backend): the member's report, the
 * sponsor's review and the Membership Officer's review, replacing Fillout
 * forms 11-13 and their Make.com routes.
 *
 * The database decides and records each step in one transaction
 * (submit_member_report / submit_sponsor_review / submit_officer_review);
 * this module checks who is asking, shows each person what the Fillout forms
 * showed them, keeps signatures, and sends the one email that tells the next
 * person it is their turn (no reminders: owner decision).
 *
 * What each person sees:
 *  - the member: their own report, never the sponsor's or officer's review;
 *  - the sponsor: the member's report and their own review;
 *  - Membership Officers and the membership section: everything.
 *
 * Until the switch-over the reviews still run on the Fillout forms against
 * Airtable, so these routes answer 409 on the Airtable backend.
 */
import type { Env } from "./env";
import { sectionsFor, type AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, SupabaseError } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { MailerError, sendEmail } from "./mailer";
import { invalidateForTables } from "./airtableWebhook";
import { draftNextStep } from "./reviewDrafts";
import { getReferenceData } from "./reference";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { TABLES } from "../../shared/schema/tableNames";
import {
  GAMES_UMPIRED,
  PRACTICES,
  RECOMMENDED_REDUCTIONS,
  SOCIAL_FUNCTIONS,
  STEP_OF_STAGE,
  type MemberReport,
  type OfficerReview,
  type ReviewOffice,
  type ReviewRole,
  type ReviewView,
  type SponsorReview,
} from "../../shared/commitmentReview";

/** An imported review keeps its Airtable id; one Eddy created has a uuid. */
const REVIEW_ID = /^(rec[A-Za-z0-9]{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** A drawn signature is a small PNG; anything larger is not one. */
const MAX_SIGNATURE_BYTES = 200_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface ReviewRow {
  id: string;
  stage: string | null;
  person: string | null;
  preferred_name: string | null;
  full_name: string | null;
  membership_no: string | null;
  year_no: number | null;
  period_start: string | null;
  period_end: string | null;
  team: string | null;
  playing_position: string | null;
  qualified_umpire: string | null;
  matches_played: number | null;
  matches_team_played: number | null;
  matches_not_available: number | null;
  teams_played: string[] | null;
  sponsor_office: string | null;
  sponsor_person: string | null;
  sponsor_name: string | null;
  officer_office: string | null;
  officer_person: string | null;
  officer_name: string | null;
  usual_sponsor_office: string | null;
  games_umpired: string | null;
  practices: string | null;
  social_functions: string[] | null;
  other_contributions: string | null;
  section_service_member: string | null;
  hkfc_service_member: string | null;
  low_participation_reason: string | null;
  member_submitted_at: string | null;
  section_service_sponsor: string | null;
  hkfc_service_sponsor: string | null;
  recommendation_sponsor: string | null;
  sponsor_submitted_at: string | null;
  players_available_for_team: number | null;
  optimum_players_for_team: number | null;
  is_player_needed_officer: string | null;
  other_comments_officer: string | null;
  other_information_officer: string | null;
  recommended_reduction: string | null;
  officer_submitted_at: string | null;
  sponsor_signature_file: string | null;
  officer_signature_file: string | null;
  section_service_draft?: string | null;
  hkfc_service_draft?: string | null;
  recommendation_draft?: string | null;
  is_player_needed_draft?: string | null;
  other_comments_draft?: string | null;
  other_information_draft?: string | null;
  drafts_generated_at?: string | null;
}

/** The AI suggestions for the step the viewer is doing, by form field; empty ones left out. */
export function draftsFor(row: ReviewRow, step: "sponsor" | "officer"): Record<string, string> {
  const pairs: [string, string | null | undefined][] = step === "sponsor"
    ? [["sectionService", row.section_service_draft], ["hkfcService", row.hkfc_service_draft], ["recommendation", row.recommendation_draft]]
    : [["isPlayerNeeded", row.is_player_needed_draft], ["otherComments", row.other_comments_draft], ["otherInformation", row.other_information_draft]];
  return Object.fromEntries(pairs.filter((p): p is [string, string] => typeof p[1] === "string" && p[1].trim() !== ""));
}

/** A review at this step with no drafts made for it yet (e.g. started before drafting existed). */
function needsDrafts(row: ReviewRow, step: "sponsor" | "officer"): boolean {
  if (Object.keys(draftsFor(row, step)).length > 0) return false;
  if (step === "sponsor") return !row.drafts_generated_at;
  return !row.drafts_generated_at || (!!row.sponsor_submitted_at && row.drafts_generated_at < row.sponsor_submitted_at);
}

interface NextStep {
  step_id: string | null;
  commitment_id: string;
  person_id: string;
  email: string | null;
  preferred_name: string | null;
  member_name: string | null;
  year_no: number | null;
}

function requireSupabase(env: Env): void {
  if (backendFor(env, "commitments") !== "supabase") {
    throw new HttpError("Commitment reviews move into Eddy at the switch-over. Until then, use the form link in your email.", 409, "NOT_YET");
  }
}

function reviewId(id: string): string {
  const clean = typeof id === "string" ? id.trim() : "";
  if (!REVIEW_ID.test(clean)) throw new HttpError("Unknown commitment review.", 400, "INVALID_INPUT");
  return clean;
}

const isOfficer = (user: AuthorizedUser) => user.officerRoles.some((r) => r.office === "membershipOfficer");

/** Every role the viewer holds on this review. */
export function rolesFor(user: AuthorizedUser, row: Pick<ReviewRow, "person" | "sponsor_person">): ReviewRole[] {
  const roles: ReviewRole[] = [];
  if (row.person && row.person === user.personId) roles.push("member");
  if (row.sponsor_person && row.sponsor_person === user.personId) roles.push("sponsor");
  if (isOfficer(user)) roles.push("officer");
  if (!roles.includes("officer") && sectionsFor(user).includes("membership")) roles.push("viewer");
  return roles;
}

/** The step the viewer may do now: the stage's step, if it is theirs. */
export function stepFor(stage: string | null, roles: ReviewRole[]): Exclude<ReviewRole, "viewer"> | null {
  const step = STEP_OF_STAGE[stage ?? ""];
  return step && roles.includes(step) ? step : null;
}

async function loadRow(env: Env, id: string): Promise<ReviewRow> {
  const row = await db(env).one<ReviewRow>("api_reviews", `select=*&id=${eq(id)}`);
  if (!row) throw new HttpError("Commitment review not found.", 404, "NOT_FOUND");
  return row;
}

const signed = async (env: Env, fileId: string | null) => (fileId ? fileLink(env, fileId) : null);

/** The signer's saved signature (files, kind 'signature', on their People row), newest first. */
async function savedSignature(env: Env, personApiId: string): Promise<string | null> {
  const d = db(env);
  const person = await d.one<{ id: string }>("people", `select=id&api_id=${eq(personApiId)}`);
  if (!person) return null;
  const rows = await d.select<{ id: string }>(
    "files",
    `select=id&person_id=${eq(person.id)}&kind=eq.signature&order=created_at.desc`,
  );
  return rows[0]?.id ?? null;
}

export async function getReview(env: Env, user: AuthorizedUser, rawId: string): Promise<ReviewView> {
  requireSupabase(env);
  const id = reviewId(rawId);
  const row = await loadRow(env, id);
  const roles = rolesFor(user, row);
  if (roles.length === 0) throw new HttpError("This review is not yours to see.", 403, "FORBIDDEN");

  const seesSponsor = roles.some((r) => r === "sponsor" || r === "officer" || r === "viewer");
  const seesOfficer = roles.some((r) => r === "officer" || r === "viewer");
  const canDo = stepFor(row.stage, roles);

  const view: ReviewView = {
    id: row.id,
    stage: row.stage ?? "",
    roles,
    canDo,
    member: {
      name: row.full_name ?? row.preferred_name ?? "",
      membershipNo: row.membership_no,
      yearNo: row.year_no,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      team: row.team,
      position: row.playing_position,
      qualifiedUmpire: row.qualified_umpire,
    },
    attendance: {
      matchesPlayed: row.matches_played,
      matchesTeamPlayed: row.matches_team_played,
      matchesNotAvailable: row.matches_not_available,
      teamsPlayed: row.teams_played ?? [],
    },
    report: row.member_submitted_at
      ? {
          gamesUmpired: row.games_umpired ?? "",
          practices: row.practices ?? "",
          socialFunctions: row.social_functions ?? [],
          otherContributions: row.other_contributions ?? "",
          sectionService: row.section_service_member ?? "",
          hkfcService: row.hkfc_service_member ?? "",
          lowParticipationReason: row.low_participation_reason ?? "",
          submittedAt: row.member_submitted_at,
        }
      : null,
    sponsor: { office: row.sponsor_office, name: row.sponsor_name },
    officer: { office: row.officer_office, name: row.officer_name },
    sponsorReview:
      seesSponsor && row.sponsor_submitted_at
        ? {
            sectionService: row.section_service_sponsor ?? "",
            hkfcService: row.hkfc_service_sponsor ?? "",
            recommendation: row.recommendation_sponsor ?? "",
            submittedAt: row.sponsor_submitted_at,
            signatureUrl: await signed(env, row.sponsor_signature_file),
          }
        : null,
    officerReview:
      seesOfficer && row.officer_submitted_at
        ? {
            playersAvailable: row.players_available_for_team?.toString() ?? "",
            optimumPlayers: row.optimum_players_for_team?.toString() ?? "",
            isPlayerNeeded: row.is_player_needed_officer ?? "",
            otherComments: row.other_comments_officer ?? "",
            otherInformation: row.other_information_officer ?? "",
            recommendedReduction: row.recommended_reduction ?? "",
            submittedAt: row.officer_submitted_at,
            signatureUrl: await signed(env, row.officer_signature_file),
          }
        : null,
  };

  if (canDo === "member") {
    const offices = await db(env).select<{ id: string; role: string; preferred_name: string | null; surname: string | null; designation: string | null }>(
      "api_review_offices",
      "select=*&order=preferred_name",
    );
    const asOption = (o: (typeof offices)[number]): ReviewOffice => ({
      id: o.id,
      name: [o.preferred_name, o.surname].filter(Boolean).join(" "),
      designation: o.designation,
    });
    view.options = {
      sponsors: offices.filter((o) => o.role === "sponsor").map(asOption),
      officers: offices.filter((o) => o.role === "membership_officer").map(asOption),
      usualSponsor: row.sponsor_office ?? row.usual_sponsor_office,
    };
  }
  if (canDo === "officer" && row.team) {
    // Counted as the membership Insights squad sizes count them: Active
    // players, by the team the app shows them in (Selected Team EOS -> SOS
    // -> Registered), which is how the review's own team is chosen too.
    const ref = await getReferenceData(env);
    view.teamActivePlayers = ref.players.filter((p) => (selectedDisplayTeam(p) || p.registeredTeam || "") === row.team).length;
  }
  if (canDo === "sponsor" || canDo === "officer") {
    view.savedSignatureUrl = await signed(env, await savedSignature(env, user.personId));
    view.drafts = draftsFor(row, canDo);
    // Ready by the next time the page is opened.
    if (needsDrafts(row, canDo)) draftNextStep(env, row.id, canDo);
  }
  return view;
}

// ── Submissions ─────────────────────────────────────────────────────────

const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Checks the answers before the database does, so the screen gets a clear message. */
export function memberReportFrom(body: Record<string, unknown>): MemberReport {
  const socials = Array.isArray(body.socialFunctions) ? body.socialFunctions.filter((s): s is string => typeof s === "string") : [];
  const report: MemberReport = {
    gamesUmpired: str(body.gamesUmpired, 10),
    practices: str(body.practices, 40),
    socialFunctions: [...new Set(socials)],
    otherContributions: str(body.otherContributions),
    sectionService: str(body.sectionService),
    hkfcService: str(body.hkfcService),
    lowParticipationReason: str(body.lowParticipationReason),
    sponsor: str(body.sponsor, 40),
    officer: str(body.officer, 40) || undefined,
  };
  if (!(GAMES_UMPIRED as readonly string[]).includes(report.gamesUmpired)) throw new HttpError("Choose how many games you umpired.", 400, "INVALID_INPUT");
  if (!(PRACTICES as readonly string[]).includes(report.practices)) throw new HttpError("Choose how often you came to practice.", 400, "INVALID_INPUT");
  // None chosen means none went to (there is no "None" option).
  if (report.socialFunctions.some((s) => !(SOCIAL_FUNCTIONS as readonly string[]).includes(s))) {
    throw new HttpError("Unknown social function.", 400, "INVALID_INPUT");
  }
  if (!report.sponsor) throw new HttpError("Choose your sponsor.", 400, "INVALID_INPUT");
  return report;
}

export function sponsorReviewFrom(body: Record<string, unknown>): SponsorReview {
  const review: SponsorReview = {
    sectionService: str(body.sectionService),
    hkfcService: str(body.hkfcService),
    recommendation: str(body.recommendation),
    signature: typeof body.signature === "string" ? body.signature : undefined,
  };
  if (!review.sectionService || !review.hkfcService || !review.recommendation) throw new HttpError("Answer all three questions.", 400, "INVALID_INPUT");
  return review;
}

export function officerReviewFrom(body: Record<string, unknown>): OfficerReview {
  const review: OfficerReview = {
    playersAvailable: str(body.playersAvailable, 3),
    optimumPlayers: str(body.optimumPlayers, 3),
    isPlayerNeeded: str(body.isPlayerNeeded, 500),
    otherComments: str(body.otherComments),
    otherInformation: str(body.otherInformation),
    recommendedReduction: str(body.recommendedReduction, 20),
    signature: typeof body.signature === "string" ? body.signature : undefined,
  };
  if (!/^\d{1,3}$/.test(review.playersAvailable) || !/^\d{1,3}$/.test(review.optimumPlayers)) {
    throw new HttpError("Enter the players available and the optimum number for the team.", 400, "INVALID_INPUT");
  }
  if (!review.isPlayerNeeded) throw new HttpError("Say whether the player is needed.", 400, "INVALID_INPUT");
  if (!(RECOMMENDED_REDUCTIONS as readonly string[]).includes(review.recommendedReduction)) {
    throw new HttpError("Choose the recommended commitment reduction.", 400, "INVALID_INPUT");
  }
  return review;
}

/** A drawn signature (PNG data URL) as bytes, or a 400. */
export function signatureBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError("The signature is not a PNG image.", 400, "INVALID_INPUT");
  const bin = atob(m[1]);
  if (bin.length > MAX_SIGNATURE_BYTES) throw new HttpError("The signature image is too large.", 400, "INVALID_INPUT");
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) throw new HttpError("The signature is not a PNG image.", 400, "INVALID_INPUT");
  return bytes;
}

/**
 * The signature this submission is signed with: a newly drawn one, saved to
 * the signer's People record for next time, or the one saved before.
 */
async function signatureFor(env: Env, user: AuthorizedUser, drawn: string | undefined): Promise<string> {
  if (!drawn) {
    const saved = await savedSignature(env, user.personId);
    if (!saved) throw new HttpError("Sign the review.", 400, "INVALID_INPUT");
    return saved;
  }
  const bytes = signatureBytes(drawn);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const d = db(env);
  const person = await d.one<{ id: string }>("people", `select=id&api_id=${eq(user.personId)}`);
  if (!person) throw new HttpError("Your People record was not found.", 403, "FORBIDDEN");
  const key = `signatures/${person.id}/${crypto.randomUUID()}.png`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [{
    r2_key: key, kind: "signature", person_id: person.id, filename: "signature.png",
    content_type: "image/png", bytes: bytes.length, sha256,
  }]);
  return file.id;
}

/** The database's answer to a submission, as an HTTP error. */
function submissionError(err: unknown): never {
  if (err instanceof SupabaseError) {
    const message = err.message.replace(/^Supabase .*?failed \(\d+\): /, "");
    if (err.code === "P0002") throw new HttpError(message, 404, "NOT_FOUND");
    if (err.code === "42501") throw new HttpError(message, 403, "FORBIDDEN");
    if (err.code === "55000") throw new HttpError(`${message}, so it can't be submitted again. Reload to see it.`, 409, "WRONG_STEP");
    if (err.code === "22023") throw new HttpError(`${message}.`, 400, "INVALID_INPUT");
  }
  throw err;
}

/**
 * Runs one submission; anything unexpected is logged and answered with a
 * short reference (error type, database code, where it failed), never row
 * values, so a failure seen on screen can be diagnosed without the logs.
 */
async function reported<T>(step: string, run: (at: (stage: string) => void) => Promise<T>): Promise<T> {
  let stage = "start";
  try {
    return await run((s) => { stage = s; });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const ref = [
      err instanceof Error ? err.name : typeof err,
      err instanceof SupabaseError ? `${err.status}${err.code ? ` ${err.code}` : ""}` : null,
      `at ${stage}`,
    ].filter(Boolean).join(", ");
    console.error(`Review ${step} submission failed (${ref}):`, err instanceof Error ? err.stack : err);
    throw new HttpError(`Not submitted (${ref}).`, 500, "REVIEW_FAILED");
  }
}

function appOrigin(env: Env): string {
  return (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
}

/**
 * Tells the next person it is their turn. A failed email does not undo the
 * submission: the step is on their My Tasks either way.
 */
async function notifyNext(env: Env, reviewApiId: string, next: NextStep | undefined, kind: "sponsor" | "officer"): Promise<boolean> {
  if (!next?.email) return false;
  const year = next.year_no ? `Year ${next.year_no} ` : "";
  const who = next.member_name || "A member";
  const text = kind === "sponsor"
    ? [
        `Hi ${next.preferred_name || "there"},`,
        "",
        `${who} has completed their ${year}Player Statement. As their sponsor, please add your review and sign it in Eddy:`,
        `${appOrigin(env)}/review/${reviewApiId}`,
        "",
        "It is also under My Tasks when you sign in. The Membership Officer completes the review after you.",
        "",
        "HKFC Hockey Section",
      ]
    : [
        `Hi ${next.preferred_name || "there"},`,
        "",
        `${who}'s sponsor has reviewed their ${year}Player Statement. It is ready for your review in Eddy:`,
        `${appOrigin(env)}/review/${reviewApiId}`,
        "",
        "It is also under My Tasks when you sign in.",
        "",
        "HKFC Hockey Section",
      ];
  try {
    await sendEmail(env, {
      toPersonId: next.person_id,
      to: next.email,
      subject: `Player Statement to review: ${who}`,
      text: text.join("\n"),
      template: kind === "sponsor" ? "commitment-sponsor-review" : "commitment-officer-review",
      stepId: next.step_id ?? undefined,
      cc: env.REVIEW_EMAIL_CC ? env.REVIEW_EMAIL_CC.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
      from: env.REVIEW_EMAIL_FROM || undefined,
    });
    return true;
  } catch (err) {
    console.error(`Review ${reviewApiId}: the ${kind} email was not sent: ${err instanceof MailerError || err instanceof Error ? err.message : "error"}`);
    return false;
  }
}

export async function submitMemberReport(env: Env, user: AuthorizedUser, rawId: string, body: Record<string, unknown>) {
  requireSupabase(env);
  const id = reviewId(rawId);
  const report = memberReportFrom(body);
  return reported("member", async (at) => {
    at("save");
    const next = await db(env)
      .rpc<NextStep[]>("submit_member_report", { p_commitment: id, p_actor: user.personId, p: report })
      .catch(submissionError);
    at("cache");
    await invalidateForTables(env, [TABLES.commitment]);
    draftNextStep(env, id, "sponsor");
    at("email");
    return { ok: true, emailed: await notifyNext(env, id, next?.[0], "sponsor") };
  });
}

export async function submitSponsorReview(env: Env, user: AuthorizedUser, rawId: string, body: Record<string, unknown>) {
  requireSupabase(env);
  const id = reviewId(rawId);
  const { signature, ...review } = sponsorReviewFrom(body);
  return reported("sponsor", async (at) => {
    at("load");
    const row = await loadRow(env, id);
    if (!rolesFor(user, row).includes("sponsor")) throw new HttpError("Only this member's sponsor can review their Player Statement.", 403, "FORBIDDEN");
    at(signature ? "signature-store" : "signature-saved");
    const file = await signatureFor(env, user, signature);
    at("save");
    const next = await db(env)
      .rpc<NextStep[]>("submit_sponsor_review", { p_commitment: id, p_actor: user.personId, p: review, p_signature: file })
      .catch(submissionError);
    at("cache");
    await invalidateForTables(env, [TABLES.commitment]);
    draftNextStep(env, id, "officer");
    at("email");
    return { ok: true, emailed: await notifyNext(env, id, next?.[0], "officer") };
  });
}

export async function submitOfficerReview(env: Env, user: AuthorizedUser, rawId: string, body: Record<string, unknown>) {
  requireSupabase(env);
  const id = reviewId(rawId);
  const { signature, ...review } = officerReviewFrom(body);
  if (!isOfficer(user)) throw new HttpError("Only a Membership Officer can complete the review.", 403, "FORBIDDEN");
  return reported("officer", async (at) => {
    at(signature ? "signature-store" : "signature-saved");
    const file = await signatureFor(env, user, signature);
    at("save");
    await db(env)
      .rpc("submit_officer_review", { p_commitment: id, p_actor: user.personId, p: review, p_signature: file })
      .catch(submissionError);
    at("cache");
    await invalidateForTables(env, [TABLES.commitment]);
    return { ok: true };
  });
}
