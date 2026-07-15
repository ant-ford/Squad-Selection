import { Match } from '@/generated/domainTypes';
import { MATCHES_FIELDS } from '@/generated/fieldMaps';

export function mapMatch(record: any): Match {
  const f = record.fields;
  return {
    id: record.id,
    matchDate: f[MATCHES_FIELDS.matchDate] || '',
    season: f[MATCHES_FIELDS.season] || '',
    division: f[MATCHES_FIELDS.division] || '',
    competitionType: f[MATCHES_FIELDS.competitionType] || '',
    homeTeam: f[MATCHES_FIELDS.homeTeam] || '',
    homeTeamScore: f[MATCHES_FIELDS.homeTeamScore] || 0,
    awayTeam: f[MATCHES_FIELDS.awayTeam] || '',
    awayTeamScore: f[MATCHES_FIELDS.awayTeamScore] || 0,
    matchStatus: f[MATCHES_FIELDS.matchStatus] || '',
    venue: f[MATCHES_FIELDS.venue] || '',
    fixtureId: f[MATCHES_FIELDS.fixtureId] || '',
    selectedPlayersHome: f[MATCHES_FIELDS.selectedPlayersHome] || [],
    selectedPlayersAway: f[MATCHES_FIELDS.selectedPlayersAway] || [],
  };
}