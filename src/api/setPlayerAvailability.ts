import { apiPost } from '@/lib/apiClient';

export type AvailabilityStatus = 'Available' | 'Maybe' | 'Unavailable';

/**
 * A coach sets a player's availability for one fixture (coach only).
 *
 * For the player who texted the coach instead of opening the app. The Worker
 * takes the coach's identity from the session and records it as the author
 * of the change; the player is named in the body.
 */
export async function setPlayerAvailability(
  matchId: string,
  playerId: string,
  status: AvailabilityStatus,
  notes?: string,
): Promise<{ success: boolean; exceptionId: string | null }> {
  return apiPost(`/api/match/${encodeURIComponent(matchId)}/availability`, {
    playerId,
    status,
    notes,
  });
}
