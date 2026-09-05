import { apiGet } from '@/lib/apiClient';

export type GameOutcome = 'win' | 'draw' | 'loss';

export interface PlayerGameResult {
  matchId: string;
  date: string;
  team: string;
  opponent: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  outcome: GameOutcome;
  goals: number;
  cards: string[];
  cardPoints: number;
}

export interface PlayerSeasonStats {
  season: string;
  team: string;
  playerName: string;
  gamesPlayed: number;
  gamesAvailableNotSelected: number;
  gamesUnavailable: number;
  teamGames: number;
  participationPct: number | null;
  availabilityPct: number | null;
  goals: number;
  cardPoints: number;
  recentGames: PlayerGameResult[];
}

/** Season stats for a player. Readable by that player or by any coach. */
export async function getPlayerStats(playerId: string): Promise<PlayerSeasonStats> {
  return apiGet<PlayerSeasonStats>(`/api/player-stats/${encodeURIComponent(playerId)}`);
}
