/**
 * Row ids as the app sees them.
 *
 * On Airtable every id is a record id ("rec" + 14 characters). On Supabase a
 * row's id is its api_id: the Airtable id for a row imported from Airtable,
 * the row's uuid for one created in Eddy (new joiners, their commitment
 * periods, ...). A check that accepts only "rec..." ids quietly drops or
 * refuses everyone who joined after the switch-over.
 */
import { backendFor, type BackendEnv, type DataModule } from "./backend";

/** An Airtable record id. Safe to put in a filter formula. */
export const AIRTABLE_ID_RE = /^rec[A-Za-z0-9]{14}$/;

/** A Supabase api_id: an imported row's Airtable id, or a row's uuid. */
export const API_ID_RE = /^(rec[A-Za-z0-9]{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Whether `id` is a well-formed id for `module` on its configured backend. */
export function isRowId(env: BackendEnv, module: DataModule, id: unknown): id is string {
  if (typeof id !== "string") return false;
  return (backendFor(env, module) === "supabase" ? API_ID_RE : AIRTABLE_ID_RE).test(id);
}
