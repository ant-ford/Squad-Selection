import { apiPost } from '@/lib/apiClient';

export async function removeSelection(matchId: string, playerId: string) {
  return apiPost<{ success: boolean }>('/api/remove-selection', { matchId, playerId });
}