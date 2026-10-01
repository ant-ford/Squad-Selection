/**
 * Registering interest to join the club (Supabase backend; migration
 * 20261001220000, owner decisions 2026-10-01), replacing the trials
 * registration forms:
 *
 *  - Any member shares a link (/join?ref=<their id>). Whoever opens it
 *    confirms their email with a code; registering makes them an applicant
 *    at "1. Trial Application" and they fill in the old trial form's
 *    questions on the applicant page, then send it.
 *  - Before the season they say which trial sessions they can come to (the
 *    Section Captains keep the list). Once it has started there are none.
 *  - The Section Captains are emailed and decide on the New Joiner board:
 *    a practice trial (the Assistant Director of Hockey and the coach of
 *    the team they pick are emailed the player's hockey CV, and the player
 *    is told when to come), propose them as a new joiner, or not this time.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, inList } from "./data/supabase";
import { invalidateForTables } from "./airtableWebhook";
import { invalidatePlayerByEmail } from "./reference";
import { sendEmail } from "./mailer";
import { TABLES } from "../../shared/schema/tableNames";
import { PROFILE_SECTIONS, checkValue, fieldsFor, isShown, sectionProblem, type ProfileValues } from "../../shared/profile";
import { TRIAL_STAGE, type JoinResult, type JoinerTrial, type MyTrial, type TrialSession } from "../../shared/trials";
import { audienceOf } from "../../shared/profile";
import { isUnderEighteen } from "./declarations";
import { hkDateKey } from "../../shared/hkDateKey";

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Registering to join moves into Eddy at the switch-over (3 October).", 409, "NOT_YET");
  }
}

const isCaptain = (user: AuthorizedUser) => user.officerRoles.some((r) => r.office === "sectionCaptain");
function requireCaptain(env: Env, user: AuthorizedUser): void {
  requireSupabase(env);
  if (!isCaptain(user)) throw new HttpError("This is for Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
}

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");
const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
const nameOf = (p: { preferred_name: string | null; given_names: string | null; surname: string | null }) =>
  [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");

/**
 * Signs someone up from a member's link, by their confirmed email (the
 * caller has checked the sign-in, not the People record). A new email
 * becomes an applicant at stage 1; anyone already in Eddy is told where
 * they stand instead.
 */
export async function registerInterest(env: Env, email: string, body: Record<string, unknown>): Promise<JoinResult> {
  requireSupabase(env);
  const d = db(env);
  const matches = await d.select<{ id: string; email: string; status: string | null; applicant_stage: string | null }>(
    "people",
    `select=id,email,status,applicant_stage&email=ilike.${encodeURIComponent(email)}`,
  );
  const existing = matches.find((m) => m.email.toLowerCase() === email);
  if (existing) {
    if (existing.status === "Applicant") return { status: "applicant", stage: existing.applicant_stage };
    return { status: "member", stage: existing.applicant_stage };
  }
  // The member whose link it was, if they are one.
  const ref = text(body.ref, 40);
  const referrer = ref ? await d.one<{ id: string }>("people", `select=id&api_id=${eq(ref)}&status=eq.Member`) : null;
  await d.insert("people", [{ email, status: "Applicant", applicant_stage: TRIAL_STAGE, active: false, referred_by_id: referrer?.id ?? null }]);
  // Their next request must find the new record, not a cached "nobody".
  invalidatePlayerByEmail(email, env);
  await invalidateForTables(env, [TABLES.player]);
  return { status: "registering", stage: TRIAL_STAGE };
}

/** trial_availability is keyed on the two columns, with no id (for the paging order). */
const AVAILABILITY_KEY = "person_id,session_id";

interface SessionRow {
  id: string;
  starts_at: string;
  place: string;
  notes: string | null;
}
const toSession = (r: SessionRow): TrialSession => ({ id: r.id, startsAt: r.starts_at, place: r.place, notes: r.notes });

async function upcomingSessions(env: Env): Promise<TrialSession[]> {
  const rows = await db(env).select<SessionRow>("trial_sessions", `select=id,starts_at,place,notes&starts_at=gte.${encodeURIComponent(new Date().toISOString())}&order=starts_at`);
  return rows.map(toSession);
}

interface TrialistRow {
  id: string;
  api_id: string;
  status: string | null;
  applicant_stage: string | null;
  trial_registered_at: string | null;
  referred_by_id: string | null;
}

async function loadTrialist(env: Env, personApiId: string): Promise<TrialistRow> {
  const p = await db(env).one<TrialistRow>("people", `select=id,api_id,status,applicant_stage,trial_registered_at,referred_by_id&api_id=${eq(personApiId)}`);
  if (!p || p.status !== "Applicant" || p.applicant_stage !== TRIAL_STAGE) throw new HttpError("This is for people registering to join.", 403, "NOT_A_TRIALIST");
  return p;
}

async function referrerName(env: Env, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await db(env).one<{ preferred_name: string | null; given_names: string | null; surname: string | null }>(
    "people",
    `select=preferred_name,given_names,surname&id=${eq(id)}`,
  );
  return r ? nameOf(r) || null : null;
}

export async function getMyTrial(env: Env, user: AuthorizedUser): Promise<MyTrial> {
  requireSupabase(env);
  const p = await loadTrialist(env, user.personId);
  const [sessions, chosen, referredBy] = await Promise.all([
    upcomingSessions(env),
    db(env).select<{ session_id: string }>("trial_availability", `select=session_id&person_id=${eq(p.id)}`, AVAILABILITY_KEY),
    referrerName(env, p.referred_by_id),
  ]);
  return { sessions, chosen: chosen.map((c) => c.session_id).filter((id) => sessions.some((s) => s.id === id)), registeredAt: p.trial_registered_at, referredBy };
}

/** Which upcoming sessions they can come to; replaces their earlier choice. */
export async function saveMyTrial(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true }> {
  requireSupabase(env);
  const p = await loadTrialist(env, user.personId);
  const upcoming = await upcomingSessions(env);
  const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.some((id) => !upcoming.some((s) => s.id === id))) throw new HttpError("Choose from the sessions listed.", 400, "INVALID_INPUT");
  const d = db(env);
  if (upcoming.length) await d.remove("trial_availability", `person_id=${eq(p.id)}&session_id=${inList(upcoming.map((s) => s.id))}`);
  if (ids.length) await d.insert("trial_availability", ids.map((session_id) => ({ person_id: p.id, session_id })));
  return { ok: true };
}

/** The sections a registration needs complete before it's sent (the old trial form's required questions). */
const NEEDED = ["application", "personal", "contact", "emergency", "background", "hockey"] as const;

export function registrationGaps(p: Record<string, unknown>, hasPhoto: boolean, day: string): string[] {
  const values: ProfileValues = {};
  for (const s of PROFILE_SECTIONS) for (const f of s.fields) values[f.key] = (p[f.column] as ProfileValues[string]) ?? null;
  const who = audienceOf("Applicant", (p.applicant_type as string) ?? null);
  const gaps: string[] = [];
  const sections = [...NEEDED, ...(isUnderEighteen((p.date_of_birth as string) ?? null, day) ? (["guardian"] as const) : [])];
  for (const key of sections) {
    const s = PROFILE_SECTIONS.find((x) => x.key === key)!;
    // The hockey CV is asked of every registrant, whichever type of application.
    const fields = key === "background" ? s.fields : fieldsFor(s, who);
    const bad = fields.filter((f) => isShown(f, values)).map((f) => checkValue(f, values[f.key], key === "background" ? "new" : who)).find(Boolean) ?? sectionProblem(s.key, values);
    if (bad) gaps.push(`${s.title}: ${bad}`);
  }
  if (!hasPhoto) gaps.push("Personal details: upload your photo.");
  return gaps;
}

/** Sends the registration: checks it's complete, then tells the Section Captains. Sending again just updates it. */
export async function submitRegistration(env: Env, user: AuthorizedUser): Promise<{ ok: true }> {
  requireSupabase(env);
  const t = await loadTrialist(env, user.personId);
  const d = db(env);
  const [p, photo] = await Promise.all([
    d.one<Record<string, unknown>>("people", `select=*&id=${eq(t.id)}`),
    d.one<{ id: string }>("files", `select=id&person_id=${eq(t.id)}&family_member_id=is.null&kind=eq.photo&limit=1`),
  ]);
  const gaps = registrationGaps(p ?? {}, !!photo, hkDateKey(new Date().toISOString()));
  if (gaps.length) throw new HttpError(`Not quite finished:\n${gaps.map((g) => `• ${g}`).join("\n")}`, 400, "INCOMPLETE");
  const first = !t.trial_registered_at;
  await d.update("people", `id=${eq(t.id)}`, { trial_registered_at: new Date().toISOString() });
  await invalidateForTables(env, [TABLES.player]);
  if (first) await tellCaptains(env, t, p ?? {}).catch((err) => console.error("Registration email not sent:", err instanceof Error ? err.message : err));
  return { ok: true };
}

async function captainMailboxes(env: Env): Promise<{ emails: string[]; personId: string | null }> {
  const rows = await db(env).select<{ office_email: string | null; person_id: string | null }>("offices", "select=office_email,person_id&role=eq.section_captain&status=eq.Active");
  return { emails: [...new Set(rows.map((r) => r.office_email).filter((e): e is string => !!e))], personId: rows[0]?.person_id ?? null };
}

async function tellCaptains(env: Env, t: TrialistRow, p: Record<string, unknown>): Promise<void> {
  const { emails, personId } = await captainMailboxes(env);
  if (!emails.length || !personId) return;
  const name = nameOf(p as never) || "Someone";
  const [referredBy, chosen] = await Promise.all([
    referrerName(env, t.referred_by_id),
    db(env).select<{ trial_sessions: { starts_at: string; place: string } | null }>(
      "trial_availability",
      `select=trial_sessions(starts_at,place)&person_id=${eq(t.id)}`,
      AVAILABILITY_KEY,
    ),
  ]);
  const sessions = chosen.map((c) => c.trial_sessions).filter((s): s is { starts_at: string; place: string } => !!s);
  await sendEmail(env, {
    toPersonId: personId,
    to: emails[0],
    cc: emails.slice(1),
    subject: `Registered to join: ${name}`,
    text: [
      `${name} has registered their interest in joining the Hockey Section${referredBy ? `, through ${referredBy}'s link` : ""}.`,
      "",
      `Position: ${p.playing_position ?? "–"}`,
      `Level they think they play at: ${Array.isArray(p.playing_level) && p.playing_level.length ? (p.playing_level as string[]).join(", ") : "–"}`,
      `Qualified umpire: ${p.qualified_umpire ?? "–"}`,
      sessions.length ? `Trial sessions they can come to: ${sessions.map((s) => `${hkDateKey(s.starts_at)} (${s.place})`).join("; ")}` : "No trial sessions chosen.",
      "",
      "Their hockey CV and what to do next (practice trial, propose as a new joiner, or not this time):",
      `${appOrigin(env)}/joiners/${t.api_id}`,
      "",
      "Eddy",
    ].join("\n"),
    template: "trial-registered",
  });
}

// ── Section Captains ─────────────────────────────────────────────────────

export async function listSessions(env: Env, user: AuthorizedUser): Promise<{ sessions: (TrialSession & { count: number })[] }> {
  requireCaptain(env, user);
  const d = db(env);
  // This season's, from a month back.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = await d.select<SessionRow & { trial_availability: { person_id: string }[] }>(
    "trial_sessions",
    `select=id,starts_at,place,notes,trial_availability(person_id)&starts_at=gte.${encodeURIComponent(since)}&order=starts_at`,
  );
  return { sessions: rows.map((r) => ({ ...toSession(r), count: r.trial_availability?.length ?? 0 })) };
}

export async function addSession(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ id: string }> {
  requireCaptain(env, user);
  const startsAt = text(body.startsAt, 40);
  const place = text(body.place, 120);
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) throw new HttpError("Give the date and time.", 400, "INVALID_INPUT");
  if (Date.parse(startsAt) < Date.now()) throw new HttpError("That's in the past.", 400, "INVALID_INPUT");
  if (!place) throw new HttpError("Give the place.", 400, "INVALID_INPUT");
  const me = await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(user.personId)}`);
  const [row] = await db(env).insert<{ id: string }>("trial_sessions", [
    { starts_at: new Date(startsAt).toISOString(), place, notes: text(body.notes, 300) || null, created_by: me?.id ?? null },
  ]);
  return { id: row.id };
}

export async function removeSession(env: Env, user: AuthorizedUser, id: string): Promise<{ ok: true }> {
  requireCaptain(env, user);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError("Session not found.", 404, "NOT_FOUND");
  await db(env).remove("trial_sessions", `id=${eq(id)}`);
  return { ok: true };
}

/** The trial part of the captain's view of a stage-1 registrant (joiners.ts getJoiner). */
export async function joinerTrial(env: Env, personId: string): Promise<JoinerTrial> {
  const d = db(env);
  const [p, chosen, invites] = await Promise.all([
    d.one<{ trial_registered_at: string | null; referred_by_id: string | null }>("people", `select=trial_registered_at,referred_by_id&id=${eq(personId)}`),
    d.select<{ trial_sessions: { starts_at: string; place: string } | null }>(
      "trial_availability",
      `select=trial_sessions(starts_at,place)&person_id=${eq(personId)}`,
      AVAILABILITY_KEY,
    ),
    d.select<{ sent_at: string }>("email_log", `select=sent_at&template=eq.trial-practice-player&status=eq.sent&to_person_id=${eq(personId)}&order=sent_at.desc&limit=1`),
  ]);
  return {
    registeredAt: p?.trial_registered_at ?? null,
    referredBy: await referrerName(env, p?.referred_by_id ?? null),
    sessions: chosen
      .map((c) => c.trial_sessions)
      .filter((s): s is { starts_at: string; place: string } => !!s)
      .map((s) => ({ startsAt: s.starts_at, place: s.place })),
    practiceInvitedAt: invites[0]?.sent_at ?? null,
  };
}

const addressOf = (v: string) => v.match(/<([^>]+)>/)?.[1] ?? v.trim();
const displayName = (v: string) => v.match(/^\s*([^<]+?)\s*</)?.[1] ?? null;

/**
 * A practice trial: the Assistant Director of Hockey and the coach of the
 * team the captain picks get the player's hockey CV, and the player is told
 * when and where to come.
 */
export async function invitePracticeTrial(env: Env, actor: AuthorizedUser, apiId: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  requireCaptain(env, actor);
  const team = text(body.team, 60);
  const when = text(body.when, 300);
  if (!team) throw new HttpError("Choose the team.", 400, "INVALID_INPUT");
  if (!when) throw new HttpError("Say when and where they should come.", 400, "INVALID_INPUT");
  const d = db(env);
  const p = await d.one<Record<string, unknown> & { id: string; email: string | null; applicant_stage: string | null }>("people", `select=*&api_id=${eq(apiId)}`);
  if (!p) throw new HttpError("That person was not found.", 404, "NOT_FOUND");
  if (p.applicant_stage !== TRIAL_STAGE) throw new HttpError("Practice trials are for people who have registered to join.", 409, "NOT_A_TRIALIST");
  if (!p.email) throw new HttpError("They have no email address.", 400, "INVALID_INPUT");
  const teamRow = await d.one<{ id: string; team_name: string }>("teams", `select=id,team_name&team_name=${eq(team)}`);
  if (!teamRow) throw new HttpError("Choose the team from the list.", 400, "INVALID_INPUT");
  const coaches = await d.select<{ people: { id: string; email: string | null; preferred_name: string | null; given_names: string | null } | null }>(
    "team_people",
    `select=people(id,email,preferred_name,given_names)&team_id=${eq(teamRow.id)}&role=eq.coach`,
    "team_id,role,person_id",
  );
  const coachList = coaches.map((c) => c.people).filter((c): c is NonNullable<typeof c> => !!c?.email);
  const adh = env.ASSISTANT_DIRECTOR || "";
  const to = [...(adh ? [addressOf(adh)] : []), ...coachList.map((c) => c.email!)];
  if (!to.length) throw new HttpError(`Neither the Assistant Director of Hockey nor a ${team} coach has an email address in Eddy.`, 400, "INVALID_INPUT");

  const captain = await d.one<{ preferred_name: string | null; given_names: string | null; surname: string | null; offices: { office_email: string | null; designation: string | null; role: string }[] }>(
    "people",
    `select=preferred_name,given_names,surname,offices!offices_person_id_fkey(office_email,designation,role)&api_id=${eq(actor.personId)}`,
  );
  const own = captain?.offices.find((o) => o.role === "section_captain");
  const captainName = captain ? nameOf(captain) : "HKFC Hockey";
  const from = own?.office_email?.endsWith("@hkfchockey.com") ? `${captainName} <${own.office_email}>` : env.REVIEW_EMAIL_FROM || undefined;
  const name = nameOf(p as never) || "the player";
  const first = (p.preferred_name as string) || (p.given_names as string) || "there";
  const greeting = [displayName(adh)?.split(" ")[0], ...coachList.map((c) => c.preferred_name || c.given_names)].filter(Boolean).join(" and ") || "all";
  const visiting = !p.hkid_no && p.passport_no ? " (no HKID: a visiting player)" : "";
  const coachTo = coachList[0];

  await sendEmail(env, {
    toPersonId: coachTo?.id ?? p.id,
    to: to[0],
    cc: to.slice(1),
    subject: `Practice trial: ${name}`,
    text: [
      `Dear ${greeting},`,
      "",
      `${name} would like to join us, and we'd like to see them at a ${team} practice: ${when}`,
      "",
      "Their hockey CV:",
      `- Position: ${p.playing_position ?? "–"}`,
      `- Level they think they play at: ${Array.isArray(p.playing_level) && p.playing_level.length ? (p.playing_level as string[]).join(", ") : "–"}`,
      `- Qualified umpire: ${p.qualified_umpire ?? "–"}; qualified coach: ${p.qualified_coach ?? "–"}`,
      `- Nationality: ${p.nationality ?? "–"}${visiting}`,
      `- Sports background: ${p.sports_background ?? "–"}`,
      "",
      `Mobile: ${p.mobile_no ?? "–"}`,
      "",
      "Many thanks,",
      captainName.split(" ")[0],
    ].join("\n"),
    template: "trial-practice-coach",
    from,
  });
  await sendEmail(env, {
    toPersonId: p.id,
    to: p.email,
    subject: "Come and train with us",
    text: [
      `Dear ${first},`,
      "",
      `Thanks for registering your interest in joining HKFC Hockey. We'd like you to come down to a practice: ${when}`,
      "",
      `Our Assistant Director of Hockey${coachList.length ? " and the team's coach" : ""} will be expecting you. Bring your stick, shin pads and mouthguard.`,
      "",
      "Best regards,",
      captainName,
      own?.designation ? `${own.designation} – HKFC Hockey Section` : "HKFC Hockey Section",
    ].join("\n"),
    template: "trial-practice-player",
    from,
  });
  const me = await d.one<{ id: string }>("people", `select=id&api_id=${eq(actor.personId)}`);
  await d.insert("activity_log", [{ actor_person_id: me?.id ?? null, action: "trial-practice-invite", entity: "people", entity_id: p.id, fields: [team] }]).catch(() => undefined);
  return { ok: true };
}

/** Not this time: the registration is parked (Rejected) without an email; the captain gets in touch themselves. */
export async function declineRegistration(env: Env, actor: AuthorizedUser, apiId: string): Promise<{ ok: true }> {
  requireCaptain(env, actor);
  const d = db(env);
  const p = await d.one<{ id: string; applicant_stage: string | null }>("people", `select=id,applicant_stage&api_id=${eq(apiId)}`);
  if (!p) throw new HttpError("That person was not found.", 404, "NOT_FOUND");
  if (p.applicant_stage !== TRIAL_STAGE) throw new HttpError("Only a registration at stage 1 can be closed here.", 409, "NOT_A_TRIALIST");
  await d.update("people", `id=${eq(p.id)}`, { applicant_stage: "Rejected" });
  const me = await d.one<{ id: string }>("people", `select=id&api_id=${eq(actor.personId)}`);
  await d.insert("activity_log", [{ actor_person_id: me?.id ?? null, action: "trial-declined", entity: "people", entity_id: p.id, fields: ["applicant_stage"] }]).catch(() => undefined);
  await invalidateForTables(env, [TABLES.player]);
  return { ok: true };
}
