/**
 * The Commitment reviews section of the membership Insights tab, counted
 * from the Statements board's own cards (so opening it costs no request
 * of its own). Pure functions over ReviewFact, which any StatementCard
 * satisfies.
 *
 * The review process only started in 2026, so this is "now and this
 * season" rather than trends: there is not yet a season to compare with.
 */
import { COMPLETE, MEMBER_SUBMITTED, NOT_STARTED, NOTIFIED, SPONSOR_SUBMITTED } from "./statementStages";
import { median, seasonStartYear } from "./membershipInsights";

export interface ReviewFact {
  name: string;
  stage: string;
  periodEnd?: string;
  autoNoticeOn?: string;
  days: number | null;
  notifyRequested: boolean;
  memberSubmittedOn?: string;
  sponsorSubmittedOn?: string;
  officerSubmittedOn?: string;
  sponsor?: string;
  recommendedReduction?: string;
  matchesPlayed?: number;
  matchesTeamPlayed?: number;
  practices?: string;
  gamesUmpired?: string;
}

/** Whole days from one "YYYY-MM-DD" to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "YYYY-MM" for `n` months after the month of `day`. */
function monthAfter(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

const AHEAD_MONTHS = 6;

/** Not Started, nobody has asked for the email yet, and its date has come (or the period has ended). */
const dueNow = (f: ReviewFact, today: string) =>
  f.stage === NOT_STARTED && !f.notifyRequested && !!f.autoNoticeOn && f.autoNoticeOn <= today;

// ── 1. Coming up ─────────────────────────────────────────────────────────

export interface EmailsAhead {
  /** Due already: inside the 60-day window, or the period has ended. */
  dueNow: number;
  /** This month and the next five, by the automatic email date. */
  byMonth: { month: string; count: number }[];
  total: number;
}

export function emailsAhead(facts: ReviewFact[], today: string): EmailsAhead {
  const months = Array.from({ length: AHEAD_MONTHS }, (_, i) => monthAfter(today, i));
  const counts = new Map(months.map((m) => [m, 0]));
  let now = 0;
  for (const f of facts) {
    if (f.stage !== NOT_STARTED || f.notifyRequested || !f.autoNoticeOn) continue;
    if (dueNow(f, today)) now += 1;
    else {
      const month = f.autoNoticeOn.slice(0, 7);
      if (counts.has(month)) counts.set(month, counts.get(month)! + 1);
    }
  }
  const byMonth = months.map((month) => ({ month, count: counts.get(month)! }));
  return { dueNow: now, byMonth, total: byMonth.reduce((n, m) => n + m.count, 0) };
}

// ── 2. Where reviews get stuck ───────────────────────────────────────────

export interface ReviewWait {
  stage: string;
  count: number;
  medianDays: number | null;
  over30: number;
  longest: { name: string; days: number } | null;
}

/** The three stages that wait on a person, as they stand now. */
export function reviewWaits(facts: ReviewFact[]): ReviewWait[] {
  return [NOTIFIED, MEMBER_SUBMITTED, SPONSOR_SUBMITTED].map((stage) => {
    const here = facts.filter((f) => f.stage === stage);
    const withDays = here.filter((f): f is ReviewFact & { days: number } => f.days !== null);
    const longest = withDays.reduce<(ReviewFact & { days: number }) | null>(
      (a, f) => (a === null || f.days > a.days ? f : a),
      null,
    );
    return {
      stage,
      count: here.length,
      medianDays: median(withDays.map((f) => f.days)),
      over30: withDays.filter((f) => f.days > 30).length,
      longest: longest ? { name: longest.name, days: longest.days } : null,
    };
  });
}

export interface StepTime {
  step: string;
  medianDays: number | null;
  reviews: number;
}

/**
 * How long each finished step took, from the submission dates. The member's
 * own step is not timed: the base does not keep the day the review email
 * went, and in 2026 most were sent well before the automatic date.
 */
export function stepTimes(facts: ReviewFact[]): StepTime[] {
  const gaps = (from: (f: ReviewFact) => string | undefined, to: (f: ReviewFact) => string | undefined) =>
    facts.flatMap((f) => {
      const a = from(f);
      const b = to(f);
      return a && b ? [Math.max(0, daysBetween(a, b))] : [];
    });
  const steps: [string, number[]][] = [
    ["Sponsor's section", gaps((f) => f.memberSubmittedOn, (f) => f.sponsorSubmittedOn)],
    ["Membership Officer's review", gaps((f) => f.sponsorSubmittedOn, (f) => f.officerSubmittedOn)],
  ];
  return steps.map(([step, days]) => ({ step, medianDays: median(days), reviews: days.length }));
}

// ── 3. Sponsor load ──────────────────────────────────────────────────────

/**
 * Reviews waiting on each sponsor (Member Submitted). There is no forecast
 * of reviews to come: a review's sponsor is only set once it is under way.
 */
export interface ReviewSponsorLoad {
  sponsor: string;
  waiting: number;
}

export function reviewSponsorLoad(facts: ReviewFact[]): ReviewSponsorLoad[] {
  const load = new Map<string, number>();
  for (const f of facts) {
    if (f.stage === MEMBER_SUBMITTED && f.sponsor) load.set(f.sponsor, (load.get(f.sponsor) ?? 0) + 1);
  }
  return [...load.entries()]
    .map(([sponsor, waiting]) => ({ sponsor, waiting }))
    .sort((a, b) => b.waiting - a.waiting || a.sponsor.localeCompare(b.sponsor));
}

// ── 4. Outcomes this season ──────────────────────────────────────────────

export interface Outcomes {
  completed: number;
  reductions: { label: string; count: number }[];
  participation: { label: string; count: number }[];
  practices: { label: string; count: number }[];
  umpired: { label: string; count: number }[];
}

/** Counts in a fixed order, with anything unexpected after it and blanks as "Not recorded". */
function tally(values: (string | undefined)[], order: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = v?.trim() || "Not recorded";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const labels = [...order, ...[...counts.keys()].filter((l) => !order.includes(l) && l !== "Not recorded").sort(), "Not recorded"];
  return labels.filter((l) => counts.has(l)).map((label) => ({ label, count: counts.get(label)! }));
}

/** Matches played as a share of the team's matches. */
export function participationBand(played?: number, teamPlayed?: number): string | undefined {
  if (played === undefined || !teamPlayed) return undefined;
  const share = played / teamPlayed;
  return share >= 0.7 ? "70% or more" : share >= 0.5 ? "50–69%" : "Under 50%";
}

/** Reviews completed this season (July to June), by the Membership Officer's submission. */
export function outcomesThisSeason(facts: ReviewFact[], today: string): Outcomes {
  const from = `${seasonStartYear(today)}-07-01`;
  const done = facts.filter((f) => f.stage === COMPLETE && (f.officerSubmittedOn ?? f.periodEnd ?? "") >= from);
  return {
    completed: done.length,
    reductions: tally(done.map((f) => f.recommendedReduction), ["None", "1 year", "1.5 years", "2 years"]),
    participation: tally(
      done.map((f) => participationBand(f.matchesPlayed, f.matchesTeamPlayed)),
      ["70% or more", "50–69%", "Under 50%"],
    ),
    practices: tally(done.map((f) => f.practices), ["Very Regular 70%+", "Moderate 50-70%", "Hardly Ever <50%"]),
    umpired: tally(done.map((f) => f.gamesUmpired), ["0", "1", "2", "3", "4", "5+"]),
  };
}
