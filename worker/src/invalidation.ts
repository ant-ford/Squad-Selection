/**
 * Which caches a write to each kind of club data can make stale, among
 * those NOT kept under the cache versions. The reference data, matches,
 * match cards, answers, rules, season index and per-match player lists are
 * keyed on cache_versions (cache.ts getVersioned), which every write moves,
 * the Worker's and hkha-sync's alike, so they need nothing here.
 *
 * Everything named is dropped in this isolate (and a Stats summary in KV
 * too) and rebuilt from fresh reads.
 */
import { invalidateShared } from "./cache";
import type { Env } from "./env";
import { CHAIRMAN_DIRECTORY_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY } from "./reference";

interface Rule {
  keys?: string[];
  prefixes?: string[];
}

const INVALIDATION = {
  people: {
    keys: [
      "ranking:active",
      "ranking:inactive",
      MEMBERSHIP_RECORDS_KEY,
      CHAIRMAN_DIRECTORY_KEY,
      STATEMENT_RECORDS_KEY,
      WAITING_ON_KEY,
    ],
    // my-tasks: a member's player-page banner, gone once their form is in.
    prefixes: ["ranking-events:", "my-tasks:"],
  },
  // The Statements board. People edits drop it too: names, teams and
  // resignations reach it through lookups and the resigned-id read.
  commitments: {
    keys: [STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  // Appearances feed eligibility, play-up counts, the Stats summary and the
  // calendar feeds: all keyed on the cache versions now, so nothing to drop.
  matchCards: {},
} satisfies Record<string, Rule>;

/** Drop every cache a change to this kind of data can have made stale. */
async function invalidate(env: Env, domain: keyof typeof INVALIDATION): Promise<void> {
  const rule: Rule = INVALIDATION[domain];
  await invalidateShared(env, rule.keys ?? [], rule.prefixes ?? []);
}

/** After a write to People. */
export const invalidatePeople = (env: Env) => invalidate(env, "people");

/** After a write to Commitments. */
export const invalidateCommitments = (env: Env) => invalidate(env, "commitments");

/** After a write to Match Cards (e.g. linking cards to a player). */
export const invalidateMatchCards = (env: Env) => invalidate(env, "matchCards");
