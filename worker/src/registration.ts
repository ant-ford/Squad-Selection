/**
 * The Hockey Convenor's HKHA registration screen: every
 * Active player's registration details grouped by registered team, who
 * still needs registering with HockeyHK this season and why, and a CSV of
 * the details. See shared/registration.ts for the rules.
 *
 * Gated on the "registration" section (auth.ts), which only the Hockey
 * Convenor office opens: the screen carries HKID and passport numbers.
 * Downloads and tick-offs go in activity_log (field names only).
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, inList } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { currentSeason } from "./seasonContext";
import { hkDateKey } from "../../shared/hkDateKey";
import { toCsv } from "../../shared/csv";
import {
  REGISTRATION_CSV_HEADER,
  registrationCsvRow,
  type RegistrationBoard,
  type RegistrationPlayer,
  type RegistrationReason,
} from "../../shared/registration";

interface PersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  registered_name: string | null;
  chinese_name: string | null;
  date_of_birth: string | null;
  hkid_no: string | null;
  passport_no: string | null;
  nationality: string | null;
  mobile_no: string | null;
  email: string | null;
  registered_team: string | null;
  previous_eos: string | null;
  shirt: { shirt_no: number } | null;
}

const PERSON_COLUMNS =
  "id,api_id,preferred_name,given_names,surname,registered_name,chinese_name,date_of_birth,hkid_no,passport_no,nationality,mobile_no,email,registered_team,previous_eos,shirt:shirt_numbers(shirt_no)";

interface RegistrationRow {
  person_id: string;
  team: string;
  registered_at: string;
}

interface EventRow {
  person_id: string;
  previous_team: string;
  new_team: string | null;
  created_at: string;
}

const FILE_KINDS = { photo: "photo", hkid: "hkid", passport: "passport", u18_registration_form: "u18Form" } as const;

const dayMonth = (iso: string) => {
  const [, m, d] = hkDateKey(iso).split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
};

/** Why someone with no tick for this season and their current team is on the list. */
export function reasonFor(
  p: Pick<PersonRow, "registered_team" | "previous_eos">,
  thisSeason: RegistrationRow[],
  events: EventRow[],
): { reason: RegistrationReason; detail: string | null } {
  const moveUp = events.filter((e) => e.new_team === p.registered_team).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (moveUp) return { reason: "playUps", detail: `From ${moveUp.previous_team}, ${dayMonth(moveUp.created_at)}` };
  const earlier = [...thisSeason].sort((a, b) => b.registered_at.localeCompare(a.registered_at))[0];
  if (earlier) return { reason: "moved", detail: `Registered for ${earlier.team} on ${dayMonth(earlier.registered_at)}` };
  if (!p.previous_eos) return { reason: "new", detail: null };
  return { reason: "season", detail: null };
}

const teamOrder = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));

export async function getRegistrationBoard(env: Env): Promise<RegistrationBoard> {
  const d = db(env);
  const season = currentSeason();
  const [people, registrations, events, files] = await Promise.all([
    d.select<PersonRow>("people", `select=${PERSON_COLUMNS}&active=is.true`),
    d.select<RegistrationRow>("hkha_registrations", `select=person_id,team,registered_at&season=${eq(season)}`),
    d.select<EventRow>("registration_events", `select=person_id,previous_team,new_team,created_at&season=${eq(season)}&status=eq.applied`),
    d.select<{ id: string; person_id: string; kind: keyof typeof FILE_KINDS }>(
      "files",
      `select=id,person_id,kind,created_at&family_member_id=is.null&kind=in.(${Object.keys(FILE_KINDS).join(",")})&order=created_at.desc`,
    ),
  ]);

  const active = new Set(people.map((p) => p.id));
  // The newest of each kind per person (the list is newest first).
  const latest = new Map<string, string>();
  for (const f of files) {
    if (active.has(f.person_id) && !latest.has(`${f.person_id}:${f.kind}`)) latest.set(`${f.person_id}:${f.kind}`, f.id);
  }
  const link = async (personId: string, kind: keyof typeof FILE_KINDS) => {
    const id = latest.get(`${personId}:${kind}`);
    return id ? fileLink(env, id) : null;
  };

  const players = await Promise.all(
    people.map(async (p): Promise<RegistrationPlayer> => {
      const mine = registrations.filter((r) => r.person_id === p.id);
      const done = mine.find((r) => r.team === p.registered_team);
      const why = done ? null : reasonFor(p, mine, events.filter((e) => e.person_id === p.id));
      const [photo, hkid, passport, u18Form] = await Promise.all([
        link(p.id, "photo"),
        link(p.id, "hkid"),
        link(p.id, "passport"),
        link(p.id, "u18_registration_form"),
      ]);
      return {
        id: p.api_id,
        name: [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "(no name)",
        team: p.registered_team || null,
        previousEos: p.previous_eos || null,
        shirtNo: p.shirt?.shirt_no ?? null,
        registeredName: p.registered_name || null,
        surname: p.surname || null,
        givenNames: p.given_names || null,
        chineseName: p.chinese_name || null,
        hkidNo: p.hkid_no || null,
        passportNo: p.passport_no || null,
        dateOfBirth: p.date_of_birth || null,
        nationality: p.nationality || null,
        mobileNo: p.mobile_no || null,
        email: p.email || null,
        files: { photo, hkid, passport, u18Form },
        registeredAt: done?.registered_at ?? null,
        reason: why?.reason ?? null,
        reasonDetail: why?.detail ?? null,
      };
    }),
  );
  players.sort((a, b) => teamOrder(a.team, b.team) || (a.surname ?? "").localeCompare(b.surname ?? "") || a.name.localeCompare(b.name));
  return { season, players };
}

async function actorUuid(env: Env, actor: AuthorizedUser): Promise<string | null> {
  return (await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(actor.personId)}`))?.id ?? null;
}

/** One activity_log row per entity, in a single write (a whole team is one request, not forty). */
async function log(env: Env, actorId: string | null, action: string, entityIds: (string | null)[], fields: string[]) {
  await db(env)
    .insert("activity_log", entityIds.map((entityId) => ({ actor_person_id: actorId, action, entity: "people", entity_id: entityId, fields })))
    .catch((err) => console.error("activity_log write failed:", err instanceof Error ? err.message : err));
}

/**
 * The details as a CSV for HockeyHK's registration spreadsheet: everyone,
 * or only those who still need registering, optionally for one team. The
 * file leaves the app with ID numbers in it, so the download is logged.
 */
export async function registrationCsv(
  env: Env,
  actor: AuthorizedUser,
  opts: { todo: boolean; team: string | null },
): Promise<{ filename: string; csv: string; count: number }> {
  const board = await getRegistrationBoard(env);
  const rows = board.players.filter((p) => (!opts.todo || p.reason) && (!opts.team || p.team === opts.team));
  const csv = toCsv([REGISTRATION_CSV_HEADER, ...rows.map(registrationCsvRow)]);
  const what = [opts.todo ? "needs registering" : "all", opts.team].filter(Boolean).join(", ");
  await log(env, await actorUuid(env, actor), "registration-export", [null], [`${rows.length} rows (${what})`, ...REGISTRATION_CSV_HEADER]);
  const today = hkDateKey(new Date().toISOString());
  const slug = [opts.team?.replace(/\s+/g, "-").toLowerCase(), opts.todo ? "to-register" : null].filter(Boolean).join("-");
  return { filename: `hkha-registration-${slug ? `${slug}-` : ""}${today}.csv`, csv, count: rows.length };
}

/**
 * Records that a player was registered with HockeyHK this season for the
 * team they're registered to now. Already recorded is fine (nothing
 * changes). Used by the screen and by a new joiner's registration task.
 */
export async function recordRegistered(env: Env, personIds: string[], byPersonId: string | null): Promise<number> {
  if (personIds.length === 0) return 0;
  const d = db(env);
  const season = currentSeason();
  const [people, existing] = await Promise.all([
    d.select<{ id: string; registered_team: string | null }>("people", `select=id,registered_team&id=in.(${personIds.join(",")})`),
    d.select<RegistrationRow>("hkha_registrations", `select=person_id,team,registered_at&season=${eq(season)}&person_id=in.(${personIds.join(",")})`),
  ]);
  const rows = people
    .filter((p) => p.registered_team && !existing.some((r) => r.person_id === p.id && r.team === p.registered_team))
    .map((p) => ({ person_id: p.id, season, team: p.registered_team, registered_by_person_id: byPersonId }));
  await d.insert("hkha_registrations", rows);
  return rows.length;
}

const apiIds = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id)).slice(0, 300);

/** Ticks players off as registered for this season (one, or a whole team at once). */
export async function markRegistered(env: Env, actor: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true; count: number }> {
  const ids = apiIds(body.ids);
  if (ids.length === 0) throw new HttpError("Choose who's been registered.", 400, "INVALID_INPUT");
  const d = db(env);
  const [people, me] = await Promise.all([
    d.select<{ id: string }>("people", `select=id&active=is.true&api_id=${inList(ids)}`),
    actorUuid(env, actor),
  ]);
  const count = await recordRegistered(env, people.map((p) => p.id), me);
  await log(env, me, "registration-registered", people.map((p) => p.id), ["hkha_registrations"]);
  return { ok: true, count };
}

/** Takes a tick back off (ticked by mistake): they need registering again. */
export async function unmarkRegistered(env: Env, actor: AuthorizedUser, body: Record<string, unknown>): Promise<{ ok: true }> {
  const [id] = apiIds([body.id]);
  if (!id) throw new HttpError("Choose a player.", 400, "INVALID_INPUT");
  const d = db(env);
  const p = await d.one<{ id: string; registered_team: string | null }>("people", `select=id,registered_team&api_id=${eq(id)}`);
  if (!p?.registered_team) throw new HttpError("Player not found.", 404, "NOT_FOUND");
  await d.remove("hkha_registrations", `person_id=${eq(p.id)}&season=${eq(currentSeason())}&team=${eq(p.registered_team)}`);
  await log(env, await actorUuid(env, actor), "registration-unregistered", [p.id], ["hkha_registrations"]);
  return { ok: true };
}
