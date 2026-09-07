import { HttpError } from "./http";
import { AVAILABILITYRULES_FIELDS } from "../../shared/schema/fieldMaps";
import { airtableCreate, airtableDelete, airtableFindAll } from "./airtable";
import type { Env } from "./env";
import { getCached, invalidateCache } from "./cache";
import { TABLES } from "../../shared/schema/tableNames";
import { mapAvailabilityRule } from "../../shared/mappers/availabilityRuleMapper";
import type { AvailabilityRule, AvailabilityRuleType } from "../../shared/schema/domainTypes";

/**
 * Standing availability rules.
 *
 * A rule supplies the DEFAULT answer for a fixture the player has not
 * answered individually. An explicit Availability Exception always wins:
 * tapping a specific fixture is a deliberate override, and rules must never
 * silently undo it. That keeps `Availability Exceptions` meaning exactly
 * what it means today.
 */

/** What a fixture looks like to the rule engine. */
export interface RuleFixtureContext {
  /** Match date, YYYY-MM-DD (local match date key). */
  date: string;
  /** True when this fixture is a play-up opportunity for the player. */
  isPlayUp: boolean;
  /** True when this fixture is a support game for the player. */
  isSupport: boolean;
}

export type ResolvedStatus = "Available" | "Maybe" | "Unavailable";

/**
 * Most specific first. A player who says "unavailable for everything from
 * March" and "available midweek" means the midweek answer to win, because it
 * is the narrower statement.
 */
const SPECIFICITY: Record<AvailabilityRuleType, number> = {
  "Date range": 4,
  Midweek: 3,
  "Play-ups": 2,
  "Support games": 2,
  "All future": 1,
};

/**
 * Midweek is Monday-Friday. HKHA league hockey is played at weekends, so a
 * player saying "not midweek" means the odd rearranged or cup fixture that
 * lands on a working day.
 */
function isMidweek(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // noon avoids TZ edges
  return day >= 1 && day <= 5;
}

function matches(rule: AvailabilityRule, fixture: RuleFixtureContext): boolean {
  switch (rule.ruleType) {
    case "Play-ups":
      return fixture.isPlayUp;
    case "Support games":
      return fixture.isSupport;
    case "Midweek":
      return isMidweek(fixture.date);
    case "Date range":
      // Both bounds inclusive. A missing bound is treated as open-ended,
      // so "from 1 June" and "until 1 June" both work.
      if (rule.startDate && fixture.date < rule.startDate) return false;
      if (rule.endDate && fixture.date > rule.endDate) return false;
      return Boolean(rule.startDate || rule.endDate);
    case "All future":
      return !rule.startDate || fixture.date >= rule.startDate;
    default:
      return false; // unknown or blank rule type: ignore rather than guess
  }
}

/**
 * The status a player's rules imply for one fixture, or null when no rule
 * applies and the normal default ("Available") should stand.
 *
 * Ties within the same specificity are broken by Last Modified, so the most
 * recent statement wins - which is what a player changing their mind expects.
 */
export function resolveRuleStatus(
  rules: AvailabilityRule[],
  fixture: RuleFixtureContext,
): ResolvedStatus | null {
  const applicable = rules
    .filter((r) => r.active && r.availability && matches(r, fixture))
    .sort((a, b) => {
      const bySpecificity =
        (SPECIFICITY[b.ruleType as AvailabilityRuleType] ?? 0) -
        (SPECIFICITY[a.ruleType as AvailabilityRuleType] ?? 0);
      if (bySpecificity !== 0) return bySpecificity;
      return (b.lastModified || "").localeCompare(a.lastModified || "");
    });

  return (applicable[0]?.availability as ResolvedStatus) ?? null;
}

/**
 * Availability for one fixture: an explicit exception if the player set one,
 * otherwise whatever their rules imply, otherwise Available.
 */
export function effectiveAvailability(
  explicitStatus: string | undefined | null,
  rules: AvailabilityRule[],
  fixture: RuleFixtureContext,
): { status: ResolvedStatus; fromRule: boolean } {
  if (explicitStatus) {
    return { status: explicitStatus as ResolvedStatus, fromRule: false };
  }
  const ruleStatus = resolveRuleStatus(rules, fixture);
  if (ruleStatus) return { status: ruleStatus, fromRule: true };
  return { status: "Available", fromRule: false };
}

/** Index rules by player id for per-match resolution across a whole squad. */
export function indexRulesByPlayer(
  rules: AvailabilityRule[],
): Map<string, AvailabilityRule[]> {
  const byPlayer = new Map<string, AvailabilityRule[]>();
  for (const rule of rules) {
    const playerId = rule.player?.[0];
    if (!playerId) continue;
    const list = byPlayer.get(playerId);
    if (list) list.push(rule);
    else byPlayer.set(playerId, [rule]);
  }
  return byPlayer;
}

// ── Data access ─────────────────────────────────────────────────────────

const RULES_CACHE_KEY = "availability-rules";
const RULES_TTL_MS = 5 * 60 * 1000;

/**
 * Every rule in the base, cached briefly. One list call serves both the
 * player's own view and a coach's whole-squad view; the table is small
 * (a handful of rows per player at most).
 *
 * A missing table is not an error: the feature is additive, and until the
 * table exists every fixture simply falls back to its normal default.
 */
export async function getAllAvailabilityRules(env: Env): Promise<AvailabilityRule[]> {
  const { data } = await getCached<AvailabilityRule[]>(RULES_CACHE_KEY, async () => {
    try {
      const records = await airtableFindAll(env, TABLES.availabilityRule);
      return records.map(mapAvailabilityRule);
    } catch {
      return [];
    }
  }, RULES_TTL_MS);
  return data;
}

export async function getRulesForPlayer(env: Env, playerId: string): Promise<AvailabilityRule[]> {
  const all = await getAllAvailabilityRules(env);
  return all.filter((r) => (r.player ?? []).includes(playerId));
}

export function invalidateAvailabilityRules(): void {
  invalidateCache(RULES_CACHE_KEY);
}

// ── Player-facing management ────────────────────────────────────────────

const RULE_TYPES: readonly string[] = [
  "Play-ups",
  "Support games",
  "Midweek",
  "Date range",
  "All future",
];
const AVAILABILITY_VALUES: readonly string[] = ["Available", "Maybe", "Unavailable"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SaveRuleInput {
  ruleType: string;
  availability: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

/**
 * Create a standing rule for the calling player.
 *
 * The player id comes from the verified session, never from the body - the
 * same identity boundary the availability writes hold.
 */
export async function createAvailabilityRule(
  env: Env,
  playerId: string,
  input: SaveRuleInput,
) {
  if (!RULE_TYPES.includes(input.ruleType)) {
    throw new HttpError(`ruleType must be one of: ${RULE_TYPES.join(", ")}`, 400);
  }
  if (!AVAILABILITY_VALUES.includes(input.availability)) {
    throw new HttpError(`availability must be one of: ${AVAILABILITY_VALUES.join(", ")}`, 400);
  }
  for (const [label, value] of [["startDate", input.startDate], ["endDate", input.endDate]] as const) {
    if (value && !ISO_DATE.test(value)) {
      throw new HttpError(`${label} must be formatted YYYY-MM-DD`, 400);
    }
  }
  if (input.ruleType === "Date range" && !input.startDate && !input.endDate) {
    throw new HttpError("A date-range rule needs a start date, an end date, or both", 400);
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    throw new HttpError("startDate must not be after endDate", 400);
  }

  const fields: Record<string, unknown> = {
    [AVAILABILITYRULES_FIELDS.player]: [playerId],
    [AVAILABILITYRULES_FIELDS.ruleType]: input.ruleType,
    [AVAILABILITYRULES_FIELDS.availability]: input.availability,
    [AVAILABILITYRULES_FIELDS.active]: true,
  };
  if (input.startDate) fields[AVAILABILITYRULES_FIELDS.startDate] = input.startDate;
  if (input.endDate) fields[AVAILABILITYRULES_FIELDS.endDate] = input.endDate;
  if (input.notes) fields[AVAILABILITYRULES_FIELDS.notes] = input.notes;

  const created = await airtableCreate(env, TABLES.availabilityRule, fields);
  invalidateAvailabilityRules();
  return mapAvailabilityRule(created);
}

/** Delete one of the calling player's own rules. */
export async function deleteAvailabilityRule(env: Env, playerId: string, ruleId: string) {
  const all = await getAllAvailabilityRules(env);
  const rule = all.find((r) => r.id === ruleId);
  // Ownership is checked server-side: a rule id alone must never let one
  // player delete another's preference.
  if (!rule || !(rule.player ?? []).includes(playerId)) {
    throw new HttpError("Rule not found", 404);
  }
  await airtableDelete(env, TABLES.availabilityRule, ruleId);
  invalidateAvailabilityRules();
  return { success: true };
}
