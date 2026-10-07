import { apiGet, apiPost } from '@/lib/apiClient';

/**
 * The officers' person search, person page and history (worker/src/admin/:
 * GET /api/admin/people, GET /api/admin/people/:id, GET /api/history, POST
 * .../membership and .../stage). The shapes mirror shared/adminPeople.ts and
 * shared/history.ts on the API side.
 */

/** One search result. */
export interface PersonSearchRow {
  id: string;
  name: string;
  team: string | null;
  status: string | null;
  stage: string | null;
  active: boolean;
}

/** Membership details as stored; also the save's `expect`. */
export interface PersonMembership {
  memberType: string | null;
  categoryType: string | null;
  membershipNo: string | null;
  joinDate: string | null;
  commitmentEndDate: string | null;
}

/** Which blocks the caller's offices open; the server checks again on every save. */
export interface PersonAdminCan {
  membership: boolean;
  stage: boolean;
  squad: boolean;
  registeredTeam: boolean;
  suspend: boolean;
  activate: boolean;
  juniorRoute: boolean;
}

export interface PersonAdminView {
  id: string;
  name: string;
  status: string | null;
  stage: string | null;
  active: boolean;
  team: string | null;
  can: PersonAdminCan;
  /** Only when can.membership. */
  membership?: PersonMembership;
  /** Only when can.stage; already filtered to the moves allowed. */
  stageTargets?: string[];
}

export interface HistoryEntry {
  /** ISO timestamp. */
  at: string;
  actor: string | null;
  action: string;
  /** Short label, e.g. "Membership details changed". */
  summary: string;
  /** Field labels, never values. */
  fields: string[];
}

export type MembershipKey = keyof PersonMembership;

/** A membership save: the changed fields, what the screen read for them, and the shared-number acknowledgement. */
export type MembershipSave = Partial<PersonMembership> & {
  expect: Partial<PersonMembership>;
  sharedNumberAcknowledged?: boolean;
};

export function searchPeople(q: string): Promise<{ people: PersonSearchRow[] }> {
  return apiGet('/api/admin/people', { q });
}

export function getPersonAdmin(id: string): Promise<PersonAdminView> {
  return apiGet(`/api/admin/people/${encodeURIComponent(id)}`);
}

export function getPersonHistory(id: string): Promise<{ entries: HistoryEntry[] }> {
  return apiGet('/api/history', { person: id });
}

/** A fixture's squad changes, fixture changes and answers coaches gave (its coaches and officers). */
export function getMatchHistory(id: string): Promise<{ entries: HistoryEntry[] }> {
  return apiGet('/api/history', { match: id });
}

export function saveMembership(id: string, body: MembershipSave): Promise<{ ok: true; changed: string[]; removedPeriods: number }> {
  return apiPost(`/api/admin/people/${encodeURIComponent(id)}/membership`, body);
}

export function moveStage(id: string, stage: string, from: string | null): Promise<{ ok: true; changed: string[] }> {
  return apiPost(`/api/admin/people/${encodeURIComponent(id)}/stage`, { stage, from });
}

/** Section Captains only (the ranking endpoints). */
export function setPlayerActive(id: string, active: boolean): Promise<unknown> {
  return apiPost(active ? '/api/ranking/activate' : '/api/ranking/deactivate', { playerId: id });
}
