import { apiGet } from '@/lib/apiClient';
import type { SeasonSummary } from '@shared/clubStats';

export interface SeasonStats extends SeasonSummary {
  /** The signed-in player's own key (People record id), when they are one. */
  me?: string;
  /** The signed-in player's own cards that season; nobody else's are ever sent. */
  myCards?: { yellow: number; red: number };
}

export function getSeasonStats(season: string): Promise<SeasonStats> {
  return apiGet<SeasonStats>('/api/stats/season', { season });
}

/** "2026-2027" -> "2026-27". */
export const shortSeason = (season: string) => `${season.slice(0, 4)}-${season.slice(7, 9)}`;

/** The current season and the ones before it, newest first. */
export function recentSeasons(current: string, count: number): string[] {
  const start = Number(current.slice(0, 4));
  return Array.from({ length: count }, (_, i) => `${start - i}-${start - i + 1}`);
}
