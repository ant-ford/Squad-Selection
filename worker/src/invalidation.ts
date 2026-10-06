/**
 * Which caches a write to each kind of club data can make stale. Only the
 * Worker's own writes are announced: the Airtable webhook that also drove
 * these went with Airtable, and hkha-sync writes Postgres directly (the
 * Stats summary keys itself on the data instead, clubStats.ts).
 *
 * Everything named is dropped in this isolate (and a Stats summary in KV
 * too): the cached reads and the structures derived from them (season
 * index, per-match player lists, calendar feeds, the 25 s poll cache), which
 * are rebuilt from fresh reads.
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
      "club-reference",
      "ranking:active",
      "ranking:inactive",
      MEMBERSHIP_RECORDS_KEY,
      CHAIRMAN_DIRECTORY_KEY,
      STATEMENT_RECORDS_KEY,
      WAITING_ON_KEY,
    ],
    // my-tasks: a member's player-page banner, gone once their form is in.
    prefixes: ["player-by-email:", "players-for-match:", "season-index:", "calendar:", "ranking-events:", "my-tasks:"],
  },
  // The Statements board. People edits drop it too: names, teams and
  // resignations reach it through lookups and the resigned-id read.
  commitments: {
    keys: [STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  // Appearances feed eligibility and play-up counts. The current Stats
  // summary needs nothing here: it is keyed on match_cards.updated_at.
  matchCards: {
    prefixes: ["match-cards:", "players-for-match:", "season-index:", "calendar:"],
  },
  // The Men's Convenor's suspensions (discipline.ts): the open ones
  // (seasonContext.ts MANUAL_SUSPENSIONS_KEY) and what eligibility built
  // from them.
  suspensions: {
    keys: ["manual-suspensions"],
    prefixes: ["players-for-match:", "season-index:"],
  },
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

/** After a write to suspensions. */
export const invalidateSuspensions = (env: Env) => invalidate(env, "suspensions");
