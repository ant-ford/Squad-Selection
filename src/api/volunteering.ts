import { apiGet, apiPost } from '@/lib/apiClient';
import type { MyVolunteering, VolunteersBoard, VolunteeringAnswers } from '@shared/volunteering';

/** Volunteering (worker/src/volunteering.ts). */
export function getMyVolunteering(): Promise<MyVolunteering> {
  return apiGet<MyVolunteering>('/api/volunteering/me');
}

/** Saves the signed-in person's volunteering; the forms and "My volunteering" call it. */
export function saveVolunteering(answers: VolunteeringAnswers): Promise<{ ok: true }> {
  return apiPost('/api/volunteering', answers);
}

export function getVolunteersBoard(): Promise<VolunteersBoard> {
  return apiGet<VolunteersBoard>('/api/volunteering/board');
}
