import { apiGet } from '@/lib/apiClient';
import type { AttendanceStatus, AvailabilitySource } from '@/api/getPlayerAttendance';

export interface SquadCell {
  status: AttendanceStatus;
  source: AvailabilitySource;
  elsewhereTeam?: string;
}

export interface SquadPlayer {
  id: string;
  name: string;
  position?: string;
  /** Keyed by match id: only fixtures of the player's own squad team. */
  cells: Record<string, SquadCell>;
}

export interface TeamSquad {
  team: string;
  targetSquadSize: number;
  players: SquadPlayer[];
}

export interface TeamFixture {
  team: string;
  /** YYYY-MM-DD, Hong Kong. */
  date: string;
  matchId: string;
  opponent: string;
  isHome: boolean;
  past: boolean;
  friendly: boolean;
  off: boolean;
  selectedCount: number;
  goalsFor?: number;
  goalsAgainst?: number;
}

export interface TeamAttendance {
  season: string;
  today: string;
  dates: string[];
  teams: TeamSquad[];
  fixtures: TeamFixture[];
}

/** Every squad's per-fixture availability for the season. Coach only. */
export async function getTeamAttendance(): Promise<TeamAttendance> {
  return apiGet<TeamAttendance>('/api/team-attendance');
}
