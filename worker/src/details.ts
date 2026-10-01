/**
 * The personal-details sections (Supabase backend), shared by the member
 * details update and the new joiner form: read them, save one section at a
 * time, upload a photo or HKID copy, kit sizes, and "confirm" at the end of
 * the start-of-season check. The questions are shared/profile.ts.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq } from "./data/supabase";
import { fileLink } from "./data/supabase/files";
import { invalidateForTables } from "./airtableWebhook";
import { invalidateCache } from "./cache";
import { isUnderEighteen } from "./declarations";
import { TABLES } from "../../shared/schema/tableNames";
import { hkDateKey } from "../../shared/hkDateKey";
import { KIT_SIZE_OPTIONS, type KitSizes } from "../../shared/kit";
import {
  PROFILE_SECTIONS,
  audienceOf,
  checkValue,
  fieldsFor,
  normaliseValue,
  sectionFor,
  sectionProblem,
  type Audience,
  type MyDetails,
  type ProfileValues,
  type SectionKey,
} from "../../shared/profile";

const ALL_FIELDS = PROFILE_SECTIONS.flatMap((s) => s.fields);

const PERSON_COLUMNS = [
  "id,api_id,status,applicant_type,email,playing_position,shirt_number_id,profile_updated_at",
  "member_type,category_type,player_coach,membership_no,join_date,commitment_end_date",
  ...ALL_FIELDS.map((f) => f.column),
].join(",");

type PersonRow = Record<string, unknown> & {
  id: string;
  api_id: string;
  status: string | null;
  applicant_type: string | null;
  email: string | null;
  date_of_birth: string | null;
  playing_position: string | null;
  shirt_number_id: string | null;
  profile_updated_at: string | null;
};

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Your details move into Eddy at the switch-over. Until then, use the member details form link.", 409, "NOT_YET");
  }
}

const today = () => hkDateKey(new Date().toISOString());
const isApplicant = (p: PersonRow) => p.status === "Applicant";
const audience = (p: PersonRow) => audienceOf(p.status, p.applicant_type);

async function loadPerson(env: Env, personApiId: string): Promise<PersonRow> {
  const row = await db(env).one<PersonRow>("people", `select=${PERSON_COLUMNS}&api_id=${eq(personApiId)}`);
  if (!row) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  return row;
}

const KIT_ITEM_COLUMN: Record<keyof KitSizes, string> = {
  shirt: "shirt",
  shorts: "shorts",
  socks: "socks",
  goalieSmock: "goalie_smock",
  goalieSmockStyle: "goalie_smock_style",
};

/** The supplier kit is being ordered from now: the latest order's. */
async function currentSupplier(env: Env): Promise<string | null> {
  const order = await db(env).one<{ supplier: string }>("kit_orders", "select=id,supplier&order=ordered_on.desc.nullslast&limit=1");
  return order?.supplier ?? null;
}

async function loadKit(env: Env, p: PersonRow): Promise<MyDetails["kit"]> {
  const supplier = await currentSupplier(env);
  if (!supplier) return null;
  const d = db(env);
  const [rows, printed] = await Promise.all([
    d.select<{ item: string; size: string | null }>("kit_sizes", `select=id,item,size&person_id=${eq(p.id)}&supplier=${eq(supplier)}`),
    p.shirt_number_id
      ? d.select<{ shirt_no: number; shirt: string | null }>(
          "kit_sets_v",
          `select=id,shirt_no,shirt&owner_id=${eq(p.api_id)}&supplier=${eq(supplier)}&order=ordered_on.desc.nullslast`,
        )
      : Promise.resolve([]),
  ]);
  const sizes: KitSizes = { shirt: null, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null };
  for (const r of rows) {
    const key = (Object.keys(KIT_ITEM_COLUMN) as (keyof KitSizes)[]).find((k) => KIT_ITEM_COLUMN[k] === r.item);
    if (key) sizes[key] = r.size;
  }
  return {
    supplier,
    sizes,
    printedShirt: printed[0] ? { shirtNo: printed[0].shirt_no, size: printed[0].shirt } : null,
    goalkeeper: p.playing_position === "Goalkeeper" || !!sizes.goalieSmock,
  };
}

export async function getMyDetails(env: Env, user: AuthorizedUser): Promise<MyDetails> {
  requireSupabase(env);
  const p = await loadPerson(env, user.personId);
  const d = db(env);
  const [season, files, kit] = await Promise.all([
    d.rpc<string>("current_season", {}),
    d.select<{ id: string; kind: string }>("files", `select=id,kind&person_id=${eq(p.id)}&kind=in.(photo,hkid)&order=created_at.desc`),
    loadKit(env, p),
  ]);
  const values: ProfileValues = {};
  for (const f of ALL_FIELDS) {
    const v = p[f.column];
    values[f.key] =
      f.type === "multi" ? (Array.isArray(v) ? (v as string[]) : [])
      : f.type === "yesno" ? (typeof v === "boolean" ? v : null)
      : typeof v === "string" ? v : v == null ? null : String(v);
  }
  const photo = files.find((f) => f.kind === "photo");
  return {
    season,
    applicant: isApplicant(p),
    audience: audience(p),
    underEighteen: isUnderEighteen(p.date_of_birth, today()),
    email: p.email,
    values,
    membership: {
      memberType: (p.member_type as string) ?? null,
      categoryType: (p.category_type as string) ?? null,
      playerCoach: Array.isArray(p.player_coach) ? (p.player_coach as string[]) : [],
      membershipNo: (p.membership_no as string) ?? null,
      joinDate: (p.join_date as string) ?? null,
      commitmentEndDate: (p.commitment_end_date as string) ?? null,
    },
    photoUrl: photo ? await fileLink(env, photo.id) : null,
    hasHkidCopy: files.some((f) => f.kind === "hkid"),
    kit,
    checkedAt: p.profile_updated_at,
  };
}

/** Checks one section's answers; returns the People columns to write. */
export function parseSection(key: string, body: Record<string, unknown>, saved: Audience): Record<string, string | string[] | number | boolean | null> {
  const section = PROFILE_SECTIONS.find((s) => s.key === key);
  if (!section) throw new HttpError("Unknown section.", 404, "NOT_FOUND");
  const values = (body.values ?? {}) as Record<string, unknown>;
  // On the application step the questions follow the type they've just chosen.
  const who: Audience = key === "application" && saved !== "member" ? audienceOf("Applicant", values.applicantType as string) : saved;
  if (!sectionFor(section, who)) throw new HttpError(`${section.title} isn't asked of you.`, 400, "INVALID_INPUT");
  // Not playing this season: only that answer is saved (the Fillout form hid the rest).
  if (key === "hockey" && who === "member" && values.active === false) return { active: false };
  const patch: Record<string, string | string[] | number | boolean | null> = {};
  for (const f of fieldsFor(section, who)) {
    const problem = checkValue(f, values[f.key], who);
    if (problem) throw new HttpError(problem, 400, "INVALID_INPUT");
    const v = values[f.key];
    patch[f.column] =
      f.type === "multi" ? ((v ?? []) as string[])
      : f.type === "yesno" ? (v as boolean)
      : f.type === "number" ? (v === null || v === undefined || v === "" ? null : Number(v))
      : typeof v === "string" && v.trim() ? normaliseValue(f, v.trim()) : null;
  }
  const across = sectionProblem(section.key, values as ProfileValues);
  if (across) throw new HttpError(across, 400, "INVALID_INPUT");
  return patch;
}

/** Saves one section of the signed-in person's details. */
export async function saveSection(env: Env, user: AuthorizedUser, key: SectionKey | string, body: Record<string, unknown>) {
  requireSupabase(env);
  const p = await loadPerson(env, user.personId);
  const section = PROFILE_SECTIONS.find((s) => s.key === key);
  if (section?.underEighteenOnly && !isUnderEighteen(p.date_of_birth, today())) {
    throw new HttpError("Only under-18s give a parent or guardian's details.", 400, "INVALID_INPUT");
  }
  const patch = parseSection(key, body, audience(p));
  await db(env).update("people", `id=${eq(p.id)}`, patch);
  await invalidateForTables(env, [TABLES.player]);
  return { ok: true };
}

/** Saves kit sizes for the current supplier. A printed shirt keeps its size. */
export async function saveKitSizes(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const p = await loadPerson(env, user.personId);
  const kit = await loadKit(env, p);
  if (!kit) throw new HttpError("There's no kit order to give sizes for yet.", 409, "NOT_YET");
  const given = (body.sizes ?? {}) as Record<string, unknown>;
  const sizes = {} as Record<keyof KitSizes, string | null>;
  for (const k of Object.keys(KIT_ITEM_COLUMN) as (keyof KitSizes)[]) {
    const v = given[k];
    if (v !== null && v !== undefined && v !== "" && (typeof v !== "string" || !KIT_SIZE_OPTIONS[k].includes(v))) {
      throw new HttpError("Choose sizes from the lists.", 400, "INVALID_INPUT");
    }
    sizes[k] = typeof v === "string" && v ? v : null;
  }
  if (!sizes.shirt || !sizes.shorts || !sizes.socks) throw new HttpError("Give your shirt, shorts and socks sizes.", 400, "INVALID_INPUT");
  // Shirts are printed with the number (owner, 2026-09-30).
  if (kit.printedShirt?.size) sizes.shirt = kit.printedShirt.size;
  const d = db(env);
  const keep = (Object.keys(sizes) as (keyof KitSizes)[]).filter((k) => sizes[k]);
  const drop = (Object.keys(sizes) as (keyof KitSizes)[]).filter((k) => !sizes[k]);
  await d.upsert(
    "kit_sizes",
    keep.map((k) => ({ person_id: p.id, supplier: kit.supplier, item: KIT_ITEM_COLUMN[k], size: sizes[k] })),
    "person_id,supplier,item",
  );
  if (drop.length) {
    await d.remove("kit_sizes", `person_id=${eq(p.id)}&supplier=${eq(kit.supplier)}&item=in.(${drop.map((k) => KIT_ITEM_COLUMN[k]).join(",")})`);
  }
  return { ok: true };
}

/** The end of the start-of-season check: their details are confirmed for this season. */
export async function confirmDetails(env: Env, user: AuthorizedUser) {
  requireSupabase(env);
  const p = await loadPerson(env, user.personId);
  await db(env).update("people", `id=${eq(p.id)}`, { profile_updated_at: new Date().toISOString() });
  // The My Tasks line goes at once, not when its minute's cache runs out.
  invalidateCache(`my-details-check:${user.personId}`);
  await invalidateForTables(env, [TABLES.player]);
  return { ok: true };
}

const UPLOAD_KINDS = {
  photo: { types: ["image/jpeg", "image/png", "image/webp"], max: 5_000_000, name: "photo" },
  hkid: { types: ["image/jpeg", "image/png", "image/webp", "application/pdf"], max: 5_000_000, name: "hkid" },
} as const;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** A data URL's bytes and type, checked against what the kind allows. */
export function uploadBytes(kind: keyof typeof UPLOAD_KINDS, dataUrl: unknown): { bytes: Uint8Array<ArrayBuffer>; type: string } {
  const spec = UPLOAD_KINDS[kind];
  const m = typeof dataUrl === "string" ? /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m || !(spec.types as readonly string[]).includes(m[1])) {
    throw new HttpError(kind === "photo" ? "Upload a JPEG, PNG or WebP photo." : "Upload a photo or PDF of your HKID.", 400, "INVALID_INPUT");
  }
  const bin = atob(m[2]);
  if (bin.length > spec.max) throw new HttpError("That file is over 5 MB. Try a smaller one.", 400, "INVALID_INPUT");
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] };
}

/**
 * Replaces their photo or HKID copy: the new file is stored and the old one
 * removed, as re-uploading on the Fillout form did.
 */
export async function uploadFile(env: Env, user: AuthorizedUser, kind: string, body: Record<string, unknown>) {
  requireSupabase(env);
  if (kind !== "photo" && kind !== "hkid") throw new HttpError("Unknown upload.", 404, "NOT_FOUND");
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const { bytes, type } = uploadBytes(kind, body.dataUrl);
  const p = await loadPerson(env, user.personId);
  const d = db(env);
  const old = await d.select<{ id: string; r2_key: string }>("files", `select=id,r2_key&person_id=${eq(p.id)}&kind=${eq(kind)}`);
  const key = `people/${p.id}/${kind}/${crypto.randomUUID()}.${EXT[type]}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [
    { r2_key: key, kind, person_id: p.id, filename: `${UPLOAD_KINDS[kind].name}.${EXT[type]}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  if (old.length) {
    await d.remove("files", `id=in.(${old.map((o) => o.id).join(",")})`);
    await Promise.all(old.map((o) => env.FILES!.delete(o.r2_key)));
  }
  await invalidateForTables(env, [TABLES.player]);
  return { ok: true, url: kind === "photo" ? await fileLink(env, file.id) : null };
}
