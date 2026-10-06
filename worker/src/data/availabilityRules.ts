import type { Env } from "../env";
import { supabaseAvailabilityRules } from "./supabase/squad";
import type { AvailabilityRule, AvailabilityRuleType } from "../../../shared/schema/domainTypes";

export interface NewAvailabilityRule {
  playerId: string;
  ruleType: AvailabilityRuleType;
  availability: "Available" | "Maybe" | "Unavailable";
  /** YYYY-MM-DD, or empty for none. */
  startDate?: string;
  endDate?: string;
  notes?: string;
}

export interface AvailabilityRulesRepo {
  listAll(): Promise<AvailabilityRule[]>;
  /** Creates an Active rule. */
  create(rule: NewAvailabilityRule): Promise<AvailabilityRule>;
  delete(id: string): Promise<void>;
}

export function availabilityRules(env: Env): AvailabilityRulesRepo {
  return supabaseAvailabilityRules(env);
}
