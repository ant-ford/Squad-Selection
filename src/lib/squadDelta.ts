/**
 * A squad save as changes (B6): only the players this coach added and
 * removed go to POST /api/squad/changes, with the squad version the page
 * loaded. The server applies them to the squad as it is now, so another
 * coach's changes to other players survive, and refuses (409) only when
 * someone else changed one of the same players since that version.
 *
 * The page keeps one pending action per player. These helpers turn those
 * into the request and keep them honest against a fresh squad.
 */

export type SquadDeltaAction = 'select' | 'remove';

export interface SquadDelta {
  playerId: string;
  action: SquadDeltaAction;
}

export interface SquadChanges {
  add: string[];
  remove: string[];
}

/**
 * The adds and removes to send. A pending action that the squad already
 * reflects (selecting someone already in it, removing someone not in it)
 * is left out: it changes nothing, and sending it could only clash with
 * someone else's save. When a player has more than one pending action, the
 * last one wins.
 */
export function squadChanges(deltas: readonly SquadDelta[], selected: Iterable<string>): SquadChanges {
  const inSquad = new Set(selected);
  const last = new Map<string, SquadDeltaAction>();
  for (const d of deltas) {
    last.delete(d.playerId); // keep the order of each player's last action
    last.set(d.playerId, d.action);
  }
  const add: string[] = [];
  const remove: string[] = [];
  for (const [id, action] of last) {
    if (action === 'select' && !inSquad.has(id)) add.push(id);
    else if (action === 'remove' && inSquad.has(id)) remove.push(id);
  }
  return { add, remove };
}

/**
 * Pending actions still worth keeping against this squad. After a conflict
 * the page reloads the squad and keeps the coach's changes so they re-merge
 * on top; any that the fresh squad already reflects (someone else made the
 * same change) are dropped, so the Save count only counts real changes.
 * Returns the same array when nothing was dropped, so React state is left
 * alone.
 */
export function pruneDeltas(deltas: SquadDelta[], selected: Iterable<string>): SquadDelta[] {
  const inSquad = new Set(selected);
  const kept = deltas.filter((d) => (d.action === 'select' ? !inSquad.has(d.playerId) : inSquad.has(d.playerId)));
  return kept.length === deltas.length ? deltas : kept;
}
