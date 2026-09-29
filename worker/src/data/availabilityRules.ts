import { airtableCreate, airtableDelete, airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { AVAILABILITYRULES_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapAvailabilityRule } from "../../../shared/mappers/availabilityRuleMapper";
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

function airtableAvailabilityRules(env: Env): AvailabilityRulesRepo {
  return {
    async listAll() {
      const records = await airtableFindAll(env, TABLES.availabilityRule);
      return records.map(mapAvailabilityRule);
    },

    async create(rule) {
      const fields: Record<string, unknown> = {
        [AVAILABILITYRULES_FIELDS.player]: [rule.playerId],
        [AVAILABILITYRULES_FIELDS.ruleType]: rule.ruleType,
        [AVAILABILITYRULES_FIELDS.availability]: rule.availability,
        [AVAILABILITYRULES_FIELDS.active]: true,
      };
      if (rule.startDate) fields[AVAILABILITYRULES_FIELDS.startDate] = rule.startDate;
      if (rule.endDate) fields[AVAILABILITYRULES_FIELDS.endDate] = rule.endDate;
      if (rule.notes) fields[AVAILABILITYRULES_FIELDS.notes] = rule.notes;
      return mapAvailabilityRule(await airtableCreate(env, TABLES.availabilityRule, fields));
    },

    async delete(id) {
      await airtableDelete(env, TABLES.availabilityRule, id);
    },
  };
}

export function availabilityRules(env: Env): AvailabilityRulesRepo {
  return pick(env, "availabilityRules", airtableAvailabilityRules);
}
