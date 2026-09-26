/**
 * Parsing the free-text Matches "Ump 1" / "Ump 2" fields, copied from HKHA
 * match cards. Formats seen across ten seasons:
 *
 *   Appointed | Appt                     an appointed umpire, name unknown
 *   Appt - Name                          an appointed umpire
 *   Team | Team - Name                   a duty umpire from that team
 *   Name | Name - 4477                   a name, sometimes with an umpire number
 *
 * and the traps: non-breaking spaces turned into "Â", HKHA admin notes glued
 * straight onto the name ("Alex WongRate by Home Team: 4"), quoted
 * multi-line values, and names written in a different case or order.
 *
 * parseUmpire() reads one value. The dictionary of clean names it uses to
 * split off glued notes comes from buildNameDictionary() over every value.
 */

export type UmpireKind = "appointed" | "duty" | "name" | "none";

export interface ParsedUmpire {
  kind: UmpireKind;
  /** The team providing the umpire, for a duty umpire. */
  duty?: string;
  /** As written (tidied), when there is one. */
  name?: string;
  /** Grouping key: the same person however their name is written. */
  key?: string;
  /** HKHA umpire number, when given. */
  number?: string;
  /** Anything glued on after the name: an HKHA admin note. */
  note?: string;
}

/**
 * Names that are one person but no key rule can tell. Keys on the left are
 * canonicalKey() of the variant; the value is the name to show. Add to this
 * when the Umpires tab shows the same person twice, and bump
 * SUMMARY_VERSION (shared/clubStats.ts) so stored past seasons rebuild.
 */
export const UMPIRE_ALIASES: Record<string, string> = {
  // Confirmed one person by the owner, 2026-09-26: the "(OLD NAME)" spelling
  // is his former name, so he is shown as he is written now.
  gurcharan: "Gurcharan",
  "bir gurcharan singh": "Gurcharan",
};

const APPOINTED = /^(appointed|appt\.?)$/i;

/** "ChangÂ Fu Shing" -> "Chang Fu Shing"; non-breaking and repeated spaces collapsed. */
export function tidy(raw: string): string {
  return raw
    .replace(/Â |Â(?=\s|$)|Â/g, " ")
    .replace(/[ \s]+/g, " ")
    .trim();
}

/**
 * The same person however the name is written: case, word order, a
 * nickname in brackets kept as a word, "(OLD NAME)" and commas dropped.
 * "SINGH Kuldeep" and "Kuldeep Singh" share a key.
 */
export function canonicalKey(name: string): string {
  const words = tidy(name)
    .replace(/\(old name\)/gi, " ")
    .replace(/[(),.]/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .sort();
  return words.join(" ");
}

const looksLikeNumber = (s: string) => /^#?\d{3,5}$/.test(s.trim());

/** A team name as HKHA writes them: "HKFC F", "Kai Tak B", "144U A". */
const TEAM_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.&']*(?: [A-Za-z0-9.&']+)* [A-H]$/;

export interface ParseContext {
  /** Every team name in the Matches table (home and away), exactly as written. */
  teams: ReadonlySet<string>;
  /** Clean names seen elsewhere, for splitting glued notes (buildNameDictionary). */
  names?: readonly string[];
}

function isTeam(s: string, ctx: ParseContext): boolean {
  return ctx.teams.has(s) || TEAM_SHAPE.test(s);
}

/**
 * Split "Alex WongRate by Home Team: 4" into name and note. The dictionary
 * wins (the longest clean name the value starts with); failing that, a
 * lower-to-upper case join followed by a sentence is taken as the seam.
 * A short tail ("McDonald") is never split.
 */
function splitGlued(value: string, names: readonly string[]): { name: string; note?: string } {
  const known = names
    .filter((n) => value.length > n.length && value.startsWith(n))
    .sort((a, b) => b.length - a.length)[0];
  if (known) return { name: known, note: value.slice(known.length).trim() || undefined };
  const seam = /[a-z)]([A-Z#])/.exec(value);
  if (seam) {
    const at = seam.index + 1;
    const tail = value.slice(at);
    if (tail.length >= 12 && tail.includes(" ")) return { name: value.slice(0, at).trim(), note: tail.trim() };
  }
  return { name: value };
}

function withName(result: Omit<ParsedUmpire, "key" | "name">, rawName: string, ctx: ParseContext): ParsedUmpire {
  let name = rawName.trim();
  let number: string | undefined;
  // "Alex Wong - 4477": the number goes, the name stays.
  const numbered = /^(.*?)\s+-\s+#?(\d{3,5})$/.exec(name);
  if (numbered) {
    name = numbered[1];
    number = numbered[2];
  }
  const { name: clean, note } = splitGlued(name, ctx.names ?? []);
  if (!clean) return { ...result, number, note };
  const key = canonicalKey(clean);
  const alias = UMPIRE_ALIASES[key];
  return {
    ...result,
    name: alias ?? clean,
    key: alias ? canonicalKey(alias) : key,
    number,
    // The glued note comes first: later lines of a multi-line value follow it.
    note: [note, result.note].filter(Boolean).join(" ") || undefined,
  };
}

export function parseUmpire(raw: unknown, ctx: ParseContext): ParsedUmpire {
  if (typeof raw !== "string") return { kind: "none" };
  // A quoted multi-line value: the first line is the umpire, the rest a note.
  const [firstLine, ...rest] = raw.replace(/^"+|"+$/g, "").split(/\r?\n/);
  const extra = tidy(rest.join(" ")) || undefined;
  const value = tidy(firstLine);
  if (!value) return { kind: "none" };

  if (APPOINTED.test(value)) return { kind: "appointed", note: extra };

  const dash = value.indexOf(" - ");
  if (dash > 0) {
    const left = value.slice(0, dash).trim();
    const right = value.slice(dash + 3).trim();
    if (APPOINTED.test(left)) return withName({ kind: "appointed", note: extra }, right, ctx);
    if (looksLikeNumber(right)) return withName({ kind: "name", note: extra }, value, ctx);
    // Otherwise the left side is who provided the umpire, even when it is not
    // shaped like a team ("Hockey Clube de Macau", "JR"): no value in ten
    // seasons puts one name before another.
    return withName({ kind: "duty", duty: left, note: extra }, right, ctx);
  }

  if (isTeam(value, ctx)) return { kind: "duty", duty: value, note: extra };
  // "HKFC BHKFC B umpire no show": a duty team with a note glued on.
  const gluedTeam = [...ctx.teams]
    .filter((t) => value.startsWith(t) && value.length > t.length && /[A-Z]/.test(value[t.length]))
    .sort((a, b) => b.length - a.length)[0];
  if (gluedTeam) {
    return { kind: "duty", duty: gluedTeam, note: [value.slice(gluedTeam.length).trim(), extra].filter(Boolean).join(" ") };
  }
  return withName({ kind: "name", note: extra }, value, ctx);
}

/**
 * Clean names from a set of raw values: those whose name part has no glued
 * note (no lower-to-upper case join), used to split the glued ones.
 */
export function buildNameDictionary(values: Iterable<unknown>, teams: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  for (const v of values) {
    const parsed = parseUmpire(v, { teams });
    if (parsed.name && !parsed.note && !/[a-z)][A-Z]/.test(parsed.name) && parsed.name.length >= 4) names.add(parsed.name);
  }
  return [...names];
}
