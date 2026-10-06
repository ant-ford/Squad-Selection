/**
 * Generic rows for the CRM-style reads (membership, statements, the
 * chairman's directory, contacts, My Tasks): a record keyed by the columns
 * of a CRM view (api_people_crm, api_commitments_crm).
 *
 * A field list (["applicantStage", "surname", ...] as const) is both what a
 * read selects and the shape module code reads.
 */

export type FieldList = readonly string[];

/** A row keyed by a field list's names. Values keep the views' shapes (arrays for links, attachment objects). */
export type Row<L extends FieldList> = { id: string } & { [K in L[number]]?: unknown };
