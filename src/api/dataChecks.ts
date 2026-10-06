import { apiGet, apiPost } from '@/lib/apiClient';

/**
 * Data checks (the `dataChecks` section: the Men's Convenor and Section
 * Captains). GET /api/admin/data-checks (worker/src/dataChecks.ts), the
 * match-card link and the re-registration resolve. The shapes mirror
 * shared/dataChecks.ts on main.
 */

export interface DataCheckPerson {
  /** People api id. */
  id: string;
  name: string;
  team: string | null;
  active: boolean;
  status: string | null;
}

export interface UnlinkedCard {
  /** Match card api id. */
  id: string;
  /** The name as HKHA printed it. */
  rawName: string;
  team: string | null;
  matchDate: string | null;
  opponent: string | null;
  /** Up to three people whose names look like it, closest first. */
  suggestions: DataCheckPerson[];
}

export interface SharedRegisteredName {
  registeredName: string;
  people: DataCheckPerson[];
}

export interface ReRegistration {
  /** registration_events id. */
  id: string;
  person: DataCheckPerson;
  season: string;
  previousTeam: string;
  suggestedTeam: string | null;
  detail: string | null;
  playUps: { matchDate: string | null; team: string | null }[];
  createdAt: string;
}

export type MissingField = 'team' | 'position' | 'ability';

export interface IncompletePlayer {
  person: DataCheckPerson;
  missing: MissingField[];
}

export type DuplicateMatch = 'name' | 'dob' | 'mobile' | 'email';

export interface DuplicateGroup {
  match: DuplicateMatch;
  people: DataCheckPerson[];
}

export type NeedsFixingKind = 'stage' | 'review' | 'legacySuspension';

export interface NeedsFixing {
  kind: NeedsFixingKind;
  person: DataCheckPerson | null;
  commitmentId?: string;
  /** The stage or review value that isn't on the list ("" when blank); the flag names for a suspension. */
  value: string;
}

export interface DataChecks {
  unlinkedCards: UnlinkedCard[];
  sharedRegisteredNames: SharedRegisteredName[];
  reRegistrations: ReRegistration[];
  incomplete: IncompletePlayer[];
  duplicates: DuplicateGroup[];
  needsFixing: NeedsFixing[];
}

export function getDataChecks(): Promise<DataChecks> {
  return apiGet('/api/admin/data-checks');
}

/** Links a card to a person; with saveName the card's name becomes their Registered Name. */
export function linkMatchCard(cardId: string, personId: string, saveName: boolean): Promise<{ ok: true; linked: number }> {
  return apiPost(`/api/admin/match-cards/${encodeURIComponent(cardId)}/link`, { personId, saveName });
}

export type ResolveAction = { action: 'keep' } | { action: 'move'; team: string };

export function resolveReRegistration(eventId: string, change: ResolveAction): Promise<{ ok: true; team: string }> {
  return apiPost(`/api/admin/registration-events/${encodeURIComponent(eventId)}/resolve`, change);
}
