import { AvailabilityRule, AvailabilityRuleType } from '@/generated/domainTypes';
import { AVAILABILITYRULES_FIELDS } from '@/generated/fieldMaps';
import { singleSelect } from '@/lib/airtableValueUtils';

/** Airtable date fields come back as YYYY-MM-DD (or ISO); keep the date part. */
function dateOnly(value: unknown): string {
  return typeof value === 'string' ? value.split('T')[0] : '';
}

export function mapAvailabilityRule(record: any): AvailabilityRule {
  const f = record.fields ?? {};
  return {
    id: record.id,
    player: f[AVAILABILITYRULES_FIELDS.player] || [],
    ruleType: (singleSelect(f[AVAILABILITYRULES_FIELDS.ruleType]) || '') as AvailabilityRuleType | '',
    availability: (singleSelect(f[AVAILABILITYRULES_FIELDS.availability]) || '') as AvailabilityRule['availability'],
    active: f[AVAILABILITYRULES_FIELDS.active] === true,
    startDate: dateOnly(f[AVAILABILITYRULES_FIELDS.startDate]),
    endDate: dateOnly(f[AVAILABILITYRULES_FIELDS.endDate]),
    notes: f[AVAILABILITYRULES_FIELDS.notes] || '',
    lastModified: f[AVAILABILITYRULES_FIELDS.lastModified] || '',
  };
}
