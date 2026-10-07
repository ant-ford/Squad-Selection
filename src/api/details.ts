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

/** Replaces their photo, HKID or passport copy with a data URL (already shrunk in the browser). */
/** A photo may come with its 128 px thumbnail (FileUpload.tsx), kept for the lists' avatars. */
export function uploadDetailsFile(kind: 'photo' | 'hkid' | 'passport', dataUrl: string, thumbDataUrl?: string): Promise<{ ok: true; url: string | null }> {
  return apiPost(`/api/details/files/${kind}`, thumbDataUrl ? { dataUrl, thumbDataUrl } : { dataUrl });
}

/** What an AI reading of their HKID or passport picture suggests for the Personal details (nothing is stored). */
export function readIdDocument(kind: 'hkid' | 'passport', dataUrl: string): Promise<{ suggestions: Record<string, string> }> {
  return apiPost('/api/details/read-id', { kind, dataUrl });
}

/** The end of the start-of-season check. */
export function confirmDetails(): Promise<{ ok: true }> {
  return apiPost('/api/details/confirm', {});
}

/** "Delete my profile": removes their personal details, files and sign-in. Can't be undone. */
export function deleteMyProfile(): Promise<{ ok: true }> {
  return apiPost('/api/details/delete-profile', { confirm: 'DELETE' });
}
