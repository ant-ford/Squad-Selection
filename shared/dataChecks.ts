/**
 * Data checks (worker/src/dataChecks.ts): the records an officer needs to
 * put right, built from a handful of whole-table reads in one pass each.
 * Opened by the Men's Convenor and the Section Captains (the "dataChecks"
 * section, auth.ts).
 *
 * Nothing here returns a personal value it compares: duplicates say which
 * field matched (name, date of birth, mobile, email), never the value.
 */
import { columnFor, NEEDS_FIXING } from "./membershipStages";
import { REVIEWS_FROM, reviewColumnFor, REVIEW_NEEDS_FIXING } from "./statementStages";
import { normalizeEmail } from "./normalizeEmail";
import { splitPhone } from "./phone";

// ── Input rows (column names as the Worker reads them) ──────────────────

export interface DcPersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  registered_name: string | null;
  status: string | null;
  applicant_stage: string | null;
  active: boolean | null;
  registered_team: string | null;
  playing_position: string | null;
  playing_ability: string | null;
  date_of_birth: string | null;
  mobile_no: string | null;
  email: string | null;
  is_suspended: boolean | null;
  matches_to_serve: number | null;
}

export interface DcCardRow {
  api_id: string;
  raw_player_name: string | null;
  team: string | null;
  match: { match_date: string | null; home_team: string | null; away_team: string | null } | null;
}

export interface DcEventRow {
  id: string;
  person_id: string;
  season: string;
  previous_team: string;
  new_team: string | null;
  detail: string | null;
  play_ups: { match_date?: string | null; team?: string | null }[] | null;
  created_at: string;
}

export interface DcCommitmentRow {
  api_id: string;
  person_id: string | null;
  review_progress: string | null;
  period_start: string | null;
  period_end: string | null;
}

export interface DataCheckInput {
  people: DcPersonRow[];
  /** This season's match cards with no linked person. */
  unlinkedCards: DcCardRow[];
  /** registration_events at needs_review. */
  events: DcEventRow[];
  /** Commitment years ending on or after REVIEWS_FROM. */
  commitments: DcCommitmentRow[];
  teamNames: string[];
  /** Hong Kong day key, YYYY-MM-DD. */
  today: string;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface DataCheckPerson {
  /** People api id. */
  id: string;
  name: string;
  team: string | null;
  active: boolean;
  status: string | null;
}

export interface UnlinkedCard {
  /** Match card api id. */
  id: string;
  /** The name as HKHA printed it on the card. */
  rawName: string;
  team: string | null;
  matchDate: string | null;
  opponent: string | null;
  /** Up to three people whose names look like it, closest first. */
  suggestions: DataCheckPerson[];
}

export interface SharedRegisteredName {
  registeredName: string;
  /** Two or more people: none of their cards link by name. */
  people: DataCheckPerson[];
}

export interface ReRegistration {
  /** registration_events id. */
  id: string;
  person: DataCheckPerson;
  season: string;
  previousTeam: string;
  /** The team the play-ups pointed to, when there was one. */
  suggestedTeam: string | null;
  detail: string | null;
  playUps: { matchDate: string | null; team: string | null }[];
  createdAt: string;
}

export type MissingField = "team" | "position" | "ability";

export interface IncompletePlayer {
  person: DataCheckPerson;
  missing: MissingField[];
}

export type DuplicateMatch = "name" | "dob" | "mobile" | "email";

export interface DuplicateGroup {
  match: DuplicateMatch;
  people: DataCheckPerson[];
}

export type NeedsFixingKind = "stage" | "review" | "legacySuspension";

export interface NeedsFixing {
  kind: NeedsFixingKind;
  person: DataCheckPerson | null;
  /** Commitment api id, for a review row. */
  commitmentId?: string;
  /** The stage or review value that isn't one of the list ("" when blank); the flag names for a suspension. */
  value: string;
}

export interface DataChecks {
  unlinkedCards: UnlinkedCard[];
  sharedRegisteredNames: SharedRegisteredName[];
  reRegistrations: ReRegistration[];
  incomplete: IncompletePlayer[];
  duplicates: DuplicateGroup[];
  needsFixing: NeedsFixing[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

const blank = (v: string | null | undefined) => !v || v.trim() === "";

export function displayName(p: Pick<DcPersonRow, "preferred_name" | "given_names" | "surname">): string {
  const first = (p.preferred_name || p.given_names || "").trim();
  return [first, (p.surname ?? "").trim()].filter(Boolean).join(" ") || "(no name)";
}

const toPerson = (p: DcPersonRow): DataCheckPerson => ({
  id: p.api_id,
  name: displayName(p),
  team: p.registered_team || null,
  active: p.active === true,
  status: p.status || null,
});

/** The comparison match_cards_link_person makes: trimmed, ignoring case. */
export const registeredNameKey = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Letters only, lower case, accents dropped: "O'Brien-Smith, José" -> ["o", "brien", "smith", "jose"]. */
export function nameTokens(v: string | null | undefined): string[] {
  return (v ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/** A whole name compared regardless of word order ("LEE Sam" = "Sam Lee"). */
export const nameKey = (v: string | null | undefined) => nameTokens(v).sort().join(" ");

/** A mobile as digits, country code included (no code means Hong Kong); null when too short to be one. */
export function mobileKey(v: string | null | undefined): string | null {
  if (blank(v)) return null;
  const { code, number } = splitPhone(v);
  const digits = number.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `${code.replace(/\D/g, "")}${digits}`;
}

function bigrams(token: string): Set<string> {
  const out = new Set<string>();
  if (token.length < 2) out.add(token);
  for (let i = 0; i < token.length - 1; i++) out.add(token.slice(i, i + 2));
  return out;
}

interface Token {
  t: string;
  grams: Set<string>;
}

const toTokens = (v: string | null | undefined): Token[] => nameTokens(v).map((t) => ({ t, grams: bigrams(t) }));

/** 1 for the same word, an initial for its word 0.5, otherwise the bigram overlap (Dice). */
function tokenSimilarity(a: Token, b: Token): number {
  if (a.t === b.t) return 1;
  if (a.t.length === 1 || b.t.length === 1) return a.t[0] === b.t[0] ? 0.5 : 0;
  let shared = 0;
  for (const g of a.grams) if (b.grams.has(g)) shared++;
  return (2 * shared) / (a.grams.size + b.grams.size);
}

/** Words of two letters or more, by their first two: only people sharing one with the card are scored. */
const prefixOf = (t: string) => (t.length >= 2 ? t.slice(0, 2) : null);

/**
 * How alike two names are, 0 to 1, whatever the word order: each word of
 * the shorter is paired with its closest unused word of the longer, and the
 * total is scaled by the number of words in both (Dice over words).
 */
function nameSimilarity(a: Token[], b: Token[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set<number>();
  let total = 0;
  for (const s of short) {
    let best = 0;
    let at = -1;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const v = tokenSimilarity(s, long[i]);
      if (v > best) {
        best = v;
        at = i;
      }
    }
    if (at >= 0) used.add(at);
    total += best;
  }
  return (2 * total) / (a.length + b.length);
}

/** Below this a name is not offered as a suggestion. */
export const SUGGESTION_THRESHOLD = 0.6;
const MAX_SUGGESTIONS = 3;

const opponentOf = (team: string | null, home: string | null, away: string | null) =>
  team && home === team ? away : team && away === team ? home : (away ?? home);

// ── Builder ─────────────────────────────────────────────────────────────

export function buildDataChecks(input: DataCheckInput): DataChecks {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const notResigned = input.people.filter((p) => p.status !== "Resigned");

  // Suggestions: each distinct card name once, against every name a
  // non-resigned person goes by (registered, given, preferred). Only people
  // with a word starting like one of the card's are scored, so the work
  // stays close to one pass over the people however many cards there are.
  const named = input.unlinkedCards.some((c) => !blank(c.raw_player_name));
  const variants = (named ? notResigned : []).map((p) => ({
    p,
    names: [p.registered_name, `${p.given_names ?? ""} ${p.surname ?? ""}`, p.preferred_name ? `${p.preferred_name} ${p.surname ?? ""}` : null]
      .filter((n): n is string => !blank(n))
      .map(toTokens),
  }));
  const byPrefix = new Map<string, Set<number>>();
  variants.forEach((v, i) => {
    for (const n of v.names) {
      for (const tok of n) {
        const k = prefixOf(tok.t);
        if (!k) continue;
        const set = byPrefix.get(k);
        if (set) set.add(i);
        else byPrefix.set(k, new Set([i]));
      }
    }
  });
  const suggestionsFor = new Map<string, DataCheckPerson[]>();
  const suggest = (raw: string): DataCheckPerson[] => {
    const key = nameKey(raw);
    const known = suggestionsFor.get(key);
    if (known) return known;
    const card = toTokens(raw);
    // At the threshold a two-word name needs two words alike, so a person
    // must share the start of two of the card's words (one, for a one-word card).
    const prefixes = new Set(card.map((tok) => prefixOf(tok.t)).filter((k): k is string => !!k));
    const hits = new Map<number, number>();
    for (const k of prefixes) for (const i of byPrefix.get(k) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1);
    const needed = Math.min(2, prefixes.size);
    const scored: { p: DcPersonRow; score: number }[] = [];
    for (const [i, n] of hits) {
      if (n < needed) continue;
      const v = variants[i];
      let score = 0;
      for (const n of v.names) score = Math.max(score, nameSimilarity(card, n));
      if (score >= SUGGESTION_THRESHOLD) scored.push({ p: v.p, score });
    }
    scored.sort((a, b) => b.score - a.score || (b.p.active === true ? 1 : 0) - (a.p.active === true ? 1 : 0) || displayName(a.p).localeCompare(displayName(b.p)));
    const out = scored.slice(0, MAX_SUGGESTIONS).map((s) => toPerson(s.p));
    suggestionsFor.set(key, out);
    return out;
  };

  const unlinkedCards: UnlinkedCard[] = input.unlinkedCards
    .map((c) => ({
      id: c.api_id,
      rawName: (c.raw_player_name ?? "").trim(),
      team: c.team || null,
      matchDate: c.match?.match_date ?? null,
      opponent: opponentOf(c.team, c.match?.home_team ?? null, c.match?.away_team ?? null) || null,
      suggestions: blank(c.raw_player_name) ? [] : suggest(c.raw_player_name!),
    }))
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "") || a.rawName.localeCompare(b.rawName));

  // Registered Names held by more than one person (anyone, as the card trigger counts).
  const byRegisteredName = new Map<string, DcPersonRow[]>();
  for (const p of input.people) {
    const k = registeredNameKey(p.registered_name);
    if (!k) continue;
    const group = byRegisteredName.get(k);
    if (group) group.push(p);
    else byRegisteredName.set(k, [p]);
  }
  const sharedRegisteredNames: SharedRegisteredName[] = [...byRegisteredName.values()]
    .filter((ps) => ps.length > 1)
    .map((ps) => ({ registeredName: ps[0].registered_name!.trim(), people: ps.map(toPerson) }))
    .sort((a, b) => a.registeredName.localeCompare(b.registeredName));

  const reRegistrations: ReRegistration[] = input.events
    .filter((e) => byId.has(e.person_id))
    .map((e) => ({
      id: e.id,
      person: toPerson(byId.get(e.person_id)!),
      season: e.season,
      previousTeam: e.previous_team,
      suggestedTeam: e.new_team || null,
      detail: e.detail || null,
      playUps: (Array.isArray(e.play_ups) ? e.play_ups : []).map((u) => ({ matchDate: u.match_date ?? null, team: u.team ?? null })),
      createdAt: e.created_at,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // eligibility.ts checkAdminData: an Active player with no registered team,
  // playing position or playing ability is blocked from every match.
  const incomplete: IncompletePlayer[] = input.people
    .filter((p) => p.active === true)
    .map((p) => ({
      person: toPerson(p),
      missing: [
        blank(p.registered_team) && "team",
        blank(p.playing_position) && "position",
        blank(p.playing_ability) && "ability",
      ].filter(Boolean) as MissingField[],
    }))
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => a.person.name.localeCompare(b.person.name));

  const duplicates = findDuplicates(input.people);

  const teams = new Set(input.teamNames);
  const needsFixing: NeedsFixing[] = [];
  // The membership board's "Needs fixing" column (membership.ts belongsOnBoard).
  for (const p of notResigned) {
    if (!blank(p.applicant_stage) && columnFor(p.applicant_stage!) === NEEDS_FIXING) {
      needsFixing.push({ kind: "stage", person: toPerson(p), value: p.applicant_stage! });
    }
  }
  // The Statements board's "Needs fixing" column (statements.ts statementBelongsOnBoard).
  for (const c of input.commitments) {
    if (!c.period_start || c.period_start > input.today || !c.period_end || c.period_end < REVIEWS_FROM) continue;
    if (reviewColumnFor(c.review_progress ?? "") !== REVIEW_NEEDS_FIXING) continue;
    const p = c.person_id ? byId.get(c.person_id) : undefined;
    if (p?.status === "Resigned") continue;
    needsFixing.push({ kind: "review", person: p ? toPerson(p) : null, commitmentId: c.api_id, value: c.review_progress ?? "" });
  }
  // A hand-set suspension with no team to serve it with: the suspensions
  // migration carries the others over and leaves these.
  for (const p of input.people) {
    const flags = [p.is_suspended === true && "Is suspended", (p.matches_to_serve ?? 0) > 0 && "Matches to serve"].filter(Boolean) as string[];
    if (flags.length > 0 && !teams.has(p.registered_team ?? "")) {
      needsFixing.push({ kind: "legacySuspension", person: toPerson(p), value: flags.join(", ") });
    }
  }

  return { unlinkedCards, sharedRegisteredNames, reRegistrations, incomplete, duplicates, needsFixing };
}

/**
 * People records that look like the same person: the same name (given
 * names and surname, any order), the same date of birth AND surname
 * (strangers share birthdays), the same mobile (as digits, country code
 * included) or the same email (normalizeEmail). One group per match and
 * value; a pair can be in several groups. Records whose personal data was
 * removed have nothing to compare.
 */
export function findDuplicates(people: DcPersonRow[]): DuplicateGroup[] {
  const keys: [DuplicateMatch, (p: DcPersonRow) => string | null][] = [
    ["name", (p) => {
      const k = nameKey(`${p.given_names ?? ""} ${p.surname ?? ""}`);
      return k.includes(" ") ? k : null; // a lone word is not enough
    }],
    ["dob", (p) => (p.date_of_birth && !blank(p.surname) ? `${p.date_of_birth}|${nameKey(p.surname)}` : null)],
    ["mobile", (p) => mobileKey(p.mobile_no)],
    ["email", (p) => (blank(p.email) ? null : normalizeEmail(p.email!))],
  ];
  const out: DuplicateGroup[] = [];
  for (const [match, keyOf] of keys) {
    const groups = new Map<string, DcPersonRow[]>();
    for (const p of people) {
      const k = keyOf(p);
      if (!k) continue;
      const group = groups.get(k);
      if (group) group.push(p);
      else groups.set(k, [p]);
    }
    for (const ps of groups.values()) {
      if (ps.length > 1) out.push({ match, people: ps.map(toPerson).sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return out.sort((a, b) => a.people[0].name.localeCompare(b.people[0].name) || a.match.localeCompare(b.match));
}
