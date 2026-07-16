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
  blocks: EligibilityIssue[]; // #5: populated by worker from reason
  warnings: string[]; // #4: changed from EligibilityIssue[] to string[]
  conflicts: { type: string; team: string; matchId: string }[]; // #6
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
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  hkfcTeam?: string;
}

export interface GetPlayersForMatchOutput {
  match: MatchInfo;
  players: MatchPlayer[];
}

export async function getPlayersForMatch(matchId: string): Promise<GetPlayersForMatchOutput> {
  return apiGet<GetPlayersForMatchOutput>(`/api/match/${encodeURIComponent(matchId)}/players`);
}