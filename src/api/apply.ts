import { apiGet, apiPost } from '@/lib/apiClient';
import type { ApplyView, FamilyMemberDetails, PrivateClub, Relative, TrialAttended } from '@shared/application';

/** The signed-in applicant's own application (worker/src/apply.ts). */
export function getApply(): Promise<ApplyView> {
  return apiGet<ApplyView>('/api/apply/me');
}

export function saveFamily(body: {
  spouse: FamilyMemberDetails | null;
  children: FamilyMemberDetails[];
  relatives: Relative[];
}): Promise<{ spouseId: string | null; childIds: string[] }> {
  return apiPost('/api/apply/family', body);
}

export function saveClubs(clubs: PrivateClub[]): Promise<{ ok: true }> {
  return apiPost('/api/apply/clubs', { clubs });
}

export function saveTrials(trials: TrialAttended[], participationDetails: string): Promise<{ ok: true }> {
  return apiPost('/api/apply/trials', { trials, participationDetails });
}

/** The applicant's marriage certificate, or a family member's photo, HKID or birth certificate. */
export function uploadApplicantFile(kind: string, dataUrl: string, memberId?: string): Promise<{ ok: true }> {
  return apiPost(memberId ? `/api/apply/family/${memberId}/files/${kind}` : `/api/apply/files/${kind}`, { dataUrl });
}

/** A clearer version of one of their longer answers (the Polish button). */
export function polishAnswer(field: string, text: string): Promise<{ text: string }> {
  return apiPost('/api/apply/polish', { field, text });
}

export function submitApplication(body: {
  version: string;
  accepted: string[];
  signatures: { applicant?: string; spouse?: string; guardian?: string; guardianAccount?: string; children?: Record<string, string> };
}): Promise<{ ok: true }> {
  return apiPost('/api/apply/submit', body);
}
