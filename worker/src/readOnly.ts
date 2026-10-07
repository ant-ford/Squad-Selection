import type { Env } from "./env";

/**
 * The read-only switch, for a database restore (docs/RESTORE.md).
 *
 * WRITES = "off" (worker/wrangler.toml, or a var in the Cloudflare dashboard)
 * turns every save away with 503 READ_ONLY before sign-in, skips the daily
 * jobs and stops the error log. Reads, calendar feeds and signed file links
 * carry on. Anything else, including unset, leaves writes on.
 */
export function writesOff(env: Pick<Env, "WRITES">): boolean {
  return env.WRITES?.trim().toLowerCase() === "off";
}

export const READ_ONLY_CODE = "READ_ONLY";
export const READ_ONLY_MESSAGE = "Eddy is read-only for a short while. Your change wasn't saved.";
