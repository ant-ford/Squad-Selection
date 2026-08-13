import { apiGet } from '@/lib/apiClient';

export interface UpcomingFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  selectedIds?: string[];
  selectedPlayers?: { id: string; name: string }[];
  selectedPositionSummary?: Record<string, number>;
  selectedUnavailableNames?: string[];
  hasGoalkeeperSelected?: boolean;
  availableCount: number;
  maybeCount: number;
  unavailableCount: number;
  maybeNames?: string[];
  unavailableNames?: string[];
}

export interface GetUpcomingFixturesOutput {
  fixtures: UpcomingFixture[];
}

export async function getUpcomingFixtures(teamFilter?: string): Promise<GetUpcomingFixturesOutput> {
  // The Worker derives the identity from the verified Supabase session.
  return apiGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', {
    team: teamFilter,
  });
}