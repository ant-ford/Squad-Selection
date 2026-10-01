import { apiGet, apiPost } from '@/lib/apiClient';
import type { SignRole, SigningView, SponsorAnswers } from '@shared/signing';

/** Signing a new member's application (worker/src/applicationSigning.ts). */

export function getSigningView(id: string): Promise<SigningView> {
  return apiGet<SigningView>(`/api/applications/${id}/sign`);
}

export function getSponsorDrafts(id: string): Promise<SigningView['drafts']> {
  return apiPost(`/api/applications/${id}/drafts`, {});
}

/** A Membership Officer makes the application's PDF again (after a correction). */
export function remakeApplicationPdf(id: string): Promise<SigningView> {
  return apiPost(`/api/applications/${id}/pdf`, {});
}

/** A Membership Officer has checked the PDF and sends it on. */
export function sendApplication(id: string, again = false): Promise<SigningView> {
  return apiPost(`/api/applications/${id}/send`, { again });
}

export function signApplication(id: string, role: SignRole, signature: string | undefined, answers?: SponsorAnswers): Promise<{ stage: string }> {
  return apiPost(`/api/applications/${id}/sign`, { role, signature, answers });
}
