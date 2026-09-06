import { apiPost } from '@/lib/apiClient';

export async function setMyAvailability(
  matchId: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string
) {
  // The Worker derives the player identity from the verified Supabase
  // session; the browser never supplies the email.
  return apiPost<{ success: boolean; exceptionId: string | null }>('/api/set-my-availability', {
    matchId,
    status,
    notes,
  });
}

/**
 * Date-level bulk availability for the special goalkeeper view. A UX
 * shortcut: the Worker performs the existing match-level updates for every
 * HKFC fixture on that date ("Available" deletes exceptions - no Available
 * records are created). Individual fixtures remain overridable afterwards.
 */
export async function setMyAvailabilityForDate(
  date: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string
) {
  return apiPost<{
    success: boolean;
    updated: number;
    results: { matchId: string; exceptionId: string | null }[];
  }>('/api/set-my-availability-for-date', { date, status, notes });
}
