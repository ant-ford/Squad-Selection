import {
  airtableBatchCreate,
  airtableBatchDelete,
  airtableBatchUpdate,
  airtableFindAll,
  escapeFormulaValue,
} from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { supabaseAvailabilityExceptions } from "./supabase/squad";
import { TABLES } from "../../../shared/schema/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapAvailability } from "../../../shared/mappers/availabilityMapper";
import type { AvailabilityException } from "../../../shared/schema/domainTypes";

/** One player's answer for one match, as stored. */
export interface ExceptionWrite {
  matchId: string;
  playerId: string;
  status: "Available" | "Maybe" | "Unavailable";
  notes?: string;
  /** Who gave the answer: the player, or a coach on their behalf. */
  updatedById: string;
}

export interface ExceptionChanges {
  deleteIds: string[];
  updates: { id: string; write: ExceptionWrite }[];
  creates: ExceptionWrite[];
}

export interface AvailabilityExceptionsRepo {
  /** Exceptions for matches in any of the given (non-empty, de-duplicated) seasons. */
  listForSeasons(seasons: string[]): Promise<AvailabilityException[]>;
  /**
   * Deletes, then updates, then creates. Returns the new records' ids in the
   * order of `creates`.
   */
  apply(changes: ExceptionChanges): Promise<{ createdIds: string[] }>;
}

function toFields(w: ExceptionWrite): Record<string, unknown> {
  return {
    [AVAILABILITYEXCEPTIONS_FIELDS.match]: [w.matchId],
    [AVAILABILITYEXCEPTIONS_FIELDS.player]: [w.playerId],
    [AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]: w.status,
    [AVAILABILITYEXCEPTIONS_FIELDS.note]: w.notes || "",
    [AVAILABILITYEXCEPTIONS_FIELDS.updatedBy]: [w.updatedById],
  };
}

function chunk<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function airtableAvailabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return {
    async listForSeasons(seasons) {
      if (seasons.length === 0) return [];
      const clause = (s: string) => `{${AVAILABILITYEXCEPTIONS_FIELDS.season}}="${escapeFormulaValue(s)}"`;
      const formula = seasons.length === 1 ? clause(seasons[0]) : `OR(${seasons.map(clause).join(",")})`;
      const records = await airtableFindAll(env, TABLES.availabilityException, formula);
      return records.map(mapAvailability);
    },

    async apply({ deleteIds, updates, creates }) {
      const table = TABLES.availabilityException;
      for (const batch of chunk(deleteIds)) await airtableBatchDelete(env, table, batch);
      for (const batch of chunk(updates)) {
        await airtableBatchUpdate(env, table, batch.map(({ id, write }) => ({ id, fields: toFields(write) })));
      }
      const createdIds: string[] = [];
      for (const batch of chunk(creates)) {
        const created = await airtableBatchCreate(env, table, batch.map(toFields));
        for (const rec of created?.records ?? []) createdIds.push(rec.id);
      }
      return { createdIds };
    },
  };
}

export function availabilityExceptions(env: Env): AvailabilityExceptionsRepo {
  return pick(env, "availabilityExceptions", airtableAvailabilityExceptions, supabaseAvailabilityExceptions);
}
