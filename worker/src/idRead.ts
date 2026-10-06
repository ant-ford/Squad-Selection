/**
 * Reads an HKID card or passport picture to suggest the Personal details
 * (owner decision, 2026-10-01: AI reads it, they confirm). The picture goes
 * from the browser straight to the model through OpenRouter, routed only to
 * providers that neither keep nor train on it, and nothing is stored here:
 * the answer comes back as suggestions the person checks before using.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { askAboutPicture, isPhotoDataUrl, parseReply } from "./vision";
import { normaliseHkid } from "../../shared/phone";
import { NATIONALITIES } from "../../shared/profile";

export type IdKind = "hkid" | "passport";

/** What a reading can fill in: the Personal section's own keys. */
export interface IdSuggestions {
  surname?: string;
  givenNames?: string;
  chineseName?: string;
  dateOfBirth?: string;
  gender?: "Male" | "Female";
  hkidNo?: string;
  passportNo?: string;
  nationality?: string;
}

const PROMPT: Record<IdKind, string> = {
  hkid: "This is a picture of a Hong Kong Identity Card.",
  passport: "This is a picture of the photo page of a passport.",
};

const SYSTEM = [
  "You read identity documents to fill in a sports club's membership form.",
  "Reply with one JSON object and nothing else, with these keys, using null for anything you can't read clearly:",
  '{"surname": string, "givenNames": string, "chineseName": string, "dateOfBirth": "YYYY-MM-DD", "gender": "Male" | "Female", "hkidNo": string, "passportNo": string, "nationality": string}',
  "Write names in normal capitalisation (Chan, Tai Man), not capitals. chineseName only in Chinese characters.",
  "hkidNo is the HKID card number with its check digit, like A123456(7); on a passport it is null.",
  "passportNo is the passport number; on an HKID card it is null.",
  "nationality is the adjective, e.g. British, Chinese, Australian; for an HKID card, null.",
  "Do not guess.",
].join("\n");

const text = (v: unknown, max = 100) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, max) : undefined);

/** The model's answer as suggestions: each value checked, anything doubtful left out. */
export function toSuggestions(raw: unknown): IdSuggestions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: IdSuggestions = {};
  const surname = text(o.surname);
  const givenNames = text(o.givenNames);
  if (surname) out.surname = surname;
  if (givenNames) out.givenNames = givenNames;
  const chinese = text(o.chineseName, 20);
  if (chinese && /^[㐀-鿿\s]+$/.test(chinese)) out.chineseName = chinese.replace(/\s+/g, "");
  const dob = text(o.dateOfBirth);
  if (dob && /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dob) && !Number.isNaN(Date.parse(dob))) out.dateOfBirth = dob;
  const gender = text(o.gender)?.toLowerCase();
  if (gender === "male" || gender === "m") out.gender = "Male";
  if (gender === "female" || gender === "f") out.gender = "Female";
  // Only a number that passes the check digit.
  const hkid = text(o.hkidNo) && normaliseHkid(text(o.hkidNo)!);
  if (hkid) out.hkidNo = hkid;
  const passport = text(o.passportNo, 20)?.toUpperCase().replace(/\s+/g, "");
  if (passport && /^[A-Z0-9]{5,15}$/.test(passport)) out.passportNo = passport;
  const nationality = text(o.nationality, 60);
  if (nationality) out.nationality = NATIONALITIES.find((n) => n.toLowerCase() === nationality.toLowerCase()) ?? nationality;
  return out;
}

export { parseReply };

export async function readIdDocument(env: Env, _user: AuthorizedUser, body: Record<string, unknown>): Promise<{ suggestions: IdSuggestions }> {
  if (!env.OPENROUTER_API_KEY) throw new HttpError("Reading documents isn't set up.", 503, "AI_UNAVAILABLE");
  const kind = body.kind === "passport" ? "passport" : body.kind === "hkid" ? "hkid" : null;
  const image = body.dataUrl;
  if (!kind) throw new HttpError("Unknown document.", 400, "INVALID_INPUT");
  // A PDF can't be read this way; the boxes are filled in by hand then.
  if (!isPhotoDataUrl(image)) {
    throw new HttpError("Only a photo of the document can be read.", 400, "INVALID_INPUT");
  }
  const reply = await askAboutPicture(env, { system: SYSTEM, prompt: PROMPT[kind], image, maxTokens: 400, label: "ID read" });
  if (!reply) throw new HttpError("Couldn't read the document just now. Fill in the boxes yourself, or try again.", 502, "AI_FAILED");
  return { suggestions: toSuggestions(parseReply(reply)) };
}
