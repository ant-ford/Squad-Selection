import { apiGet, apiPost } from '@/lib/apiClient';
import type { DeclarationsSubmission, DeclarationsView } from '@shared/declarations';

/** This season's waivers for the signed-in player (worker/src/declarations.ts). */
export function getMyDeclarations(): Promise<DeclarationsView> {
  return apiGet<DeclarationsView>('/api/declarations/me');
}

export function submitDeclarations(body: DeclarationsSubmission): Promise<{ ok: true; underEighteen: boolean }> {
  return apiPost('/api/declarations', body);
}
