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
  blocks: EligibilityIssue[];
  warnings: EligibilityIssue[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectionStatus: string;
  selectionId: string;
}

export interface MatchInfo {
  date: string;
  homeTeam: string;
  awayTeam: string;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
}

export interface GetPlayersForMatchOutput {
  match: MatchInfo;
  players: MatchPlayer[];
}

/**
 * The eligibility engine (player list + block/warning reasons) now runs
 * in the Worker (GET /api/match/:matchId/players) instead of in the
 * browser, so it can trust its own read of Airtable rather than data a
 * client could tamper with in devtools.
 */
export async function getPlayersForMatch(matchId: string): Promise<GetPlayersForMatchOutput> {
  return apiGet<GetPlayersForMatchOutput>(`/api/match/${encodeURIComponent(matchId)}/players`);
}
