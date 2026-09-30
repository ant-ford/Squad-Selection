import { apiGet, apiPost } from '@/lib/apiClient';
import type { MySeasonPlan, SeasonPlanAnswers, SeasonPlanBoard } from '@shared/seasonPlan';

/** The season plan (worker/src/seasonPlan.ts). */
export function getMySeasonPlan(): Promise<MySeasonPlan> {
  return apiGet<MySeasonPlan>('/api/season-plan/me');
}

/** Saves this season's plan; the member details and new joiner forms call it. */
export function submitSeasonPlan(answers: SeasonPlanAnswers): Promise<{ ok: true }> {
  return apiPost('/api/season-plan', answers);
}

export function getSeasonPlanBoard(): Promise<SeasonPlanBoard> {
  return apiGet<SeasonPlanBoard>('/api/season-plan/board');
}
