import { apiGet, apiPost } from '@/lib/apiClient';
import type { SignRole, SigningView, SponsorAnswers } from '@shared/signing';

/** Signing a new member's application (worker/src/applicationSigning.ts). */

export function getSigningView(id: string): Promise<SigningView> {
  return apiGet<SigningView>(`/api/applications/${id}/sign`);
}

export function getSponsorDrafts(id: string): Promise<SigningView['drafts']> {
  return apiPost(`/api/applications/${id}/drafts`, {});
}

export function signApplication(id: string, role: SignRole, signature: string | undefined, answers?: SponsorAnswers): Promise<{ stage: string }> {
  return apiPost(`/api/applications/${id}/sign`, { role, signature, answers });
}
