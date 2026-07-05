import { apiPost } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

export async function setMyAvailability(
  matchId: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string,
  existingExceptionId?: string
) {
  const user = await getCurrentSupabaseUser();
  if (!user?.email) throw new Error('Not authenticated');

  return apiPost<{ success: boolean }>('/api/set-my-availability', {
    email: user.email,
    matchId,
    status,
    notes,
    existingExceptionId,
  });
}
