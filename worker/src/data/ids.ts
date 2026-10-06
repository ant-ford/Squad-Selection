/**
 * Row ids as the app sees them.
 *
 * A row's id is its api_id: the Airtable record id ("rec" + 14 characters)
 * for a row imported from Airtable, the row's uuid for one created in Eddy
 * (new joiners, their commitment periods, ...). Imported ids live on in
 * calendar feeds, /join?ref= links, /review/:id and bookmarked matches, so
 * a check that accepts only one shape quietly drops or refuses people.
 */

/** A Supabase api_id: an imported row's Airtable id, or a row's uuid. */
export const API_ID_RE = /^(rec[A-Za-z0-9]{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Whether `id` is a well-formed row id. */
export function isRowId(id: unknown): id is string {
  return typeof id === "string" && API_ID_RE.test(id);
}
