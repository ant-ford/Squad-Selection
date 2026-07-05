import { apiPost } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';

export async function selectPlayer(
  matchId: string,
  playerId: string,
  selectionStatus: 'Selected'
) {
  const user = await getCurrentSupabaseUser();

  // The Worker re-validates every eligibility rule server-side before
  // creating the Squad Selection record — the client can't bypass this
  // by calling the endpoint directly with different arguments.
  return apiPost<{ id: string; success: boolean }>('/api/select-player', {
    matchId,
    playerId,
    selectionStatus,
    actingEmail: user?.email,
  });
}
