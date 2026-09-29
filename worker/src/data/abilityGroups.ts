import { airtableBatchCreate, airtableBatchUpdate, airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { ABILITYGROUP_CONFIG_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapAbilityGroupConfiguration } from "../../../shared/mappers/abilityGroupConfigMapper";
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

function airtableAbilityGroups(env: Env): AbilityGroupsRepo {
  return {
    async list() {
      const records = await airtableFindAll(env, TABLES.abilityGroupConfiguration);
      return records.map(mapAbilityGroupConfiguration);
    },

    async saveCapacities(capacities) {
      const records = await airtableFindAll(env, TABLES.abilityGroupConfiguration);
      const existing = new Map(records.map((r) => [mapAbilityGroupConfiguration(r).group, r]));
      const updates: { id: string; fields: Record<string, unknown> }[] = [];
      const creates: Record<string, unknown>[] = [];
      for (const [group, capacity] of Object.entries(capacities) as [Group, number][]) {
        const row = existing.get(group);
        if (row) {
          updates.push({ id: row.id, fields: { [ABILITYGROUP_CONFIG_FIELDS.capacity]: capacity } });
        } else {
          creates.push({
            [ABILITYGROUP_CONFIG_FIELDS.group]: group,
            [ABILITYGROUP_CONFIG_FIELDS.capacity]: capacity,
            [ABILITYGROUP_CONFIG_FIELDS.isResidual]: false,
          });
        }
      }
      for (let i = 0; i < updates.length; i += 10) {
        await airtableBatchUpdate(env, TABLES.abilityGroupConfiguration, updates.slice(i, i + 10));
      }
      for (let i = 0; i < creates.length; i += 10) {
        await airtableBatchCreate(env, TABLES.abilityGroupConfiguration, creates.slice(i, i + 10));
      }
    },
  };
}

export function abilityGroups(env: Env): AbilityGroupsRepo {
  return pick(env, "abilityGroups", airtableAbilityGroups);
}
