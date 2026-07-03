import { SquadSelection } from '@/generated/domainTypes';
import { SQUADSELECTIONS_FIELDS } from '@/generated/fieldMaps';

export function mapSelection(record: any): SquadSelection {
  const f = record.fields;
  return {
    id: record.id,
    player: f[SQUADSELECTIONS_FIELDS.player] || [],
    match: f[SQUADSELECTIONS_FIELDS.match] || [],
    selectedBy: f[SQUADSELECTIONS_FIELDS.selectedBy] || [],
    selectedAt: f[SQUADSELECTIONS_FIELDS.selectedAt] || '',
    selectionStatus: f[SQUADSELECTIONS_FIELDS.selectionStatus] || '',
    selectionNotes: f[SQUADSELECTIONS_FIELDS.selectionNotes] || '',
  };
}