import { apiGet, apiPost } from '@/lib/apiClient';
import type { MyDetails, ProfileValues, SectionKey } from '@shared/profile';
import type { KitSizes } from '@shared/kit';

/** The signed-in person's details (worker/src/details.ts). */
export function getMyDetails(): Promise<MyDetails> {
  return apiGet<MyDetails>('/api/details/me');
}

export function saveDetailsSection(section: SectionKey, values: ProfileValues): Promise<{ ok: true }> {
  return apiPost(`/api/details/sections/${section}`, { values });
}

export function saveKitSizes(sizes: KitSizes): Promise<{ ok: true }> {
  return apiPost('/api/details/kit', { sizes });
}

/** Replaces their photo or HKID copy with a data URL (already shrunk in the browser). */
export function uploadDetailsFile(kind: 'photo' | 'hkid', dataUrl: string): Promise<{ ok: true; url: string | null }> {
  return apiPost(`/api/details/files/${kind}`, { dataUrl });
}

/** The end of the start-of-season check. */
export function confirmDetails(): Promise<{ ok: true }> {
  return apiPost('/api/details/confirm', {});
}
