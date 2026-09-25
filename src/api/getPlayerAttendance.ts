import { apiGet } from '@/lib/apiClient';

export type AttendanceStatus =
  | 'played'
  | 'selected'
  | 'elsewhere'
  | 'not-selected'
  | 'no-show'
  | 'available'
  | 'maybe'
  | 'unavailable'
  | 'off';

export type AvailabilitySource = 'answer' | 'rule' | 'opt-in' | 'default';

export interface AttendanceCell {
  team: string;
  /** YYYY-MM-DD, Hong Kong. */
  date: string;
  matchId: string;
  opponent: string;
  isHome: boolean;
  past: boolean;
  friendly: boolean;
  status: AttendanceStatus;
  availability: 'Available' | 'Maybe' | 'Unavailable';
  source: AvailabilitySource;
  elsewhereTeam?: string;
  goalsFor?: number;
  goalsAgainst?: number;
  goals?: number;
  /** Played is assumed: they were picked and the match has no Match Cards. */
  assumed?: boolean;
}

export interface PlayerAttendance {
  season: string;
  team: string;
  today: string;
  teams: string[];
  dates: string[];
  cells: AttendanceCell[];
  playerName: string;
}

/** Per-fixture attendance and availability for a player. Readable by that player or by any coach. */
export async function getPlayerAttendance(playerId: string): Promise<PlayerAttendance> {
  return apiGet<PlayerAttendance>(`/api/player-attendance/${encodeURIComponent(playerId)}`);
}
