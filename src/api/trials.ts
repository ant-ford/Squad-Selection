import { apiGet, apiPost } from '@/lib/apiClient';
import type { JoinResult, MyTrial, TrialSession } from '@shared/trials';

/** Registering to join, trial sessions and practice trials (worker/src/trials.ts). */

export function registerInterest(ref: string | null): Promise<JoinResult> {
  return apiPost('/api/join/register', { ref });
}

export function getMyTrial(): Promise<MyTrial> {
  return apiGet<MyTrial>('/api/trials/me');
}

export function saveMyTrial(sessionIds: string[]): Promise<{ ok: true }> {
  return apiPost('/api/trials/me', { sessionIds });
}

export function submitRegistration(): Promise<{ ok: true }> {
  return apiPost('/api/trials/submit', {});
}

export function listTrialSessions(): Promise<{ sessions: (TrialSession & { count: number })[] }> {
  return apiGet('/api/trials/sessions');
}

export function addTrialSession(startsAt: string, place: string, notes: string): Promise<{ id: string }> {
  return apiPost('/api/trials/sessions', { startsAt, place, notes });
}

export function removeTrialSession(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/trials/sessions/${id}/remove`, {});
}

export function invitePracticeTrial(id: string, team: string, when: string): Promise<{ ok: true }> {
  return apiPost(`/api/joiners/${id}/practice-trial`, { team, when });
}

export function declineRegistration(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/joiners/${id}/decline`, {});
}
