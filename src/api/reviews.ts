import { apiGet, apiPost } from '@/lib/apiClient';
import type { MemberReport, OfficerReview, ReviewView, SponsorReview } from '@shared/commitmentReview';

/** One commitment review, as the signed-in person may see it (worker/src/reviews.ts). */
export function getReview(id: string): Promise<ReviewView> {
  return apiGet<ReviewView>(`/api/reviews/${encodeURIComponent(id)}`);
}

export function submitMemberReport(id: string, report: MemberReport): Promise<{ ok: true; emailed: boolean }> {
  return apiPost(`/api/reviews/${encodeURIComponent(id)}/member`, report);
}

export function submitSponsorReview(id: string, review: SponsorReview): Promise<{ ok: true; emailed: boolean }> {
  return apiPost(`/api/reviews/${encodeURIComponent(id)}/sponsor`, review);
}

export function submitOfficerReview(id: string, review: OfficerReview): Promise<{ ok: true }> {
  return apiPost(`/api/reviews/${encodeURIComponent(id)}/officer`, review);
}
