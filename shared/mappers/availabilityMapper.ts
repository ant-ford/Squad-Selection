import { AvailabilityException } from '../schema/domainTypes';
import { AVAILABILITYEXCEPTIONS_FIELDS } from '../schema/fieldMaps';
import { linkId } from '../airtableValueUtils';

export function mapAvailability(record: any): AvailabilityException {
  const f = record.fields;
  return {
    id: record.id,
    player: f[AVAILABILITYEXCEPTIONS_FIELDS.player] || [],
    match: f[AVAILABILITYEXCEPTIONS_FIELDS.match] || [],
    availabilityStatus: linkId(f[AVAILABILITYEXCEPTIONS_FIELDS.availabilityStatus]) || '',
    note: f[AVAILABILITYEXCEPTIONS_FIELDS.note] || '',
    season: linkId(f[AVAILABILITYEXCEPTIONS_FIELDS.season]) || '',
    updatedAt: f[AVAILABILITYEXCEPTIONS_FIELDS.updatedAt] || '',
  };
}