import { apiGet } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

export interface MyFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
}

export interface GetMyFixturesOutput {
  playerName: string;
  registeredTeam: string;
  playingPosition: string;
  shirtNoValue: string;
  isCoach: boolean;
  fixtures: MyFixture[];
}

/**
 * Previously built this response by hand from Matches / Squad Selections /
 * Availability Exceptions fetched straight from Airtable. That join now
 * lives in the Worker (GET /api/my-fixtures); this just resolves the
 * current user's email and asks for their fixtures.
 */
export async function getMyFixtures(): Promise<GetMyFixturesOutput> {
  const user = await getCurrentSupabaseUser();
  if (!user?.email) throw new Error('Not authenticated');

  return apiGet<GetMyFixturesOutput>('/api/my-fixtures', { email: user.email });
}
