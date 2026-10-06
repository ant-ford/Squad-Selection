/**
 * Pure helpers for the Data checks screen (src/pages/DataChecks.tsx): which
 * tabs show and their counts, labels, the re-registration choices and plain
 * words for refusals.
 */
import { isApiError } from '@/lib/peopleAdmin';
import type { DataChecks, DuplicateMatch, MissingField, NeedsFixingKind, ReRegistration } from '@/api/dataChecks';

export type CheckTab = 'cards' | 'names' | 'reregistrations' | 'incomplete' | 'duplicates' | 'fixing';

const TAB_LABELS: Record<CheckTab, string> = {
  cards: 'Unlinked cards',
  names: 'Shared names',
  reregistrations: 'Re-registrations',
  incomplete: 'Incomplete',
  duplicates: 'Duplicates',
  fixing: 'Needs fixing',
};

export function tabCounts(d: DataChecks): Record<CheckTab, number> {
  return {
    cards: d.unlinkedCards.length,
    names: d.sharedRegisteredNames.length,
    reregistrations: d.reRegistrations.length,
    incomplete: d.incomplete.length,
    duplicates: d.duplicates.length,
    fixing: d.needsFixing.length,
  };
}

/** Tabs with something in them, in order, labelled with their counts. */
export function visibleTabs(d: DataChecks): { value: CheckTab; label: string }[] {
  const counts = tabCounts(d);
  return (Object.keys(TAB_LABELS) as CheckTab[])
    .filter((t) => counts[t] > 0)
    .map((t) => ({ value: t, label: `${TAB_LABELS[t]} (${counts[t]})` }));
}

export const MISSING_LABELS: Record<MissingField, string> = {
  team: 'No team',
  position: 'No position',
  ability: 'No ability',
};

export const DUPLICATE_LABELS: Record<DuplicateMatch, string> = {
  name: 'Same name',
  dob: 'Same date of birth',
  mobile: 'Same mobile',
  email: 'Same email',
};

export const FIXING_LABELS: Record<NeedsFixingKind, string> = {
  stage: 'Stage',
  review: 'Commitment review',
  legacySuspension: 'Old suspension flag',
};

/** The value a Needs fixing row shows: what's set, or "Blank". */
export const fixingValue = (v: string) => (v.trim() === '' ? 'Blank' : v);

/**
 * The teams a re-registration may move up to: the suggested one first, then
 * the other teams the play-ups were for. Never the team they're on now.
 */
export function moveTargets(r: Pick<ReRegistration, 'previousTeam' | 'suggestedTeam' | 'playUps'>): string[] {
  const out: string[] = [];
  const add = (t: string | null | undefined) => {
    const v = (t ?? '').trim();
    if (v && v !== r.previousTeam && !out.includes(v)) out.push(v);
  };
  add(r.suggestedTeam);
  for (const p of r.playUps) add(p.team);
  return out;
}

const MESSAGES: Record<string, string> = {
  ALREADY_LINKED: 'This card is already linked. Reload to see who to.',
  NAME_TAKEN: "Someone else already has this registered name. Link without saving the name, or fix the other player's name first.",
  ALREADY_RESOLVED: 'This re-registration has already been dealt with.',
  OLD_SEASON: 'This is from an earlier season: the player can only stay on their team.',
  TEAM_CHANGED: 'Their registered team has changed since. Reload and check again.',
  NOT_A_MOVE_UP: 'Choose a team above their registered team.',
  NOT_FOUND: 'Not found. Reload and try again.',
};
const FAILED = 'Not saved: the connection or the server failed. Try again.';

/** Plain words for a refused link or resolve. */
export function checkRefusal(err: unknown): string {
  if (!isApiError(err)) return FAILED;
  if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
  if (err.status === 403) return "You can't change this.";
  if (err.status >= 500) return FAILED;
  return err.message || FAILED;
}

/** Card links after a save: "Linked" or "Linked · 3 cards". */
export function linkedNote(n: number): string {
  return n > 1 ? `Linked · ${n} cards` : 'Linked';
}
