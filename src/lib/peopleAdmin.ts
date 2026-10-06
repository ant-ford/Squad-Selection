/**
 * Pure helpers for the People screens (src/pages/People.tsx,
 * src/pages/PersonAdmin.tsx): the membership form's diff, plain words for
 * the API's refusals, the stage choices and the list chips.
 */
import { PROFILE_SECTIONS } from '@shared/profile';
import { PARKED_STAGES } from '@shared/membershipStages';
import type { StatusTone } from '@/lib/statusTone';
import type { MembershipKey, MembershipSave, PersonMembership } from '@/api/adminPeople';

/** Options for a profile select, from the same list the application form uses. */
function profileOptions(column: string): readonly string[] {
  for (const s of PROFILE_SECTIONS) {
    const f = s.fields.find((x) => x.column === column);
    if (f?.options) return f.options;
  }
  return [];
}

export interface MembershipFieldSpec {
  key: MembershipKey;
  label: string;
  type: 'select' | 'text' | 'date';
  options?: readonly string[];
}

export const MEMBERSHIP_FIELDS: MembershipFieldSpec[] = [
  { key: 'memberType', label: 'Member type', type: 'select', options: profileOptions('member_type') },
  { key: 'categoryType', label: 'Category', type: 'select', options: profileOptions('category_type') },
  { key: 'membershipNo', label: 'Membership number', type: 'text' },
  { key: 'joinDate', label: 'Join date', type: 'date' },
  { key: 'commitmentEndDate', label: 'Commitment end', type: 'date' },
];

export type MembershipDraft = Record<MembershipKey, string>;

export function membershipDraft(m: PersonMembership): MembershipDraft {
  return {
    memberType: m.memberType ?? '',
    categoryType: m.categoryType ?? '',
    membershipNo: m.membershipNo ?? '',
    joinDate: m.joinDate ?? '',
    commitmentEndDate: m.commitmentEndDate ?? '',
  };
}

const norm = (v: string | null | undefined) => (v ?? '').trim() || null;

/**
 * The save for what changed: only the edited fields, each with the value the
 * screen read as `expect`. null when nothing changed.
 */
export function membershipChange(saved: PersonMembership, draft: MembershipDraft): MembershipSave | null {
  const body: MembershipSave = { expect: {} };
  let any = false;
  for (const { key } of MEMBERSHIP_FIELDS) {
    const was = norm(saved[key]);
    const now = norm(draft[key]);
    if (was === now) continue;
    body[key] = now;
    body.expect[key] = saved[key] ?? null;
    any = true;
  }
  return any ? body : null;
}

/** A problem the form can see before saving; null when none. */
export function membershipProblem(draft: MembershipDraft): string | null {
  const join = norm(draft.joinDate);
  const end = norm(draft.commitmentEndDate);
  if (join && end && end <= join) return 'Commitment end must be after the join date.';
  return null;
}

export type SaveRefusal =
  | { kind: 'changed'; message: string }
  | { kind: 'shared'; message: string }
  | { kind: 'other'; message: string };

/** An ApiError (src/lib/apiClient.ts), checked by shape so this file stays free of the client. */
export function isApiError(err: unknown): err is { status: number; code?: string; message: string } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === 'number';
}

const CHANGED = 'Someone else changed this while you had it open. Reload to see their change.';
const STAGE_CHANGED = 'The stage changed while you had this open. Reload to see it.';
const FAILED = 'Not saved: the connection or the server failed. Try again.';

/** Plain words for a refused save. A shared membership number asks to be acknowledged. */
export function saveRefusal(err: unknown): SaveRefusal {
  if (!isApiError(err)) return { kind: 'other', message: FAILED };
  if (err.code === 'SHARED_MEMBERSHIP_NO') return { kind: 'shared', message: err.message };
  if (err.code === 'STAGE_CHANGED') return { kind: 'changed', message: STAGE_CHANGED };
  if (err.status === 409) return { kind: 'changed', message: CHANGED };
  if (err.status === 403) return { kind: 'other', message: "You can't change this." };
  if (err.status === 404) return { kind: 'other', message: 'This person is no longer on record.' };
  if (err.status >= 500) return { kind: 'other', message: FAILED };
  return { kind: 'other', message: err.message || FAILED };
}

/** The brief note after a save that removed commitment periods the new dates leave out. */
export function removedPeriodsNote(n: number): string | null {
  if (!n || n < 1) return null;
  return `${n} commitment period${n === 1 ? '' : 's'} removed`;
}

export interface StageGroup {
  label: string;
  options: string[];
}

/** The offered stage moves, in two groups: the pipeline, and off it (Rejected, Temporary). */
export function stageGroups(targets: readonly string[]): StageGroup[] {
  const parked = PARKED_STAGES as readonly string[];
  const groups: StageGroup[] = [
    { label: 'Stages', options: targets.filter((t) => !parked.includes(t)) },
    { label: 'Off the pipeline', options: targets.filter((t) => parked.includes(t)) },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/** Moves that need a second tap. */
export const stageMoveNeedsConfirm = (target: string) => target === 'Rejected';

/** The chip on a search row or the page heading. */
export function personChip(p: { status: string | null; stage: string | null; active: boolean }): { label: string; tone: StatusTone } | null {
  if (p.status === 'Applicant') return { label: p.stage ? `Applicant · ${p.stage.replace(/^(\d)\..*$/, 'stage $1')}` : 'Applicant', tone: 'info' };
  if (p.stage === 'Temporary') return { label: 'Temporary', tone: 'warning' };
  if (p.stage === 'Rejected') return { label: 'Rejected', tone: 'danger' };
  if (!p.active) return { label: 'Inactive', tone: 'neutral' };
  return null;
}

/** History newest first, whatever order the sources arrived in (unparseable times last). */
export function newestFirst<T extends { at: string }>(entries: readonly T[]): T[] {
  const time = (e: T) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...entries].sort((a, b) => time(b) - time(a));
}

/** One history row's detail: the fields changed, then who did it. */
export function historyDetail(e: { actor: string | null; fields: string[] }): string {
  return [e.fields.join(', '), e.actor ? `by ${e.actor}` : ''].filter(Boolean).join(' · ');
}

/** Search words the API accepts: letters, spaces, apostrophes, hyphens and dots; at least two characters. */
export function searchable(q: string): string | null {
  const t = q.trim().replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 60) return null;
  return /^[\p{L}\p{M} '’.-]+$/u.test(t) ? t : null;
}
