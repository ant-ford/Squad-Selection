import { Team } from '@/generated/domainTypes';
import { TEAMS_FIELDS } from '@/generated/fieldMaps';

export function mapTeam(record: any): Team {
  const f = record.fields;
  return {
    id: record.id,
    teamName: f[TEAMS_FIELDS.teamName] || '',
    teamRank: f[TEAMS_FIELDS.teamRank] || 99,
    isPremier: f[TEAMS_FIELDS.isPremier] || false,
    targetSquadSize: f[TEAMS_FIELDS.targetSquadSize] || 16,
    active: f[TEAMS_FIELDS.active] || false,
    coach: Array.isArray(f[TEAMS_FIELDS.coach]) ? f[TEAMS_FIELDS.coach] : (f[TEAMS_FIELDS.coach] ? [f[TEAMS_FIELDS.coach]] : []),
    teamCaptain: Array.isArray(f[TEAMS_FIELDS.teamCaptain]) ? f[TEAMS_FIELDS.teamCaptain] : (f[TEAMS_FIELDS.teamCaptain] ? [f[TEAMS_FIELDS.teamCaptain]] : []),
    sectionCaptain: Array.isArray(f[TEAMS_FIELDS.sectionCaptain]) ? f[TEAMS_FIELDS.sectionCaptain] : (f[TEAMS_FIELDS.sectionCaptain] ? [f[TEAMS_FIELDS.sectionCaptain]] : []),
  };
}