import { apiPost } from '@/lib/apiClient';

export async function setAvailability(
  playerId: string,
  matchIds: string[],
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string
) {
  return apiPost<{ success: boolean; updated: number }>('/api/set-availability', {
    playerId,
    matchIds,
    status,
    notes,
  });
}
