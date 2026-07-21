import { ABILITYGROUP_CONFIG_FIELDS } from "../generated/fieldMaps";
import { singleSelect } from "../../worker/src/airtable";
import type { AbilityGroupConfiguration } from "../generated/domainTypes";

/**
 * Map a raw Airtable record from the `Ability Group Configuration` table
 * to the domain `AbilityGroupConfiguration` object.
 */
export function mapAbilityGroupConfiguration(
  record: any,
): AbilityGroupConfiguration {
  const f = record.fields ?? {};
  const group = singleSelect(
    f[ABILITYGROUP_CONFIG_FIELDS.group],
  ) as AbilityGroupConfiguration["group"] | undefined;

  if (!group) {
    return { id: record.id, group: "A" as const, capacity: 0, isResidual: false };
  }

  const capacity = Number(f[ABILITYGROUP_CONFIG_FIELDS.capacity] ?? 0);

  return {
    id: record.id,
    group,
    capacity: Number.isFinite(capacity) && capacity >= 0 ? Math.floor(capacity) : 0,
    isResidual: Boolean(f[ABILITYGROUP_CONFIG_FIELDS.isResidual]),
  };
}