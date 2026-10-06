/**
 * Pure helpers for Offices and teams (src/pages/Club.tsx): office names and
 * order, grouping, the one-holder rule, plain words for refusals, and the
 * team save.
 */
import { isApiError } from '@/lib/peopleAdmin';
import type { ClubOffice, Holder, NewPerson, OfficeView, TeamAdminView, TeamChange } from '@/api/club';

/** The glossary's names, in the order the screen lists them. */
export const OFFICE_LABELS: Record<ClubOffice, string> = {
  sectionCaptain: 'Section Captain',
  sectionChair: 'Chairman',
  membershipOfficer: 'Membership Officer',
  hockeyConvenor: "Men's Convenor",
  kitConvenor: 'Kit Convenor',
  assistantDirector: 'Assistant Director of Hockey',
  umpireCoordinator: 'Umpire Coordinator',
  sponsor: 'Sponsor',
};
export const OFFICE_ORDER = Object.keys(OFFICE_LABELS) as ClubOffice[];

/** One holder at a time: adding one hands the office over. */
export const ONE_HOLDER_OFFICES: readonly ClubOffice[] = ['membershipOfficer', 'sectionChair'];
export const isOneHolder = (o: ClubOffice) => ONE_HOLDER_OFFICES.includes(o);

export interface OfficeGroup {
  office: ClubOffice;
  label: string;
  active: OfficeView[];
  retired: OfficeView[];
}

/** Every office, in order, even one nobody holds; holders by name. */
export function groupOffices(offices: readonly OfficeView[]): OfficeGroup[] {
  const byName = (a: OfficeView, b: OfficeView) => (a.holder?.name ?? '').localeCompare(b.holder?.name ?? '');
  return OFFICE_ORDER.map((office) => {
    const rows = offices.filter((o) => o.office === office);
    return {
      office,
      label: OFFICE_LABELS[office],
      active: rows.filter((o) => o.status === 'Active').sort(byName),
      retired: rows.filter((o) => o.status === 'Retired').sort(byName),
    };
  });
}

/** The holder an add must hand over from, for a one-holder office; null when none. */
export function handoverFrom(group: Pick<OfficeGroup, 'office' | 'active'>): OfficeView | null {
  return isOneHolder(group.office) ? group.active[0] ?? null : null;
}

/** Whether reactivating a retired row is offered: not while a one-holder office is held. */
export const canReactivate = (group: Pick<OfficeGroup, 'office' | 'active'>) => !(isOneHolder(group.office) && group.active.length > 0);

const MESSAGES: Record<string, string> = {
  ONE_HOLDER: 'This office has one holder at a time.',
  ALREADY_HOLDS: 'They already hold this office.',
  LAST_SECTION_CAPTAIN: 'There must always be a Section Captain. Add the new one first.',
  EMAIL_TAKEN: 'Someone already has this email. Find them by name instead.',
  TAKEN: 'Someone is listed twice.',
  NOT_FOUND: 'Not found. Reload and try again.',
};
const FAILED = 'Not saved: the connection or the server failed. Try again.';

/** Plain words for a refused office, person or team save; `code` lets the screen offer a next step. */
export function clubRefusal(err: unknown): { code: string | null; message: string } {
  if (!isApiError(err)) return { code: null, message: FAILED };
  const code = err.code ?? null;
  if (code && MESSAGES[code]) return { code, message: MESSAGES[code] };
  if (err.status === 409) return { code, message: 'Someone else changed this while you had it open. Reload and try again.' };
  if (err.status === 403) return { code, message: "You can't change this." };
  if (err.status >= 500) return { code, message: FAILED };
  return { code, message: err.message || FAILED };
}

const EMAIL = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;]+$/;

/** What a new person still needs; null when ready. */
export function newPersonProblem(p: NewPerson): string | null {
  if (!p.surname.trim()) return 'Enter their surname.';
  if (!EMAIL.test(p.email.trim())) return 'Enter their email address.';
  return null;
}

export interface TeamDraft {
  coaches: Holder[];
  captains: Holder[];
  targetSquadSize: string;
}

export function teamDraft(t: TeamAdminView): TeamDraft {
  return { coaches: t.coaches, captains: t.captains, targetSquadSize: t.targetSquadSize == null ? '' : String(t.targetSquadSize) };
}

/** A whole number from 1 to 40, or null. */
export function squadSize(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= 40 ? n : null;
}

const ids = (list: Holder[]) => list.map((h) => h.id);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Only what changed; null when nothing did (or the size isn't valid). */
export function teamChange(t: TeamAdminView, d: TeamDraft): TeamChange | null {
  const c: TeamChange = {};
  if (!same(ids(t.coaches), ids(d.coaches))) c.coachIds = ids(d.coaches);
  if (!same(ids(t.captains), ids(d.captains))) c.captainIds = ids(d.captains);
  const size = squadSize(d.targetSquadSize);
  if (d.targetSquadSize.trim() !== '' && size === null) return null;
  if (size !== null && size !== t.targetSquadSize) c.targetSquadSize = size;
  return Object.keys(c).length > 0 ? c : null;
}

/** Adds a person to a list once. */
export const withHolder = (list: Holder[], h: Holder) => (list.some((x) => x.id === h.id) ? list : [...list, h]);

/** One line for a closed team row: "Coach: A, B · Captain: C · Squad 16". */
export function teamSummary(t: Pick<TeamAdminView, 'coaches' | 'captains' | 'targetSquadSize'>): string {
  const names = (l: Holder[]) => l.map((h) => h.name).join(', ');
  return [
    t.coaches.length ? `${t.coaches.length === 1 ? 'Coach' : 'Coaches'}: ${names(t.coaches)}` : 'No coach',
    t.captains.length ? `${t.captains.length === 1 ? 'Captain' : 'Captains'}: ${names(t.captains)}` : 'No captain',
    t.targetSquadSize ? `Squad ${t.targetSquadSize}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
