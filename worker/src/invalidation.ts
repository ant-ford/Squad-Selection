/**
 * Which caches a change to each kind of club data can make stale.
 *
 * Shared entries are dropped in KV as well; in-isolate-only derived
 * structures (season index, per-match player lists, calendar feeds, the
 * 25 s poll cache) are dropped here and rebuilt from fresh reads.
 */
import { invalidateCachePrefix, invalidateShared, type SharedPrefix } from "./cache";
import type { Env } from "./env";
import { SCHEDULED_MATCHES_KEY } from "./fixtures";
import {
  CHAIRMAN_DIRECTORY_KEY,
  MEMBERSHIP_RECORDS_KEY,
  OFFICER_LINKS_KEY,
  STATEMENT_RECORDS_KEY,
  STATS_CURRENT_KEY,
  WAITING_ON_KEY,
} from "./reference";

interface Rule {
  keys?: string[];
  sharedPrefixes?: SharedPrefix[];
  localPrefixes?: string[];
}

export const INVALIDATION = {
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
  teams: {
    keys: ["club-reference", "team-coach-links"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
  matches: {
    keys: [SCHEDULED_MATCHES_KEY, STATS_CURRENT_KEY],
    sharedPrefixes: ["all-matches:", "played-matches:"],
    localPrefixes: ["match:", "players-for-match:", "season-index:", "calendar:", "availability:"],
  },
  matchCards: {
    keys: [STATS_CURRENT_KEY],
    sharedPrefixes: ["match-cards:"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
  availabilityExceptions: {
    sharedPrefixes: ["exceptions:"],
    localPrefixes: ["availability:", "players-for-match:", "season-index:", "calendar:"],
  },
  availabilityRules: {
    keys: ["availability-rules"],
    localPrefixes: ["players-for-match:", "calendar:"],
  },
  abilityGroups: {
    keys: ["ranking:config", "ranking:active"],
  },
  rankingEvents: {
    localPrefixes: ["ranking-events:"],
  },
  // The boards carry the signing officer's name and mobile, so an office
  // changing hands drops them too.
  membershipOfficers: {
    keys: [OFFICER_LINKS_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  sectionChairs: {
    keys: [OFFICER_LINKS_KEY, MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  sectionCaptains: {
    keys: [OFFICER_LINKS_KEY],
  },
  // The Statements board. People edits drop it too: names, teams and
  // resignations reach it through lookups and the resigned-id read.
  commitments: {
    keys: [STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
  sponsors: {
    keys: [MEMBERSHIP_RECORDS_KEY, STATEMENT_RECORDS_KEY, WAITING_ON_KEY],
  },
} satisfies Record<string, Rule>;

export type DataDomain = keyof typeof INVALIDATION;

/** Drop every cache a change to these kinds of data can have made stale. */
export async function invalidateFor(env: Env, domains: Iterable<DataDomain>): Promise<void> {
  const keys = new Set<string>();
  const sharedPrefixes = new Set<SharedPrefix>();
  for (const domain of domains) {
    const rule: Rule = INVALIDATION[domain];
    for (const k of rule.keys ?? []) keys.add(k);
    for (const p of rule.sharedPrefixes ?? []) sharedPrefixes.add(p);
    for (const p of rule.localPrefixes ?? []) invalidateCachePrefix(p);
  }
  if (keys.size === 0 && sharedPrefixes.size === 0) return;
  await invalidateShared(env, [...keys], [...sharedPrefixes]);
}

/** After a write to People. */
export const invalidatePeople = (env: Env) => invalidateFor(env, ["people"]);

/** After a write to Commitments. */
export const invalidateCommitments = (env: Env) => invalidateFor(env, ["commitments"]);
