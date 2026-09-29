/**
 * Generic rows for the CRM-style reads (membership, statements, the
 * chairman's directory, contacts, My Tasks): a record keyed by a field map's
 * KEYS rather than by Airtable field names.
 *
 * A field map ({ applicantStage: "Applicant Stage", ... }) is both the
 * Airtable projection (its values, in order, are the fields[] requested) and
 * the shape module code reads (its keys). On Supabase each map becomes a
 * Postgres view whose columns are those keys, so module code only ever uses
 * keys, never Airtable names.
 */

export type FieldMap = Record<string, string>;

/** A record keyed by a field map's KEYS (not Airtable field names). Values keep Airtable's shapes (arrays for links/lookups, attachment objects). */
export type Row<M extends FieldMap> = { id: string } & { [K in keyof M]?: unknown };

/**
 * One Airtable record as a Row. A field the record does not carry (Airtable
 * omits empty fields) is left out rather than set to undefined, so a cached
 * row stays small.
 */
export function toRow<M extends FieldMap>(record: any, map: M): Row<M> {
  const fields = record?.fields ?? {};
  const row: Record<string, unknown> = { id: record?.id };
  for (const [key, name] of Object.entries(map)) {
    if (fields[name] !== undefined) row[key] = fields[name];
  }
  return row as Row<M>;
}
