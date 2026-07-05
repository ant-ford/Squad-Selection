import { apiGet } from '@/lib/apiClient';
import { getCached } from '@/lib/cache';
import type { Player, Team } from '@/generated/domainTypes';

export interface ReferenceData {
  players: Player[];
  teams: Team[];
  teamRankMap: Record<string, number>;
  teamNames: string[];
}

/**
 * Previously fetched Teams + People from Airtable directly (via
 * teamsRepository / peopleRepository) and joined them client-side.
 * That join now happens in the Worker (GET /api/reference-data); this
 * just fetches the already-joined result and keeps the same short-lived
 * in-memory cache so we don't re-hit the Worker on every render.
 */
export async function fetchReferenceData(): Promise<{ data: ReferenceData; fromCache: boolean }> {
  return getCached<ReferenceData>('club-reference', () =>
    apiGet<ReferenceData>('/api/reference-data')
  );
}

export async function getClubReferenceData(): Promise<ReferenceData> {
  const { data } = await fetchReferenceData();
  return data;
}
