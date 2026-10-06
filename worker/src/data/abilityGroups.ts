import type { Env } from "../env";
import { supabaseAbilityGroups } from "./supabase/squad";
import type { AbilityGroupConfiguration } from "../../../shared/schema/domainTypes";

type Group = AbilityGroupConfiguration["group"];

export interface AbilityGroupsRepo {
  list(): Promise<AbilityGroupConfiguration[]>;
  /**
   * Sets each given group's capacity, creating the row (not residual) for a
   * group that has none.
   */
  saveCapacities(capacities: Partial<Record<Group, number>>): Promise<void>;
}

export function abilityGroups(env: Env): AbilityGroupsRepo {
  return supabaseAbilityGroups(env);
}
