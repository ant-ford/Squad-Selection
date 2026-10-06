import type { SelectionChange, SelectionChangeResult } from "../../worker/src/data/matches";
import type { FakeTables } from "./airtable";

/**
 * apply_squad_changes against the fake Airtable tables, for tests that run
 * the Worker on the Airtable fake (where the real repository method is
 * Supabase-only). Adds and removes are applied to the squad as it is now;
 * no versions are kept, so it never reports a conflict.
 */
export function applyToFakeTables(tables: FakeTables, matchId: string, change: SelectionChange): SelectionChangeResult {
  const record = tables.Matches.find((r) => r.id === matchId);
  if (!record) throw new Error(`No match ${matchId}`);
  const field = change.side === "home" ? "Selected Players Home" : "Selected Players Away";
  const before = (record.fields[field] as string[] | undefined) ?? [];
  const removed = before.filter((id) => change.remove.includes(id));
  const added = change.add.filter((id) => !before.includes(id));
  const selected = [...before.filter((id) => !removed.includes(id)), ...added];
  record.fields[field] = selected;
  if (added.length === 0 && removed.length === 0) return { status: "unchanged", version: 0, selected };
  return { status: "ok", version: 1, otherVersion: null, added, removed, selected };
}
