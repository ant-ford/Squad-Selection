import type { Env } from "../env";
import type { ManualSuspension } from "../suspension";
import { db, SupabaseError } from "./supabase";

/** The Men's Convenor's suspensions (public.suspensions), as eligibility reads them. */
export interface SuspensionsRepo {
  /** Every open one (cleared_at null): a handful of rows at most. */
  listOpen(): Promise<ManualSuspension[]>;
}

interface Row {
  id: string;
  player: string;
  matches: number | null;
  from_date: string;
  serving_team: string;
  created_at: string;
}

export function suspensions(env: Env): SuspensionsRepo {
  return {
    async listOpen() {
      const rows = await db(env)
        .select<Row>("api_suspensions", "select=id,player,matches,from_date,serving_team,created_at&cleared_at=is.null")
        .catch((err: unknown): Row[] => {
          // Only a database without the migration yet (PGRST205: no such
          // view) reads as "none": with no table there are none. Anything
          // else fails the read, as the other season reads do - never "none".
          if (err instanceof SupabaseError && err.code === "PGRST205") {
            console.error("api_suspensions missing: apply 20261007010203_suspensions.sql");
            return [];
          }
          throw err;
        });
      return rows.map((r) => ({
        id: r.id,
        player: r.player,
        matches: r.matches,
        fromDate: r.from_date,
        servingTeam: r.serving_team,
        createdAt: r.created_at,
      }));
    },
  };
}
