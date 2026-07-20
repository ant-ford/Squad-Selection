import { apiGet } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

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
  const user = await getCurrentSupabaseUser();
  return apiGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', {
    email: user?.email,
    team: teamFilter,
  });
}