/**
 * Which caches a write to each kind of club data can make stale. Only the
 * Worker's own writes are announced: the Airtable webhook that also drove
 * these went with Airtable, and hkha-sync writes Postgres directly (the
 * Stats summary keys itself on the data instead, clubStats.ts).
 *
 * Shared entries are dropped in KV as well; in-isolate-only derived
 * structures (season index, per-match player lists, calendar feeds, the
 * 25 s poll cache) are dropped here and rebuilt from fresh reads.
 */
import { invalidateCachePrefix, invalidateShared, type SharedPrefix } from "./cache";
import type { Env } from "./env";
import { CHAIRMAN_DIRECTORY_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY } from "./reference";

interface Rule {
  keys?: string[];
  sharedPrefixes?: SharedPrefix[];
  localPrefixes?: string[];
}

const INVALIDATION = {
  people: {
    keys: [
      "club-reference",
      "ranking:active",
      "ranking:inactive",
      MEMBERSHIP_RECORDS_KEY,
      CHAIRMAN_DIRECTORY_KEY,
      STATEMENT_RECORDS_KEY,
      WAITING_ON_KEY,
    ],
    sharedPrefixes: ["player-by-email:"],
    // my-tasks: a member's player-page banner, gone once their form is in.
    localPrefixes: ["players-for-match:", "season-index:", "calendar:", "ranking-events:", "my-tasks:"],
  },
  // The Statements board. People edits drop it too: names, teams and
  // resignations reach it through lookups and the resigned-id read.
  commitments: {
    keys: [STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  // Appearances feed eligibility and play-up counts. The current Stats
  // summary needs nothing here: it is keyed on match_cards.updated_at.
  matchCards: {
    sharedPrefixes: ["match-cards:"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
} satisfies Record<string, Rule>;

/** Drop every cache a change to this kind of data can have made stale. */
async function invalidate(env: Env, domain: keyof typeof INVALIDATION): Promise<void> {
  const rule: Rule = INVALIDATION[domain];
  for (const p of rule.localPrefixes ?? []) invalidateCachePrefix(p);
  await invalidateShared(env, rule.keys ?? [], rule.sharedPrefixes ?? []);
}

/** After a write to People. */
export const invalidatePeople = (env: Env) => invalidate(env, "people");

/** After a write to Commitments. */
export const invalidateCommitments = (env: Env) => invalidate(env, "commitments");

/** After a write to Match Cards (e.g. linking cards to a player). */
export const invalidateMatchCards = (env: Env) => invalidate(env, "matchCards");
