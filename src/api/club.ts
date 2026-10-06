import { apiGet, apiPost } from '@/lib/apiClient';

/**
 * Offices and teams, the Section Captains' screen (worker/src/admin/club.ts,
 * the `club` section). The shapes mirror that file on the API side.
 */

export type ClubOffice =
  | 'sectionCaptain'
  | 'sectionChair'
  | 'membershipOfficer'
  | 'hockeyConvenor'
  | 'kitConvenor'
  | 'assistantDirector'
  | 'umpireCoordinator'
  | 'sponsor';

export interface Holder {
  id: string;
  name: string;
}

export interface OfficeView {
  /** The office row's id (what `replaces` names). */
  id: string;
  office: ClubOffice;
  designation: string | null;
  officeEmail: string | null;
  status: 'Active' | 'Retired';
  holder: Holder | null;
}

export interface TeamAdminView {
  id: string;
  name: string;
  rank: number | null;
  active: boolean;
  targetSquadSize: number | null;
  coaches: Holder[];
  captains: Holder[];
  /** Read-only here: these links give coach rights on every team. */
  sectionCaptains: Holder[];
}

export interface NewOffice {
  office: ClubOffice;
  personId: string;
  /** The current holder's office row, for a handover. */
  replaces?: string;
}

export interface NewPerson {
  preferredName?: string | null;
  givenNames?: string | null;
  surname: string;
  email: string;
}

export interface TeamChange {
  coachIds?: string[];
  captainIds?: string[];
  targetSquadSize?: number;
}

export function listOffices(): Promise<{ offices: OfficeView[] }> {
  return apiGet('/api/admin/offices');
}

export function addOffice(o: NewOffice): Promise<{ ok: true; id: string }> {
  return apiPost('/api/admin/offices', o);
}

export function setOfficeStatus(id: string, status: 'Active' | 'Retired'): Promise<{ ok: true; id: string }> {
  return apiPost(`/api/admin/offices/${encodeURIComponent(id)}`, { status });
}

/** Someone who isn't in People yet (not made Active). */
export function createPerson(p: NewPerson): Promise<{ ok: true; id: string }> {
  return apiPost('/api/admin/people', p);
}

export function listTeams(): Promise<{ teams: TeamAdminView[] }> {
  return apiGet('/api/admin/teams');
}

export function saveTeam(id: string, change: TeamChange): Promise<{ ok: true; changed: string[] }> {
  return apiPost(`/api/admin/teams/${encodeURIComponent(id)}`, change);
}
