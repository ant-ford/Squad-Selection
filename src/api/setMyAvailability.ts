import { apiPost } from '@/lib/apiClient';

export async function setMyAvailability(
  matchId: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string,
  existingExceptionId?: string
) {
  // The Worker derives the player identity from the verified Supabase
  // session; the browser never supplies the email.
  return apiPost<{ success: boolean; exceptionId: string | null }>('/api/set-my-availability', {
    matchId,
    status,
    notes,
    existingExceptionId,
  });
}
