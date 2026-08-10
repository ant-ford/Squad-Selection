import { apiGet } from '@/lib/apiClient';

export interface EligibilityIssue {
  rule: string;
  reason: string;
}

export interface MatchPlayer {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  availabilityStatus: string;
  playerNotes: string;
  playUpCount: number;
  eligibilityStatus: 'eligible' | 'warning' | 'blocked';
  reason: string | null;
  blocks: EligibilityIssue[];
  warnings: string[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectedByTeam?: string | null;
  sameDayHigherTeam?: string | null;
  selectionStatus: string;
  selectionId: string;
  isU21?: boolean;
  isVisitingPlayer?: boolean;
}

export interface MatchInfo {
  date: string;
  homeTeam: string;
  awayTeam: string;
  division: string;
  competitionType?: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  hkfcTeam?: string;
  autoSelectEnabled?: boolean;
  autoSelectPlayerIds?: string[];
}

export interface GetPlayersForMatchOutput {
  match: MatchInfo;
  players: MatchPlayer[];
}

export async function getPlayersForMatch(matchId: string): Promise<GetPlayersForMatchOutput> {
  return apiGet<GetPlayersForMatchOutput>(`/api/match/${encodeURIComponent(matchId)}/players`);
}