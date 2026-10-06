import { apiGet, apiPost } from '@/lib/apiClient';
import { saveCsv } from '@/lib/saveCsv';
import type { RegistrationBoard } from '@shared/registration';

/** HKHA registration, the Hockey Convenor's screen (worker/src/registration.ts). */
export function getRegistrationBoard(): Promise<RegistrationBoard> {
  return apiGet<RegistrationBoard>('/api/registration/board');
}

/** Ticks players off as registered with HockeyHK this season. */
export function markRegistered(ids: string[]): Promise<{ ok: true; count: number }> {
  return apiPost('/api/registration/registered', { ids });
}

/** Takes a tick back off: they need registering again. */
export function unmarkRegistered(id: string): Promise<{ ok: true }> {
  return apiPost('/api/registration/unregistered', { id });
}

/** Saves a Registered Name and/or the visiting flag. Returns how many of this season's match cards the name linked. */
export function saveRegistrationDetails(id: string, change: { registeredName?: string | null; visiting?: boolean }): Promise<{ ok: true; linked: number }> {
  return apiPost('/api/registration/details', { id, ...change });
}

/** Downloads the details as a CSV (everyone, or only who needs registering; one team or all). Returns how many. */
export async function downloadRegistration(opts: { todo: boolean; team: string | null }): Promise<number> {
  const params: Record<string, string> = {};
  if (opts.todo) params.todo = '1';
  if (opts.team) params.team = opts.team;
  const { filename, csv, count } = await apiGet<{ filename: string; csv: string; count: number }>('/api/registration/export', params);
  saveCsv(filename, csv);
  return count;
}
