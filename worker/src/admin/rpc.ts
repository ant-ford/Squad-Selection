/**
 * Calls an admin SQL function (supabase/migrations/*admin*.sql) and turns
 * what can go wrong into answers the screens can show as they are.
 *
 * Every admin write is one SQL function: the update and its activity_log
 * row in one transaction. Those functions refuse in two ways:
 *  - by raising, with a Postgres error code (mapped below);
 *  - by answering {status: "conflict", code?, field?}: someone else changed
 *    the row since the screen read it, or a rule says no (LAST_SECTION_CAPTAIN).
 *
 * The database's own message is never passed on (it can quote a value);
 * each code has a plain message, which a caller can replace.
 */
import type { Env } from "../env";
import { HttpError } from "../http";
import { backendFor } from "../data/backend";
import { db, SupabaseError } from "../data/supabase";

const RAISED: Record<string, { status: number; code: string; message: string }> = {
  P0002: { status: 404, code: "NOT_FOUND", message: "Not found. It may have been removed; reload and try again." },
  "23505": { status: 409, code: "TAKEN", message: "That's already in use." },
  "22023": { status: 400, code: "INVALID_INPUT", message: "Check the details and try again." },
  "22P02": { status: 400, code: "INVALID_INPUT", message: "Check the details and try again." },
  "22007": { status: 400, code: "INVALID_INPUT", message: "Check the dates and try again." },
  "22008": { status: 400, code: "INVALID_INPUT", message: "Check the dates and try again." },
  "23502": { status: 400, code: "INVALID_INPUT", message: "Check the details and try again." },
  "23503": { status: 400, code: "INVALID_INPUT", message: "Check the details and try again." },
  "23514": { status: 400, code: "INVALID_INPUT", message: "Check the details and try again." },
  "42501": { status: 403, code: "FORBIDDEN", message: "That can't be changed here." },
};

const CONFLICT_MESSAGE = "Someone else changed this while you had it open. Reload and try again.";

/** What an admin function answers when it refuses without raising. */
export interface AdminConflict {
  status: "conflict";
  code?: string;
  field?: string;
}

export interface AdminRpcOptions {
  /** Messages by HTTP code (NOT_FOUND, TAKEN, ...) or conflict code (LAST_SECTION_CAPTAIN, ...). */
  messages?: Record<string, string>;
  /** The 409 code for a conflict that names a field rather than a code. Default CHANGED. */
  conflictCode?: string;
}

/** The admin screens are Supabase-only; the Airtable backend answers 409 NOT_YET. */
export function requireSupabaseAdmin(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("This is on the Supabase backend only.", 409, "NOT_YET");
  }
}

export async function adminRpc<T>(env: Env, fn: string, args: object, opts: AdminRpcOptions = {}): Promise<T> {
  const messages = opts.messages ?? {};
  let result: T | AdminConflict;
  try {
    result = await db(env).rpc<T | AdminConflict>(fn, args);
  } catch (err) {
    const mapped = err instanceof SupabaseError && err.code ? RAISED[err.code] : undefined;
    if (!mapped) throw err;
    console.warn(`${fn} refused:`, (err as Error).message);
    throw new HttpError(messages[mapped.code] ?? mapped.message, mapped.status, mapped.code);
  }
  if (result && typeof result === "object" && (result as AdminConflict).status === "conflict") {
    const conflict = result as AdminConflict;
    const code = conflict.code ?? opts.conflictCode ?? "CHANGED";
    throw new HttpError(messages[code] ?? CONFLICT_MESSAGE, 409, code);
  }
  return result as T;
}
