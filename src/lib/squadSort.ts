import { ABILITY_RANK } from '@shared/abilityRank';
import { POS_SHORT } from './format';

export interface SortablePlayer {
  id: string;
  preferredName: string;
  playingPosition: string;
  playingAbility: string;
  selectionStatus: string;
  eligibilityStatus: string;
  availabilityStatus: string;
}

/** Team-sheet order. Anything unrecognised sorts after FLEX. */
const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD', 'FLEX'];

export function positionRank(playingPosition: string): number {
  const index = POSITION_ORDER.indexOf(POS_SHORT[playingPosition] ?? playingPosition);
  return index === -1 ? POSITION_ORDER.length : index;
}

function byStrength(a: SortablePlayer, b: SortablePlayer): number {
  const abilityDiff = (ABILITY_RANK[b.playingAbility] ?? 0) - (ABILITY_RANK[a.playingAbility] ?? 0);
  if (abilityDiff !== 0) return abilityDiff;
  return a.preferredName.localeCompare(b.preferredName);
}

/** GK, DEF, MID, FWD, FLEX - then strongest first within each position. */
export function compareSelected(a: SortablePlayer, b: SortablePlayer): number {
  const posDiff = positionRank(a.playingPosition) - positionRank(b.playingPosition);
  return posDiff !== 0 ? posDiff : byStrength(a, b);
}

function isPickable(p: SortablePlayer): boolean {
  return p.eligibilityStatus !== 'blocked' && p.availabilityStatus !== 'Unavailable';
}

/**
 * The squad list as a coach reads it: the picked side first, laid out like a
 * team sheet, then everyone else in the recommendation engine's own order so
 * the next best pick is always the next row down.
 *
 * `recRankById` is the position of each player in the recommendations
 * response (0 = best fit). It only covers players who were unselected *on the
 * server*, so a player deselected since the last save has no rank; they keep
 * their place above the unavailable and blocked rather than dropping to the
 * bottom of the list the moment they are taken out of the squad.
 */
export function sortSquadList<T extends SortablePlayer>(
  players: T[],
  recRankById: Map<string, number>,
): T[] {
  return [...players].sort((a, b) => {
    const aSelected = a.selectionStatus === 'Selected';
    const bSelected = b.selectionStatus === 'Selected';
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    if (aSelected) return compareSelected(a, b);

    const aRank = recRankById.get(a.id);
    const bRank = recRankById.get(b.id);
    if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
    if (aRank !== undefined && bRank === undefined) return -1;
    if (aRank === undefined && bRank !== undefined) return 1;

    const pickableDiff = Number(isPickable(b)) - Number(isPickable(a));
    return pickableDiff !== 0 ? pickableDiff : byStrength(a, b);
  });
}
