import { apiGet } from '@/lib/apiClient';

export interface Recommendation {
  id: string;
  preferredName: string;
  playingPosition: string;
  playingAbility: string;
  playUpCount: number;
  registeredTeam: string;
  eligibilityStatus: 'eligible' | 'warning' | 'blocked';
  score: number;
  reasons: string[];
}

export interface GetRecommendationsOutput {
  matchId: string;
  side?: 'home' | 'away';
  targetPosition: string | null;
  recommendations: Recommendation[];
}

export async function getRecommendations(matchId: string, side?: 'home' | 'away', position?: string) {
  return apiGet<GetRecommendationsOutput>(`/api/match/${matchId}/recommendations`, { side, position });
}
