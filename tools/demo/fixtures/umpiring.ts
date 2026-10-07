// Umpire view (/umpiring): the week's duties, the coordinator's tools and
// the season report. Fictional umpires (names from data.ts) and invented
// outside umpires; HKFC teams have the duties, mostly in other clubs' games.
//
// The coming weekend's week is hand-made for the user guide: confirmed,
// a paid offer waiting, open slots, a clash, an outside umpire, a game
// HKHA called off, one moved, one with the time TBC. Other weeks follow a
// pattern: played weeks are covered (one no-show, a gap or two), later
// weeks are mostly open. Writes answer OK and change nothing, so every
// screenshot starts from the same board.
import type { DutyAssignment, DutyOutcome, ReportDuty, TeamTally, UmpireDuty, UmpireOption, UmpireTally, UmpiringBoard, UmpiringReport } from '@shared/umpiring';
import { weekOf } from '@shared/umpiring';
import { byKickOff } from '@shared/kickOff';
import { canonicalKey } from '@shared/umpires';
import type { Persona } from '../personas.mjs';
import type { Routes } from './routing';
import { reply } from './routing';
import { PERSONAS, SAT1, SUN1, TEAMS, at, firstName, idOf } from './data';

const DAY = 86_400_000;
type Replied = ReturnType<typeof reply>;

// ── The club's umpires ─────────────────────────────────────────────────

const RAVI = PERSONAS.umpire.id;

/** The coordinator's list: [full name, still on commitment]. */
const POOL: [string, boolean][] = [
  ['Ravi Patel', false],
  ['Jamie Wong', true],
  ['Henry Yip', false],
  ['Patrick Ng', false],
  ['Karan Shah', false],
  ['Victor Kwok', true],
  ['Pete Summers', false],
  ['Lewis Mak', true],
];

const UMPIRES: UmpireOption[] = POOL.map(([fullName, onCommitment]) => ({
  personId: fullName === PERSONAS.umpire.name ? RAVI : idOf(fullName),
  name: firstName(fullName),
  fullName,
  onCommitment,
})).sort((a, b) => a.fullName.localeCompare(b.fullName));

const umpire = (fullName: string) => UMPIRES.find((u) => u.fullName === fullName)!;

/** Outside umpires: invented names, A–Z. */
const OUTSIDE = ['Bartholomew Quill', 'Desmond Farrow', 'Rufus Pemberton'];

// ── Building duties ────────────────────────────────────────────────────

let aseq = 0;
const assignmentId = () => `a0000000-0000-4000-8000-${String(++aseq).padStart(12, '0')}`;

function club(fullName: string, status: DutyAssignment['status'], paid = false, createdDays = -3): DutyAssignment {
  const u = umpire(fullName);
  return { id: assignmentId(), personId: u.personId, name: u.name, external: false, paid, status, createdAt: at(createdDays, 19, 30) };
}

function outside(name: string, createdDays = -2): DutyAssignment {
  return { id: assignmentId(), personId: null, name, external: true, paid: true, status: 'confirmed', createdAt: at(createdDays, 21) };
}

type DutyIn = Pick<UmpireDuty, 'homeTeam' | 'awayTeam' | 'dutyTeam'> & Partial<UmpireDuty> & { days: number; hh: number; mm?: number };

function duty(key: string, d: DutyIn): UmpireDuty {
  const { days, hh, mm = 0, ...rest } = d;
  return {
    id: `d0000000-0000-4000-8000-${key.padStart(12, '0')}`,
    matchDate: at(days, hh, mm),
    timeTbc: false,
    division: '3',
    venue: 'HKFC',
    slot: 1,
    status: 'scheduled',
    notNeeded: false,
    assignments: [],
    ...rest,
  };
}

/** Ravi's (the umpire persona's) own game this weekend, as gameLabel writes it. */
const RAVI_GAME = '14:30 HKFC C vs Valley B';

type Draft = UmpireDuty & { mine?: boolean; theirs?: Record<string, string> };

/**
 * The coming weekend. `forUmpire` flags the duty that overlaps Ravi's own
 * game; the coordinator's board says who in the pool is playing then.
 */
function mainWeek(coordinator: boolean, forUmpire: boolean): UmpireDuty[] {
  aseq = 0;
  const list: Draft[] = [
    duty('f01', { days: SAT1, hh: 9, homeTeam: 'Dragons', awayTeam: 'Shaheen', dutyTeam: 'HKFC E', assignments: [club('Patrick Ng', 'confirmed')] }),
    duty('f02', { days: SAT1, hh: 9, slot: 2, homeTeam: 'Dragons', awayTeam: 'Shaheen', dutyTeam: 'HKFC F', assignments: [outside('Rufus Pemberton')] }),
    duty('f03', { days: SAT1, hh: 11, mm: 15, venue: 'Happy Valley 1', division: '2', homeTeam: 'Tigers', awayTeam: 'Punjab', dutyTeam: 'HKFC C',
      assignments: [club('Ravi Patel', 'confirmed', false, -4)] }),
    // A paid offer waiting for the coordinator.
    duty('f04', { days: SAT1, hh: 12, mm: 30, division: '1', homeTeam: 'Khalsa A', awayTeam: 'Valley A', dutyTeam: 'HKFC B',
      assignments: [club('Henry Yip', 'offered', true, -1)] }),
    // Overlaps Ravi's (and Jamie's) 14:30 game at HKFC: another ground, under two hours apart.
    { ...duty('f05', { days: SAT1, hh: 13, mm: 30, venue: 'King’s Park', division: '4', homeTeam: 'Kowloon CC B', awayTeam: 'Dragons B', dutyTeam: 'HKFC D' }),
      mine: true, theirs: { [RAVI]: '14:30', [umpire('Jamie Wong').personId]: '14:30' } },
    { ...duty('f06', { days: SAT1, hh: 14, mm: 15, venue: 'Happy Valley 3', homeTeam: 'Punjab B', awayTeam: 'Tigers B', dutyTeam: 'HKFC F',
      assignments: [club('Karan Shah', 'confirmed')] }), theirs: { [umpire('Karan Shah').personId]: '13:00' } },
    duty('f11', { days: SUN1, hh: 0, venue: null, timeTbc: true, homeTeam: 'Khalsa B', awayTeam: 'Valley C', dutyTeam: 'HKFC B' }),
    duty('f07', { days: SUN1, hh: 10, venue: 'King’s Park', division: '2', homeTeam: 'Dragons', awayTeam: 'Punjab', dutyTeam: 'HKFC A',
      status: 'cancelled', assignments: [club('Victor Kwok', 'confirmed', false, -5)] }),
    duty('f08', { days: SUN1, hh: 10, mm: 45, division: '4', homeTeam: 'Tigers', awayTeam: 'Shaheen B', dutyTeam: 'HKFC G' }),
    // Ravi's own paid offer, waiting.
    duty('f09', { days: SUN1, hh: 10, mm: 45, slot: 2, division: '4', homeTeam: 'Tigers', awayTeam: 'Shaheen B', dutyTeam: 'HKFC H',
      assignments: [club('Ravi Patel', 'offered', true, -1)] }),
    duty('f10', { days: SUN1, hh: 12, mm: 30, homeTeam: 'Shaheen', awayTeam: 'Valley A', dutyTeam: 'HKFC E', status: 'rescheduled',
      assignments: [club('Pete Summers', 'confirmed', false, -6)] }),
  ];
  return list.map(({ mine, theirs, ...d }) => ({
    ...d,
    ...(forUmpire && mine ? { clash: RAVI_GAME } : {}),
    ...(coordinator ? { clashes: theirs ?? {} } : {}),
  }));
}

/** Other clubs' games, for the patterned weeks: [home, away, division]. */
const GAMES: [string, string, string][] = [
  ['Valley B', 'Kowloon CC A', '2'],
  ['Khalsa A', 'Punjab', '1'],
  ['Dragons', 'Tigers', '2'],
  ['Shaheen', 'Valley D', '4'],
  ['Kowloon CC B', 'Khalsa B', '3'],
  ['Punjab B', 'Valley C', '3'],
  ['Tigers B', 'Dragons B', '4'],
  ['Valley A', 'Shaheen B', '1'],
];

/** [days after Saturday, hh, mm, venue] */
const SLOTS: [number, number, number, string][] = [
  [0, 9, 0, 'HKFC'],
  [0, 10, 45, 'HKFC'],
  [0, 12, 30, 'HKFC'],
  [0, 15, 0, 'Happy Valley 1'],
  [1, 10, 0, 'King’s Park'],
  [1, 12, 30, 'HKFC'],
  [1, 14, 15, 'HKFC'],
];

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Free umpires in turn, and those past their commitment for the paid games. */
const FREE = ['Ravi Patel', 'Jamie Wong', 'Patrick Ng', 'Victor Kwok', 'Pete Summers', 'Henry Yip', 'Lewis Mak', 'Karan Shah'];
const PAID = ['Henry Yip', 'Karan Shah', 'Pete Summers'];

/** Week `k` from the coming weekend's (k ≠ 0): played and covered before it, mostly open after. */
function patternWeek(k: number, coordinator: boolean): UmpireDuty[] {
  aseq = 1000 + mod(k, 1000) * 10;
  const sat = SAT1 + 7 * k;
  return SLOTS.map(([d, hh, mm, venue], i) => {
    const [homeTeam, awayTeam, division] = GAMES[mod(i + 3 * k, GAMES.length)];
    const dutyTeam = TEAMS[mod(i + 3 * k, TEAMS.length)];
    const free = FREE[mod(i + 2 * k, FREE.length)];
    let assignments: DutyAssignment[] = [];
    if (k < 0) {
      if (k === -1 && i === 2) assignments = [club('Lewis Mak', 'no_show', false, 7 * k - 3)];
      else if ((k === -2 && i === 5) || (k === -4 && i === 6)) assignments = [];
      else if (mod(i + k, 6) === 0) assignments = [outside(OUTSIDE[mod(k, OUTSIDE.length)], 7 * k - 2)];
      else if (mod(i - k, 7) === 0) assignments = [club(PAID[mod(k, PAID.length)], 'confirmed', true, 7 * k - 2)];
      else assignments = [club(free, 'confirmed', false, 7 * k - 3)];
    } else if (i % 3 === 0) {
      assignments = [club(free, 'confirmed', false, -2)];
    }
    const key = `${String(mod(k, 1000)).padStart(3, '0')}${String(i).padStart(2, '0')}`;
    return {
      ...duty(key, { days: sat + d, hh, mm, venue, division, homeTeam, awayTeam, dutyTeam, assignments }),
      ...(coordinator ? { clashes: {} } : {}),
    };
  });
}

// ── Weeks ──────────────────────────────────────────────────────────────

const mondayMs = (monday: string) => Date.parse(`${monday}T00:00:00Z`);
/** The coming weekend's week: the board's default. */
const MAIN = weekOf(at(SAT1, 12));
const weekK = (monday: string) => Math.round((mondayMs(monday) - mondayMs(MAIN)) / (7 * DAY));
const mondayOfK = (k: number) => new Date(mondayMs(MAIN) + k * 7 * DAY).toISOString().slice(0, 10);

function access(p: Persona): 'umpire' | 'coordinator' | null {
  return p.umpiring ?? (p.offices.includes('sectionCaptain') ? 'coordinator' : null);
}

function board(p: Persona, weekParam: string | null): UmpiringBoard {
  const coordinator = access(p) === 'coordinator';
  const thisWeek = weekOf(new Date().toISOString());
  // Umpires see the weeks to come only; the coordinator the last four too.
  const atLeast = (w: string) => (!coordinator && w < thisWeek ? thisWeek : w);
  const asked = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? atLeast(weekOf(`${weekParam}T12:00:00+08:00`)) : null;
  const week = asked ?? MAIN;
  const k = weekK(week);
  const isUmpire = p.umpiring === 'umpire';
  const out: UmpiringBoard = {
    access: coordinator ? 'coordinator' : 'umpire',
    week,
    weeks: [...new Set([...[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(mondayOfK).filter((w) => coordinator || w >= thisWeek), week])].sort(),
    // In the Worker's order: a TBC time after the day's timed games.
    duties: (k === 0 ? mainWeek(coordinator, isUmpire) : patternWeek(k, coordinator)).sort((a, b) => byKickOff(a.matchDate, b.matchDate)),
    me: {
      personId: p.id,
      isUmpire,
      // Past their commitment, so Ravi is offered Paid as well.
      onCommitment: false,
      commitmentEndDate: isUmpire ? '2026-04-30' : null,
    },
    messages: p.offices.includes('umpireCoordinator'),
    link: `https://app.eddy.global/umpiring?week=${week}`,
  };
  if (coordinator) {
    out.umpires = UMPIRES;
    out.externalNames = OUTSIDE;
  }
  return out;
}

// ── The season report ──────────────────────────────────────────────────

/** worker/src/umpiring.ts tallyDuties, with the club umpires' full names. */
function tally(duties: UmpireDuty[], season: string): UmpiringReport {
  const tallies = new Map<string, UmpireTally>();
  const byTeam = new Map<string, TeamTally>();
  const report: UmpiringReport = { season, duties: 0, coveredFree: 0, coveredPaidMembers: 0, coveredExternal: 0, noShows: 0, uncovered: 0, umpires: [], byTeam: [], rows: [] };
  const fullName = (a: DutyAssignment) => UMPIRES.find((u) => u.personId === a.personId)?.fullName ?? a.name;
  for (const d of [...duties].sort((x, y) => byKickOff(x.matchDate, y.matchDate) || x.dutyTeam.localeCompare(y.dutyTeam))) {
    if (d.status === 'cancelled') continue;
    report.duties++;
    const team = byTeam.get(d.dutyTeam) ?? { team: d.dutyTeam, duties: 0, free: 0, paidMembers: 0, outside: 0, uncovered: 0 };
    team.duties++;
    byTeam.set(d.dutyTeam, team);
    const a = d.assignments.find((x) => x.status === 'confirmed' || x.status === 'no_show');
    const outcome: DutyOutcome = !a ? 'uncovered' : a.status === 'no_show' ? 'no_show' : a.external ? 'outside' : a.paid ? 'paid' : 'free';
    const row: ReportDuty = {
      matchDate: d.matchDate, timeTbc: d.timeTbc, venue: d.venue, division: d.division, homeTeam: d.homeTeam, awayTeam: d.awayTeam,
      dutyTeam: d.dutyTeam, personId: a?.personId ?? null, umpire: a ? fullName(a) : null, short: a?.name ?? null, outcome,
    };
    report.rows.push(row);
    if (!a) {
      report.uncovered++;
      team.uncovered++;
      continue;
    }
    const key = a.personId ?? `external:${canonicalKey(a.name)}`;
    const t = tallies.get(key) ?? { name: fullName(a), personId: a.personId, external: a.external, free: 0, paid: 0, noShows: 0 };
    tallies.set(key, t);
    if (a.status === 'no_show') {
      t.noShows++;
      report.noShows++;
      report.uncovered++;
      team.uncovered++;
      continue;
    }
    if (a.paid) t.paid++;
    else t.free++;
    if (a.external) {
      report.coveredExternal++;
      team.outside++;
    } else if (a.paid) {
      report.coveredPaidMembers++;
      team.paidMembers++;
    } else {
      report.coveredFree++;
      team.free++;
    }
  }
  report.umpires = [...tallies.values()].sort((a, b) => b.free + b.paid - (a.free + a.paid) || a.name.localeCompare(b.name));
  report.byTeam = [...byTeam.values()].sort((a, b) => a.team.localeCompare(b.team));
  return report;
}

/** The season so far (July to June): the five weekends before the coming one. */
function seasonReport(seasonParam: string | null): UmpiringReport {
  const now = new Date(Date.now() + 8 * 3_600_000);
  const start = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const current = `${start}-${start + 1}`;
  const season = seasonParam && /^\d{4}-\d{4}$/.test(seasonParam) ? seasonParam : current;
  if (season !== current) return tally([], season);
  const played = [-5, -4, -3, -2, -1].flatMap((k) => patternWeek(k, false)).filter((d) => Date.parse(d.matchDate) < Date.now());
  return tally(played, season);
}

/**
 * The umpire persona's next duty as the player page's "Your duty" line
 * shows it (worker/src/myDuties.ts nextDutyLine): duty f03 above. For
 * player.ts's `duty`, so the line and the board agree.
 */
export function umpireNextDuty(): { when: string; game: string; venue: string | null; slot: 1 | 2 } {
  const d = mainWeek(false, false).find((x) => x.assignments.some((a) => a.personId === RAVI && a.status === 'confirmed'))!;
  const when = new Date(d.matchDate);
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', weekday: 'short', day: 'numeric', month: 'short' }).format(when);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(when);
  return { when: `${dayLabel}, ${time}`, game: `${d.homeTeam} vs ${d.awayTeam}`, venue: d.venue, slot: d.slot };
}

// ── Routes ─────────────────────────────────────────────────────────────

const OK = { ok: true as const };

export const routes: Routes = {
  'GET /api/umpiring': ({ persona, query }): UmpiringBoard | Replied =>
    access(persona) ? board(persona, query.get('week')) : reply(403, { error: 'UMPIRE_ACCESS_REQUIRED', message: "The umpiring duties are for the club's umpires." }),
  'GET /api/umpiring/report': ({ persona, query }): UmpiringReport | Replied =>
    access(persona) === 'coordinator'
      ? seasonReport(query.get('season'))
      : reply(403, { error: 'OFFICER_ACCESS_REQUIRED', message: 'Only the Umpire Coordinator can do that.' }),
  'POST /api/umpiring/seen': (): { seen: number } => ({ seen: 1 }),
  'POST /api/umpiring/duties/:id/take': ({ body }): { ok: true; status: 'offered' | 'confirmed' } => ({ ok: true, status: body?.paid ? 'offered' : 'confirmed' }),
  'POST /api/umpiring/duties/:id/assign': (): typeof OK => OK,
  'POST /api/umpiring/assignments/:id/withdraw': (): typeof OK => OK,
  'POST /api/umpiring/assignments/:id/confirm': (): typeof OK => OK,
  'POST /api/umpiring/assignments/:id/no-show': (): typeof OK => OK,
};
