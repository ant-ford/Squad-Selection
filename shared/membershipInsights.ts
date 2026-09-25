/**
 * The counting behind the membership Insights tab.
 *
 * Pure functions over the rows /api/membership/insights returns, run in the
 * browser so the officer can change the period without a request. Dates are
 * Hong Kong calendar days ("YYYY-MM-DD") throughout.
 *
 * What the data can and cannot say: the base keeps each applicant's CURRENT
 * stage, not the stages they passed through (until a stage history table
 * exists). So "how far applicants got" is inferred from where they are now,
 * and an applicant parked as Pending, On Hold or Rejected is only known to
 * have applied.
 */
import { NEEDS_FIXING, PIPELINE_STAGES, type BoardColumn } from "./membershipStages";

export interface InsightFact {
  name: string;
  stage: string;
  column: BoardColumn;
  appliedOn?: string;
  joinDate?: string;
  stageSince?: string;
  /** Days in the current stage, or since applying without a stage date. */
  days: number | null;
  team?: string;
  playingPosition?: string;
  applicantType?: string;
  categoryType?: string;
  gender?: string;
  sponsor?: string;
}

export interface TeamSquad {
  team: string;
  teamRank: number;
  /** Teams."Target Squad Size" - the matchday squad. */
  targetSquadSize: number;
  active: number;
  byPosition: Record<string, number>;
}

export type Period = "season" | "last-season" | "12m" | "all";

export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodRanges {
  current: DateRange;
  /** The period compared against, or null when there is none ("all"). */
  previous: DateRange | null;
  previousLabel: string | null;
}

const ACCEPTED_INDEX = PIPELINE_STAGES.length - 1;
/** Stages 1-6: applications still in progress. */
export const OPEN_STAGES = PIPELINE_STAGES.slice(0, ACCEPTED_INDEX);

const pad = (n: number) => String(n).padStart(2, "0");

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same calendar day a year earlier (29 Feb becomes 28 Feb). */
function yearEarlier(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${pad(m)}-${pad(Math.min(d, last))}`;
}

/** The club's season runs July to June: "2026-2027" starts 1 July 2026. */
export function seasonStartYear(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}

export function seasonLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

export function periodRanges(period: Period, today: string): PeriodRanges {
  const y = seasonStartYear(today);
  switch (period) {
    case "season":
      // Compared with the same point last season, not all of it: otherwise
      // every season looks behind until June.
      return {
        current: { from: `${y}-07-01`, to: today },
        previous: { from: `${y - 1}-07-01`, to: yearEarlier(today) },
        previousLabel: "same point last season",
      };
    case "last-season":
      return {
        current: { from: `${y - 1}-07-01`, to: `${y}-06-30` },
        previous: { from: `${y - 2}-07-01`, to: `${y - 1}-06-30` },
        previousLabel: `season ${seasonLabel(y - 2)}`,
      };
    case "12m":
      return {
        current: { from: addDays(today, -364), to: today },
        previous: { from: addDays(today, -729), to: addDays(today, -365) },
        previousLabel: "the 12 months before",
      };
    case "all":
      return { current: { from: "0000-01-01", to: today }, previous: null, previousLabel: null };
  }
}

export const inRange = (day: string | undefined, r: DateRange) => day !== undefined && day >= r.from && day <= r.to;

/**
 * Applications through the membership process. Temporary players (registered
 * without it) and records whose stage needs fixing are left out.
 */
const isApplication = (f: InsightFact) => f.column !== "Temporary" && f.column !== NEEDS_FIXING;

export function applicationsIn(facts: InsightFact[], r: DateRange): InsightFact[] {
  return facts.filter((f) => isApplication(f) && inRange(f.appliedOn, r));
}

export function joinedIn(facts: InsightFact[], r: DateRange): InsightFact[] {
  return facts.filter((f) => f.column === "Accepted" && inRange(f.joinDate, r));
}

/**
 * For the applications made in the period: how many reached at least each
 * stage, judged by where they are now. A parked applicant counts as having
 * applied and no further.
 */
export function funnel(facts: InsightFact[], r: DateRange): { stage: string; reached: number }[] {
  const reachedIndex = applicationsIn(facts, r).map((f) => {
    const i = (PIPELINE_STAGES as readonly string[]).indexOf(f.column);
    return i >= 0 ? i : 0;
  });
  return PIPELINE_STAGES.map((stage, i) => ({ stage, reached: reachedIndex.filter((x) => x >= i).length }));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const open = (facts: InsightFact[]) => facts.filter((f) => (OPEN_STAGES as readonly string[]).includes(f.column));

/** Where the open applications stand right now. Not scoped to a period. */
export function nowSummary(facts: InsightFact[]) {
  const pipeline = open(facts);
  const days = pipeline.map((f) => f.days).filter((d): d is number => d !== null);
  return {
    inPipeline: pipeline.length,
    readyToApprove: pipeline.filter((f) => f.column === OPEN_STAGES[OPEN_STAGES.length - 1]).length,
    over30: days.filter((d) => d > 30).length,
    medianWait: median(days),
  };
}

export interface StageWait {
  stage: string;
  count: number;
  medianDays: number | null;
  longest: { name: string; days: number } | null;
}

export function waitsByStage(facts: InsightFact[]): StageWait[] {
  return OPEN_STAGES.map((stage) => {
    const here = facts.filter((f) => f.column === stage);
    const withDays = here.filter((f): f is InsightFact & { days: number } => f.days !== null);
    const longest = withDays.reduce<InsightFact & { days: number } | null>(
      (best, f) => (!best || f.days > best.days ? f : best),
      null,
    );
    return {
      stage,
      count: here.length,
      medianDays: median(withDays.map((f) => f.days)),
      longest: longest ? { name: longest.name, days: longest.days } : null,
    };
  });
}

/** "YYYY-MM" for each month from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Monthly counts over the period, up to this month (future months of the
 * season are not drawn). "All time" starts at the earliest month with data,
 * and never more than ten years back.
 */
export function monthly(
  facts: InsightFact[],
  r: DateRange,
  today: string,
  which: "applied" | "joined",
): { month: string; count: number }[] {
  const rows = which === "applied" ? applicationsIn(facts, r) : joinedIn(facts, r);
  const dayOf = (f: InsightFact) => (which === "applied" ? f.appliedOn : f.joinDate) as string;
  const end = r.to < today ? r.to : today;
  let start = r.from;
  if (start === "0000-01-01") {
    const earliest = rows.map(dayOf).sort()[0] ?? today;
    const floor = `${Number(today.slice(0, 4)) - 10}-${today.slice(5, 7)}-01`;
    start = earliest < floor ? floor : earliest;
  }
  const counts = new Map<string, number>();
  for (const f of rows) counts.set(dayOf(f).slice(0, 7), (counts.get(dayOf(f).slice(0, 7)) ?? 0) + 1);
  return monthsBetween(start, end).map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** Counts by one attribute, largest first; blanks count as "Not set". */
export function breakdown(
  rows: InsightFact[],
  key: "applicantType" | "categoryType" | "playingPosition" | "gender" | "team",
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of rows) {
    const label = f[key] || "Not set";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Open applications heading for each team, for the squad chart. */
export function pipelineByTeam(facts: InsightFact[]): Map<string, InsightFact[]> {
  const byTeam = new Map<string, InsightFact[]>();
  for (const f of open(facts)) {
    const team = f.team || "No team";
    byTeam.set(team, [...(byTeam.get(team) ?? []), f]);
  }
  return byTeam;
}

/** Sponsors of open applications, the ones holding things up first. */
export function sponsorLoad(facts: InsightFact[]): { sponsor: string; open: number; waitingOnThem: number }[] {
  const bySponsor = new Map<string, { open: number; waitingOnThem: number }>();
  for (const f of open(facts)) {
    if (!f.sponsor) continue;
    const row = bySponsor.get(f.sponsor) ?? { open: 0, waitingOnThem: 0 };
    row.open += 1;
    // Stage 3 = club application signed, waiting for the sponsor to sign.
    if (f.column === OPEN_STAGES[2]) row.waitingOnThem += 1;
    bySponsor.set(f.sponsor, row);
  }
  return [...bySponsor.entries()]
    .map(([sponsor, row]) => ({ sponsor, ...row }))
    .sort((a, b) => b.waitingOnThem - a.waitingOnThem || b.open - a.open || a.sponsor.localeCompare(b.sponsor));
}
