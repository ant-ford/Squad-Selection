import { apiGet, apiPost } from '@/lib/apiClient';

export interface EligibilityIssue {
  rule: string;
  reason: string;
}

export interface MatchPlayer {
  id: string;
  preferredName: string;
  /** Raw stored mobile number; coach-only payload. May be blank or malformed. */
  mobile?: string;
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
  /** Soft signal: available for this fixture but Unavailable for same-day lower-team fixtures. */
  supportUnavailable?: string[];
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
  /** Side this screen is selecting; the kit toggle writes that side's field. */
  side?: 'home' | 'away';
  /** Shirt colour for that side. '' until a coach picks one. */
  kit?: KitColour;
}

/** Shirt colour options. '' means not yet decided. */
export type KitColour = 'Blue' | 'White' | '';

/** Set the shirt colour for one side of a fixture (coach only). */
export async function setMatchKit(
  matchId: string,
  side: 'home' | 'away',
  kit: KitColour,
): Promise<{ success: boolean; side: string; kit: string }> {
  return apiPost(`/api/match/${encodeURIComponent(matchId)}/kit`, { side, kit });
}

export interface GetPlayersForMatchOutput {
  match: MatchInfo;
  players: MatchPlayer[];
}

export async function getPlayersForMatch(matchId: string): Promise<GetPlayersForMatchOutput> {
  return apiGet<GetPlayersForMatchOutput>(`/api/match/${encodeURIComponent(matchId)}/players`);
}