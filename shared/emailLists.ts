/**
 * The chairman's email lists: the groups a list is built from, how a person
 * matches them, and how the addresses come out.
 *
 * One definition for the Worker (which computes each person's values) and
 * the app (which does the matching, instantly, as filters change).
 *
 * Matching: within one group, any ticked option matches (OR); across groups,
 * every group with something ticked must match (AND). "Any" in a group
 * matches anyone with at least one real value there.
 */

export const ANY = "__any";

export interface GroupDef {
  key: string;
  label: string;
  /** Values that mean "none" and are never offered or matched. */
  ignore?: readonly string[];
  /** Display order; values not listed follow alphabetically. */
  order?: readonly string[];
  /** Offer the "Any" option (for multi-choice interest and role fields). */
  any?: boolean;
  /** Shown first, open by default. */
  primary?: boolean;
}

const NOT_INTERESTED = ["Not Interested"];

export const GROUPS: readonly GroupDef[] = [
  { key: "status", label: "Status", order: ["Member", "Applicant"], primary: true },
  { key: "active", label: "Playing", order: ["Active player", "Not an active player"], primary: true },
  { key: "team", label: "Team", primary: true },
  { key: "memberType", label: "Member type", order: ["Main", "Spouse", "Partner", "Child"], primary: true },
  { key: "category", label: "Category", primary: true },
  { key: "playerCoach", label: "Player / coach", primary: true },
  {
    key: "ageBand",
    label: "Age band",
    order: ["15 or under", "16-20", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51-55", "56-60", "61-65", "65+"],
  },
  { key: "hockeyCommittee", label: "Hockey Committee", ignore: NOT_INTERESTED, any: true },
  { key: "subCommittee", label: "Men's Sub-Committee", ignore: NOT_INTERESTED, any: true },
  { key: "teamRoles", label: "Team roles", ignore: NOT_INTERESTED, any: true },
  { key: "touringCommittee", label: "Touring Committee", ignore: NOT_INTERESTED, any: true },
  { key: "juniorVolunteers", label: "Junior hockey volunteers", ignore: NOT_INTERESTED, any: true },
  { key: "easter5s", label: "Easter 5s Committee", ignore: NOT_INTERESTED, any: true },
  { key: "generalVolunteers", label: "General volunteers", ignore: NOT_INTERESTED, any: true },
  { key: "tourInterest", label: "Tour interest", ignore: NOT_INTERESTED, any: true },
  { key: "tournamentInterest", label: "Tournament interest", ignore: NOT_INTERESTED, any: true },
  { key: "qualifiedUmpire", label: "Qualified umpire", ignore: ["Not Applicable"], any: true },
  { key: "qualifiedCoach", label: "Qualified coach", ignore: ["Not Applicable"], any: true },
  { key: "captaincyInterest", label: "Captaincy interest", order: ["Yes", "Maybe", "No"] },
];

export type GroupKey = string;

/**
 * Where a person's addresses came from (owner decision, 2026-09-25): always
 * their own Email, and for an under-18 their guardian's as well.
 *   own                - adult, or an under-18 with no guardian address
 *   own-and-guardian   - under-18: both
 *   guardian           - under-18 with no address of their own
 *   none               - nothing to write to
 */
export type EmailSource = "own" | "own-and-guardian" | "guardian" | "none";

export interface DirectoryPerson {
  id: string;
  name: string;
  surname: string;
  membershipNo?: string;
  /** Group key -> this person's values in it (ignored values removed). */
  values: Record<GroupKey, string[]>;
  emails: string[];
  emailSource: EmailSource;
  /** People.Age below 18: the guardian is copied in. */
  under18: boolean;
}

/** Ticked options per group. An absent or empty group does not filter. */
export type Selection = Record<GroupKey, string[]>;

export function matches(person: DirectoryPerson, selection: Selection): boolean {
  for (const [key, picked] of Object.entries(selection)) {
    if (!picked || picked.length === 0) continue;
    const have = person.values[key] ?? [];
    const ok = picked.some((p) => (p === ANY ? have.length > 0 : have.includes(p)));
    if (!ok) return false;
  }
  return true;
}

/**
 * The people on the list: those matching the groups, plus anyone added by
 * hand, less anyone taken off by hand. Sorted by surname.
 */
export function buildList(
  people: DirectoryPerson[],
  selection: Selection,
  added: string[] = [],
  removed: string[] = [],
): DirectoryPerson[] {
  const add = new Set(added);
  const drop = new Set(removed);
  return people
    .filter((p) => !drop.has(p.id) && (add.has(p.id) || matches(p, selection)))
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.name.localeCompare(b.name));
}

/** Every address once, in list order, compared case-insensitively. */
export function uniqueAddresses(people: DirectoryPerson[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of people) {
    for (const e of p.emails) {
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Outlook separates recipients with semicolons; Gmail and most others take commas. */
export function bccText(addresses: string[], style: "outlook" | "gmail"): string {
  return addresses.join(style === "outlook" ? "; " : ", ");
}

/**
 * A mailto: link with everyone in Bcc, or null when it would be too long to
 * open reliably - some mail apps cut links off at about 2,000 characters.
 */
export function mailtoBcc(addresses: string[], limit = 1900): string | null {
  if (addresses.length === 0) return null;
  const href = `mailto:?bcc=${addresses.map(encodeURIComponent).join(",")}`;
  return href.length <= limit ? href : null;
}

/** Options to offer in each group: the values present, in display order. */
export function groupOptions(people: DirectoryPerson[]): Record<GroupKey, string[]> {
  const out: Record<GroupKey, string[]> = {};
  for (const g of GROUPS) {
    const present = new Set<string>();
    for (const p of people) for (const v of p.values[g.key] ?? []) present.add(v);
    const order = g.order ?? [];
    out[g.key] = [...present].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      return a.localeCompare(b);
    });
  }
  return out;
}

/** One line describing the list, for the export log and the page. */
export function describeSelection(selection: Selection): string {
  const parts = GROUPS.flatMap((g) => {
    const picked = selection[g.key];
    if (!picked?.length) return [];
    return [`${g.label}: ${picked.map((p) => (p === ANY ? "any" : p)).join(" or ")}`];
  });
  return parts.length ? parts.join("; ") : "Everyone";
}

// ── The page address ──────────────────────────────────────────────────

/**
 * Selection, additions and removals as URL search params, so a list can be
 * bookmarked, shared and reopened - the saved lists. Values are joined with
 * "|", which no option in the base contains.
 */
export function toParams(selection: Selection, added: string[], removed: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const g of GROUPS) {
    const picked = selection[g.key];
    if (picked?.length) params.set(g.key, picked.join("|"));
  }
  if (added.length) params.set("add", added.join("|"));
  if (removed.length) params.set("drop", removed.join("|"));
  return params;
}

export function fromParams(params: URLSearchParams): { selection: Selection; added: string[]; removed: string[] } {
  const split = (v: string | null) => (v ? v.split("|").filter(Boolean) : []);
  const selection: Selection = {};
  for (const g of GROUPS) {
    const picked = split(params.get(g.key));
    if (picked.length) selection[g.key] = picked;
  }
  return { selection, added: split(params.get("add")), removed: split(params.get("drop")) };
}
