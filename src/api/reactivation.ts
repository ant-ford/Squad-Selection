import { apiGet, apiPost } from '@/lib/apiClient';

/** Ask to be reactivated (worker/src/reactivation.ts). */
export interface ReactivationAsk {
  status: 'asked' | 'active' | 'nobody' | 'no-captains';
  askedAt?: string;
}

export interface ReactivationRequest {
  id: string;
  name: string;
  team: string | null;
  askedAt: string;
  inactiveSince: string | null;
  doneAt: string | null;
  doneBy: string | null;
}

export function getReactivationStatus(): Promise<{ askedAt: string | null }> {
  return apiGet('/api/reactivation');
}

export function askToBeReactivated(): Promise<ReactivationAsk> {
  return apiPost('/api/reactivation', {});
}

export function getReactivationRequest(id: string): Promise<ReactivationRequest> {
  return apiGet(`/api/reactivation/${encodeURIComponent(id)}`);
}

export function answerReactivation(id: string, activate: boolean): Promise<{ status: 'activated' | 'declined' | 'closed' }> {
  return apiPost(`/api/reactivation/${encodeURIComponent(id)}`, { activate });
}
