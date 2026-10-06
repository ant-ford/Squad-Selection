import type { Env } from "../env";
import { supabaseTeams } from "./supabase/squad";
import type { Team } from "../../../shared/schema/domainTypes";

export interface TeamsRepo {
  listActive(): Promise<Team[]>;
  /** Every team, Active or not - authorization must not depend on a team's Active flag. */
  listAll(): Promise<Team[]>;
  /** Replaces the team's Auto Select Players list. */
  setAutoSelectPlayers(teamId: string, playerIds: string[]): Promise<void>;
}

export function teams(env: Env): TeamsRepo {
  return supabaseTeams(env);
}
