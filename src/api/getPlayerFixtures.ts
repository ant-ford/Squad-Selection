import { apiGet } from '@/lib/apiClient';

export interface PlayerFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
}

export interface GetPlayerFixturesOutput {
  playerName: string;
  registeredTeam: string;
  fixtures: PlayerFixture[];
}

/**
 * Unauthenticated, player-facing view reached via the Fillout URL
 * parameter. Previously queried Airtable directly with the Airtable
 * token embedded in the bundle; now calls the Worker, which holds
 * the token instead.
 */
export async function getPlayerFixtures(playerId: string): Promise<GetPlayerFixturesOutput> {
  return apiGet<GetPlayerFixturesOutput>(`/api/player-fixtures/${encodeURIComponent(playerId)}`);
}
