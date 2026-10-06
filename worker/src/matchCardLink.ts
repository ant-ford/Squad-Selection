/**
 * POST /api/admin/match-cards/:id/link {personId, saveName} (section
 * "dataChecks": the Men's Convenor and the Section Captains).
 *
 * Links a match card the Data checks screen lists as unlinked to the person
 * it belongs to, in one SQL function with its activity_log row
 * (link_match_card, 20261007131003). With saveName the card's name also
 * becomes their Registered Name, and this season's other unlinked cards
 * carrying it link too.
 *
 * Refusals, in plain words:
 *   409 ALREADY_LINKED  someone linked the card first
 *   409 NAME_TAKEN      someone else already has that Registered Name
 *   404 NOT_FOUND       no such card or person
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, SupabaseError } from "./data/supabase";
import { invalidateMatchCards, invalidatePeople } from "./invalidation";

/** A match card's or person's api id as the app holds it. */
const API_ID = /^[A-Za-z0-9-]{3,64}$/;

export const LINK_MESSAGES = {
  ALREADY_LINKED: "This card is already linked. Reload to see who to.",
  NAME_TAKEN: "Someone else already has this registered name. Link the card without saving the name, or fix the other player's name first.",
  NOT_FOUND: "Card or player not found. Reload and try again.",
} as const;

interface LinkResult {
  status: "ok" | "conflict";
  code?: keyof typeof LINK_MESSAGES;
  linked?: number;
}

export interface LinkRequest {
  card: string;
  personId: string;
  saveName: boolean;
}

/** Validates the request; throws a 400 the screen shows as it is. */
export function parseLinkRequest(card: string, body: Record<string, unknown>): LinkRequest {
  if (!API_ID.test(card)) throw new HttpError(LINK_MESSAGES.NOT_FOUND, 404, "NOT_FOUND");
  const personId = body.personId;
  if (typeof personId !== "string" || !API_ID.test(personId)) throw new HttpError("Choose who the card belongs to.", 400, "INVALID_INPUT");
  if (body.saveName !== undefined && typeof body.saveName !== "boolean") {
    throw new HttpError("Choose whether to save the name.", 400, "INVALID_INPUT");
  }
  return { card, personId, saveName: body.saveName === true };
}

export async function linkMatchCard(
  env: Env,
  actor: AuthorizedUser,
  card: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; linked: number }> {
  const req = parseLinkRequest(card, body);
  let result: LinkResult;
  try {
    result = await db(env).rpc<LinkResult>("link_match_card", {
      p_card: req.card,
      p_person: req.personId,
      p_save_name: req.saveName,
      p_actor: actor.personId,
    });
  } catch (err) {
    if (err instanceof SupabaseError && err.code === "P0002") throw new HttpError(LINK_MESSAGES.NOT_FOUND, 404, "NOT_FOUND");
    throw err;
  }
  if (result.status === "conflict") {
    const code = result.code && result.code in LINK_MESSAGES ? result.code : "ALREADY_LINKED";
    throw new HttpError(LINK_MESSAGES[code], 409, code);
  }
  // Card points, play-ups and suspensions read the cards; a saved name and an
  // automatic re-registration change People.
  await invalidateMatchCards(env);
  await invalidatePeople(env);
  return { ok: true, linked: result.linked ?? 1 };
}
