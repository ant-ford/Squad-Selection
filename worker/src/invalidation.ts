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
import { CHAIRMAN_DIRECTORY_KEY, MEMBERSHIP_RECORDS_KEY, OFFICER_LINKS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY } from "./reference";

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
  // Coaches, captains and squad sizes: the roster, coach access and every
  // per-match list built on them.
  teams: {
    keys: ["club-reference", "team-coach-links"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
  // Who holds an office: section access, and the boards that name the
  // signing officers and sponsors.
  offices: {
    keys: [OFFICER_LINKS_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
    localPrefixes: ["volunteering:office-holders"],
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

/** After a change to a team's coaches, captains or target squad size. */
export const invalidateTeams = (env: Env) => invalidate(env, "teams");

/** After an office changes hands or is edited. */
export const invalidateOffices = (env: Env) => invalidate(env, "offices");
