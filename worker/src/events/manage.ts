import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq, inList } from "../data/supabase";
import { photoLink } from "../data/supabase/files";
import { invalidateCache, invalidateCachePrefix } from "../cache";
import { managesEvent } from "../eventAccess";
import { uploadBytes } from "../details";
import { groupOptions, matches, type DirectoryPerson } from "../../../shared/emailLists";
import {
  DEFAULT_AUDIENCE,
  EVENT_GROUP_KEYS,
  EVENT_TYPES,
  PAYMENT_MODES_OFFERED,
  SOCIAL_FUNCTIONS,
  billed,
  cleanLink,
  cleanQuestions,
  cleanAudience,
  effectiveAudience,
  type EventInput,
  type EventResponseRow,
  type EventResponses,
  type EventStatus,
  type EventType,
  type Guest,
  type ManageView,
  type ManagedEvent,
  type PaymentMode,
  type ResponseStatus,
} from "../../../shared/events";
import {
  text,
  type NameParts,
  nameOf,
  type EventRow,
  EVENT_COLS,
  type ResponseRow,
  RESPONSE_COLS,
  RESPONSE_KEY,
  toDetails,
  toResponse,
  directory,
  invitedFrom,
  posterLinks,
  requireManager,
  requireManages,
} from "./shared";
import { newCheckinCode } from "./register";

// ── Social secretaries and Section Captains ──────────────────────────────

const pick = <K extends string>(keys: readonly K[]) => (o: Record<string, string[]>) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) as Record<string, string[]>;

function counts(rs: { status: ResponseStatus; guests: Guest[] | null; can_help: boolean; attended?: boolean }[]): ManagedEvent["counts"] {
  const c = { going: 0, maybe: 0, notGoing: 0, adultGuests: 0, childGuests: 0, canHelp: 0, came: 0 };
  for (const r of rs) {
    if (r.status === "going") c.going++;
    else if (r.status === "maybe") c.maybe++;
    else c.notGoing++;
    if (r.status === "going") {
      for (const g of r.guests ?? []) {
        if (g.age === "child") c.childGuests++;
        else c.adultGuests++;
      }
    }
    if (r.can_help) c.canHelp++;
    if (r.attended) c.came++;
  }
  return c;
}

function toManaged(r: EventRow & { event_responses?: ResponseRow[] }, poster: string | null, dir: DirectoryPerson[], viewer: string): ManagedEvent {
  const invited = invitedFrom(dir, r);
  return {
    ...toDetails(r, poster),
    audience: cleanAudience(r.audience),
    invited: invited.length,
    includesMe: invited.some((p) => p.id === viewer),
    chargesSentAt: r.charges_sent_at,
    registerTakenAt: r.register_taken_at,
    counts: counts(r.event_responses ?? []),
  };
}

async function activeTeams(env: Env): Promise<{ id: string; api_id: string; team_name: string }[]> {
  return db(env).select("teams", "select=id,api_id,team_name&active=eq.true&order=team_rank");
}

/** The Events screen: their events from the last two months on, and what the form needs. */
export async function getManageView(env: Env, user: AuthorizedUser): Promise<ManageView> {
  const rights = await requireManager(env, user);
  const d = db(env);
  const since = encodeURIComponent(new Date(Date.now() - 60 * 86_400_000).toISOString());
  const scope = rights.club ? "" : `&team_id=${inList(rights.teams.map((t) => t.id))}`;
  const [rows, dir, teams] = await Promise.all([
    d.select<EventRow & { event_responses: ResponseRow[] }>(
      "events",
      `select=${EVENT_COLS},event_responses(status,guests,can_help,attended)&starts_at=gte.${since}${scope}&order=starts_at`,
    ),
    directory(env),
    rights.club ? activeTeams(env) : Promise.resolve([]),
  ]);
  const posters = await posterLinks(env, rows.map((r) => r.id));
  let socialSecretaries: ManageView["socialSecretaries"] = [];
  if (rights.club) {
    const held = await d.select<{ team_id: string; people: (NameParts & { api_id: string }) | null }>(
      "team_people",
      "select=team_id,people(api_id,preferred_name,given_names,surname)&role=eq.social_secretary",
      "team_id,role,person_id",
    );
    socialSecretaries = teams.map((t) => ({
      team: t.team_name,
      teamId: t.id,
      people: held.filter((h) => h.team_id === t.id && h.people).map((h) => ({ personId: h.people!.api_id, name: nameOf(h.people) })),
    }));
  }
  return {
    events: rows.map((r) => toManaged(r, posters[r.id] ?? null, dir, user.personId)),
    club: rights.club,
    teams: rights.club ? teams.map((t) => t.team_name) : rights.teams.map((t) => t.name),
    groups: pick(EVENT_GROUP_KEYS)(groupOptions(dir)),
    socialSecretaries,
  };
}

const toIso = (v: unknown, label: string, required: boolean): string | null => {
  const s = text(v, 40);
  if (!s) {
    if (required) throw new HttpError(`Give the ${label}.`, 400, "INVALID_INPUT");
    return null;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new HttpError(`The ${label} wasn't understood.`, 400, "INVALID_INPUT");
  return new Date(t).toISOString();
};

const toPrice = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999) throw new HttpError("Prices are in Hong Kong dollars, 0 or more.", 400, "INVALID_INPUT");
  return Math.round(n * 100) / 100;
};

/** The columns an EventInput sets, checked. */
export function eventColumns(body: Partial<EventInput>): Record<string, unknown> {
  const type = body.type as EventType;
  if (!EVENT_TYPES.includes(type)) throw new HttpError("Choose the type of event.", 400, "INVALID_INPUT");
  const title = text(body.title, 120);
  if (!title) throw new HttpError("Give the event a title.", 400, "INVALID_INPUT");
  const startsAt = toIso(body.startsAt, "start date and time", true)!;
  const endsAt = toIso(body.endsAt, "end date and time", false);
  if (endsAt && endsAt < startsAt) throw new HttpError("It can't end before it starts.", 400, "INVALID_INPUT");
  const respondBy = toIso(body.respondBy, "deadline", false);
  if (respondBy && respondBy > (endsAt ?? startsAt)) throw new HttpError("The deadline must be before the event ends.", 400, "INVALID_INPUT");
  const paymentMode = (body.paymentMode ?? "free") as PaymentMode;
  if (!PAYMENT_MODES_OFFERED.includes(paymentMode)) throw new HttpError("Choose how it's paid for.", 400, "INVALID_INPUT");
  const guestsAllowed = body.guestsAllowed === true;
  const max = guestsAllowed ? Number(body.maxGuests ?? 1) : null;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 10)) throw new HttpError("Guests per person: 1 to 10.", 400, "INVALID_INPUT");
  const socialFunction = type === "social_function" && body.socialFunction ? body.socialFunction : null;
  if (socialFunction && !(SOCIAL_FUNCTIONS as readonly string[]).includes(socialFunction)) throw new HttpError("Choose the social function from the list.", 400, "INVALID_INPUT");
  // Free and self-funded bill nobody; self-funded may show an estimated cost per person.
  const free = !billed(paymentMode);
  const link = cleanLink(body.linkUrl);
  if (link && typeof link === "object") throw new HttpError(link.error, 400, "INVALID_INPUT");
  const paymentDetails = paymentMode === "payme_fps" ? text(body.paymentDetails, 300) : "";
  if (paymentMode === "payme_fps" && !paymentDetails) throw new HttpError("Give the PayMe link or FPS ID people should pay to.", 400, "INVALID_INPUT");
  return {
    event_type: type,
    title,
    description: text(body.description, 2000) || null,
    location: text(body.location, 200) || null,
    starts_at: startsAt,
    ends_at: endsAt,
    respond_by: respondBy,
    member_price: paymentMode === "free" ? null : toPrice(body.memberPrice),
    guest_adult_price: free || !guestsAllowed ? null : toPrice(body.guestAdultPrice),
    guest_child_price: free || !guestsAllowed ? null : toPrice(body.guestChildPrice),
    payment_mode: paymentMode,
    payment_details: paymentDetails || null,
    link_url: link,
    guests_allowed: guestsAllowed,
    max_guests: max,
    help_needed: text(body.helpNeeded, 200) || null,
    questions: cleanQuestions(body.questions),
    social_function: socialFunction,
    audience: body.audience === undefined ? DEFAULT_AUDIENCE : cleanAudience(body.audience),
  };
}

/** Creates an event (a draft) or saves changes to one. */
export async function saveEvent(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ id: string }> {
  const rights = await requireManager(env, user);
  const d = db(env);
  const cols = eventColumns(body as Partial<EventInput>);
  const teamName = text(body.team, 60);
  let teamId: string | null = null;
  if (teamName) {
    const t = await d.one<{ id: string }>("teams", `select=id&team_name=${eq(teamName)}`);
    if (!t) throw new HttpError("Choose the team from the list.", 400, "INVALID_INPUT");
    teamId = t.id;
  }
  if (!managesEvent(rights, { team_id: teamId })) {
    throw new HttpError(teamId ? "You can only add events for your own team." : "Choose your team: club-wide events are added by the Social Secretary or a Section Captain.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  const id = text(body.id, 40);
  if (id) {
    const { event } = await requireManages(env, user, id);
    await d.update("events", `id=${eq(event.id)}`, { ...cols, team_id: teamId });
    invalidateCachePrefix("event-tasks:");
    invalidateCache("events:open");
    return { id: event.id };
  }
  if (Date.parse(cols.starts_at as string) < Date.now()) throw new HttpError("That's in the past.", 400, "INVALID_INPUT");
  const [row] = await d.insert<{ id: string }>("events", [{ ...cols, team_id: teamId, status: "draft", created_by: rights.personUuid || null, checkin_code: newCheckinCode() }]);
  return { id: row.id };
}

/** Publish, cancel, or back to draft (only while nobody has answered). */
export async function setEventStatus(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  const status = body.status as EventStatus;
  if (!["draft", "published", "cancelled"].includes(status)) throw new HttpError("Unknown status.", 400, "INVALID_INPUT");
  const d = db(env);
  if (status === "draft") {
    const any = await d.one<{ event_id: string }>("event_responses", `select=event_id&event_id=${eq(event.id)}&limit=1`);
    if (any) throw new HttpError("People have already answered: cancel it instead.", 409, "HAS_RESPONSES");
  }
  await d.update("events", `id=${eq(event.id)}`, { status });
  invalidateCachePrefix("event-tasks:");
  invalidateCache("events:open");
  return { ok: true };
}

/** Only a draft can be deleted, poster and all. */
export async function deleteEvent(env: Env, user: AuthorizedUser, id: string): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  if (event.status !== "draft") throw new HttpError("Only a draft can be deleted: cancel it instead.", 409, "NOT_DRAFT");
  const d = db(env);
  const files = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&event_id=${eq(event.id)}`);
  await d.remove("events", `id=${eq(event.id)}`);
  if (env.FILES) await Promise.all(files.map((f) => env.FILES!.delete(f.r2_key)));
  return { ok: true };
}

/** Replaces the poster: the new picture is stored and the old one removed. */
export async function uploadPoster(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ url: string }> {
  const { event } = await requireManages(env, user, id);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const { bytes, type } = uploadBytes("photo", body.dataUrl);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const d = db(env);
  const old = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&event_id=${eq(event.id)}&kind=eq.event_poster`);
  const key = `events/${event.id}/poster/${crypto.randomUUID()}.${ext}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [
    { r2_key: key, kind: "event_poster", event_id: event.id, filename: `poster.${ext}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  if (old.length) {
    await d.remove("files", `id=${inList(old.map((o) => o.id))}`);
    await Promise.all(old.map((o) => env.FILES!.delete(o.r2_key)));
  }
  return { url: await photoLink(env, file.id) };
}

/** Everyone's answers, and who hasn't answered yet. */
export async function getEventResponses(env: Env, user: AuthorizedUser, id: string): Promise<EventResponses> {
  const { event } = await requireManages(env, user, id);
  const [rows, dir, posters] = await Promise.all([
    db(env).select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}`, RESPONSE_KEY),
    directory(env),
    posterLinks(env, [event.id]),
  ]);
  const responses: EventResponseRow[] = rows
    .map((r) => ({ personId: r.person?.api_id ?? "", name: nameOf(r.person), membershipNo: r.person?.membership_no ?? null, updatedAt: r.updated_at, ...toResponse(r) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const answered = new Set(responses.map((r) => r.personId));
  const notAnswered = event.status === "draft" ? [] : invitedFrom(dir, event).filter((p) => !answered.has(p.id)).map((p) => ({ personId: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { event: toManaged({ ...event, event_responses: rows }, posters[event.id] ?? null, dir, user.personId), responses, notAnswered };
}

/** How many a set of groups invites, as the form changes. */
export async function countAudience(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ count: number }> {
  await requireManager(env, user);
  const teamName = text(body.team, 60) || null;
  const audience = effectiveAudience(cleanAudience(body.audience), teamName);
  return { count: (await directory(env)).filter((p) => matches(p, audience)).length };
}

/** Anyone in the directory by name (club managers, to name social secretaries). */
export async function findPeople(env: Env, user: AuthorizedUser, q: string): Promise<{ people: { personId: string; name: string; team: string | null }[] }> {
  const rights = await requireManager(env, user);
  if (!rights.club) throw new HttpError("This is for the Social Secretary and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (q.trim().length < 2) return { people: [] };
  const found = (await directory(env))
    .filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 15);
  return { people: found.map((p) => ({ personId: p.id, name: p.name, team: p.values.team?.[0] ?? null })) };
}

/** A team's social secretaries, replacing the list (club managers). */
export async function setSocialSecretaries(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true }> {
  const rights = await requireManager(env, user);
  if (!rights.club) throw new HttpError("This is for the Social Secretary and Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  const d = db(env);
  const team = await d.one<{ api_id: string }>("teams", `select=api_id&team_name=${eq(text(body.team, 60))}`);
  if (!team) throw new HttpError("Choose the team from the list.", 400, "INVALID_INPUT");
  const ids = Array.isArray(body.personIds) ? [...new Set(body.personIds.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length > 5) throw new HttpError("Up to 5 social secretaries a team.", 400, "INVALID_INPUT");
  const dir = await directory(env);
  if (ids.some((id) => !dir.some((p) => p.id === id))) throw new HttpError("Choose people from the search.", 400, "INVALID_INPUT");
  await d.rpc("set_team_people", { p_team: team.api_id, p_role: "social_secretary", p_people: ids });
  return { ok: true };
}
