/**
 * How the app shows a person's name. Takes a database row (`preferred_name`,
 * `given_names`, `surname`) or an API object (`preferredName`, `givenNames`,
 * `surname`).
 *
 * - `firstName`: the preferred name, else the given names; "" when neither is set.
 * - `fullName`: `firstName` and the surname, joined by one space, leaving out an
 *   empty part; "" when both are empty.
 *
 * An empty string counts as not set. Nothing is trimmed, so a name of spaces is
 * kept as it is. Callers add their own fallback (`fullName(p) || "Player"`).
 *
 * Not for Registered Names, the legal "given names + surname" on forms and PDFs,
 * or the keys used to match names: those have their own rules.
 */
export type PersonName = {
  preferred_name?: string | null;
  given_names?: string | null;
  preferredName?: string | null;
  givenNames?: string | null;
  surname?: string | null;
};

/** The preferred name, else the given names; "" when neither is set. */
export function firstName(p: PersonName | null | undefined): string {
  if (!p) return "";
  return p.preferred_name || p.preferredName || p.given_names || p.givenNames || "";
}

/** First name and surname, joined by one space, leaving out an empty part; "" when both are empty. */
export function fullName(p: PersonName | null | undefined): string {
  return [firstName(p), p?.surname].filter(Boolean).join(" ");
}
