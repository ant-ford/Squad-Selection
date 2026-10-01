import { apiGet, apiPost } from '@/lib/apiClient';
import type { JoinerForm, JoinerOptions, JoinerStepKey, JoinerView } from '@shared/joiners';

/** The Section Captain's new joiner screens and the convenors' tasks (worker/src/joiners.ts). */

export function getJoinerOptions(): Promise<JoinerOptions> {
  return apiGet<JoinerOptions>('/api/joiners/options');
}

export function getJoiner(id: string): Promise<JoinerView> {
  return apiGet<JoinerView>(`/api/joiners/${id}`);
}

export function createJoiner(form: JoinerForm, invite: boolean): Promise<{ id: string; invited: boolean }> {
  return apiPost('/api/joiners', { form, invite });
}

export function updateJoiner(id: string, form: JoinerForm): Promise<{ ok: true }> {
  return apiPost(`/api/joiners/${id}`, { form });
}

export function inviteJoiner(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/joiners/${id}/invite`, {});
}

export function requestJoinerStep(id: string, key: JoinerStepKey, convenorId: string): Promise<{ ok: true }> {
  return apiPost(`/api/joiners/${id}/${key}`, { convenorId });
}

export interface JoinerTask {
  id: string;
  kind: JoinerStepKey;
  applicant: string;
  startedAt: string;
  doneAt: string | null;
  rows: [string, string | null][];
  files: { label: string; url: string }[];
}

export function getJoinerTask(id: string): Promise<JoinerTask> {
  return apiGet<JoinerTask>(`/api/joiner-tasks/${id}`);
}

export function completeJoinerTask(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/joiner-tasks/${id}/done`, {});
}
