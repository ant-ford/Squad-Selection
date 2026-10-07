/**
 * Waivers & declarations in Eddy, replacing Fillout form
 * 10. Everyone agrees to the HKFC Hockey Code of Conduct & Disclaimers each
 * season; under-18s add their parent or guardian's consent and signature.
 * Each signing is a dated record (declarations), and people.waivers_signed_at
 * is set, which is what clears the My Tasks line.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, SupabaseError } from "./data/supabase";
import { invalidatePeople } from "./invalidation";
import { storeSignature, signatureBytes } from "./signatures";
import { waiversDoneThisSeason } from "./myTasks";
import { inBackground } from "./requestContext";
import { makeU18Registration } from "./pdf/u18Registration";
import { pdfsEnabled } from "./pdf/render";
import { hkDateKey } from "../../shared/hkDateKey";
import { seasonStartYear } from "../../shared/membershipInsights";
import {
  DECLARATIONS_VERSION,
  DECLARATION_ITEMS,
  GUARDIAN_CONFIRM,
  REQUIRED_KEYS,
  type DeclarationsView,
} from "../../shared/declarations";

interface PersonRow {
  id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  date_of_birth: string | null;
  waivers_signed_at: string | null;
  guardian_surname: string | null;
  guardian_given_names: string | null;
  guardian_mobile_no: string | null;
  guardian_email: string | null;
}

// Lives in shared/declarations.ts now (the registration screen uses it too).
import { isUnderEighteen } from "../../shared/declarations";
import { fullName } from "../../shared/personName";
export { isUnderEighteen };

async function loadPerson(env: Env, personApiId: string): Promise<PersonRow> {
  const row = await db(env).one<PersonRow>(
    "people",
    `select=id,preferred_name,given_names,surname,date_of_birth,waivers_signed_at,guardian_surname,guardian_given_names,guardian_mobile_no,guardian_email&api_id=${eq(personApiId)}`,
  );
  if (!row) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  return row;
}

export async function getMyDeclarations(env: Env, user: AuthorizedUser): Promise<DeclarationsView> {
  const p = await loadPerson(env, user.personId);
  const today = hkDateKey(new Date().toISOString());
  const start = seasonStartYear(today);
  return {
    season: `${start}-${start + 1}`,
    signedThisSeasonAt: waiversDoneThisSeason(p.waivers_signed_at, today) ? p.waivers_signed_at : null,
    underEighteen: isUnderEighteen(p.date_of_birth, today),
    playerName: fullName(p),
    guardian: {
      surname: p.guardian_surname ?? "",
      givenNames: p.guardian_given_names ?? "",
      mobileNo: p.guardian_mobile_no ?? "",
      email: p.guardian_email ?? "",
    },
    version: DECLARATIONS_VERSION,
  };
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function submitDeclarations(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  if (body.version !== DECLARATIONS_VERSION) {
    throw new HttpError("The wording has changed since this page was opened. Reload to read the current version.", 409, "WORDING_CHANGED");
  }
  const known = new Set<string>([...DECLARATION_ITEMS.map((i) => i.key), GUARDIAN_CONFIRM.key]);
  const accepted = [...new Set(Array.isArray(body.accepted) ? body.accepted.filter((k): k is string => typeof k === "string" && known.has(k)) : [])];
  if (REQUIRED_KEYS.some((k) => !accepted.includes(k))) throw new HttpError("Tick every box to agree.", 400, "INVALID_INPUT");

  const p = await loadPerson(env, user.personId);
  const minor = isUnderEighteen(p.date_of_birth, hkDateKey(new Date().toISOString()));
  const g = (body.guardian ?? {}) as Record<string, unknown>;
  const guardian = { guardianSurname: str(g.surname), guardianGivenNames: str(g.givenNames), guardianMobileNo: str(g.mobileNo, 40), guardianEmail: str(g.email) };
  let signature: string | null = null;
  if (minor) {
    if (!guardian.guardianSurname || !guardian.guardianGivenNames || !guardian.guardianMobileNo || !/^\S+@\S+\.\S+$/.test(guardian.guardianEmail)) {
      throw new HttpError("Enter the parent or guardian's name, mobile and email.", 400, "INVALID_INPUT");
    }
    if (!accepted.includes(GUARDIAN_CONFIRM.key)) throw new HttpError("The parent or guardian must confirm their consent.", 400, "INVALID_INPUT");
    if (typeof body.signature !== "string") throw new HttpError("The parent or guardian must sign.", 400, "INVALID_INPUT");
    signatureBytes(body.signature); // a bad image is a 400 before anything is stored
    signature = await storeSignature(env, p.id, body.signature, "guardian_consent_signature");
  }

  try {
    await db(env).rpc("submit_declarations", {
      p_actor: user.personId,
      p_version: DECLARATIONS_VERSION,
      p_accepted: accepted,
      p_required: REQUIRED_KEYS,
      p: guardian,
      p_signature: signature,
    });
  } catch (err) {
    if (err instanceof SupabaseError && err.code === "22023") {
      throw new HttpError(`${err.message.replace(/^Supabase .*?failed \(\d+\): /, "")}.`, 400, "INVALID_INPUT");
    }
    if (err instanceof SupabaseError && err.code === "P0002") throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
    throw err;
  }
  // My Tasks reads waivers_signed_at through the People caches.
  await invalidatePeople(env);
  // HKHA's under-18 form, to the Men's Convenor: after the response.
  if (minor && pdfsEnabled(env)) void inBackground(() => makeU18Registration(env, p.id));
  return { ok: true, underEighteen: minor };
}
