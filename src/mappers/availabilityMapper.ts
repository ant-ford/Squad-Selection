import { AvailabilityException } from '@/generated/domainTypes';
import { AVAILABILITYEXCEPTIONS_FIELDS } from '@/generated/fieldMaps';
import { singleSelect } from '@/../worker/src/airtable';

export function mapAvailability(record: any): AvailabilityException {
  const f = record.fields;

  return {
    id: record.id,
    player: f[AVAILABILITYEXCEPTIONS_FIELDS.player] || [],
    match: f[AVAILABILITYEXCEPTIONS_FIELDS.match] || [],
    availabilityStatus: singleSelect(f[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]) || '',
    note: f[AVAILABILITYEXCEPTIONS_FIELDS.note] || '',
    season: singleSelect(f[AVAILABILITYEXCEPTIONS_FIELDS.season]) || '',
  };
}