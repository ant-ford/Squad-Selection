import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Shirt, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { shortTeam } from '@/lib/format';
import { usePlayerAttendance } from '@/lib/queries';
import type { AttendanceCell, AttendanceStatus, AvailabilitySource } from '@/api/getPlayerAttendance';

/** Diagonal hatching for "available, not picked": green, but visibly not a game played. */
const HATCH = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(16 185 129 / 0.55) 0 2px, transparent 2px 6px)',
};

type Look = { className: string; style?: React.CSSProperties; label: string };

/**
 * How each status reads in a cell. Past fixtures use lighter shades than
 * upcoming ones, so the eye goes to what can still be acted on.
 */
function lookFor(cell: AttendanceCell): Look {
  const unconfirmed = cell.source === 'default' || cell.source === 'opt-in';
  switch (cell.status) {
    case 'played':
      return { className: 'bg-emerald-200 text-emerald-800', label: 'Played' };
    case 'not-selected':
      return { className: 'bg-emerald-50 text-emerald-700', style: HATCH, label: 'Available, not picked' };
    case 'no-show':
      return { className: 'bg-background border border-neutral-300', label: 'No-show' };
    case 'selected':
      return { className: 'bg-primary text-primary-foreground', label: 'Selected' };
    case 'available':
      return unconfirmed
        ? { className: 'bg-background text-emerald-600 border border-dashed border-emerald-500', label: 'No answer (assumed available)' }
        : { className: 'bg-emerald-500 text-white', label: 'Available' };
    case 'maybe':
      return { className: 'bg-amber-300 text-amber-900', label: 'Maybe' };
    case 'unavailable':
      if (cell.past) return { className: 'bg-rose-200 text-rose-700', label: 'Unavailable' };
      return unconfirmed
        ? { className: 'bg-background text-rose-500 border border-dashed border-rose-400', label: 'No answer (opt-in only)' }
        : { className: 'bg-rose-500 text-white', label: 'Unavailable' };
    case 'elsewhere':
      return {
        className: 'bg-muted/50 text-muted-foreground/70',
        label: `${cell.past ? 'Played' : 'Selected'} for ${cell.elsewhereTeam ?? 'another side'}`,
      };
    case 'off':
      return { className: 'bg-muted/40 text-muted-foreground/60', label: 'Cancelled / rescheduled' };
  }
}

/** A no-show: picked, and never turned up. */
function BlackSpot({ size = 'h-3.5 w-3.5' }: { size?: string }) {
  return <span className={`block rounded-full bg-neutral-900 ${size}`} />;
}

function CellGlyph({ cell }: { cell: AttendanceCell }) {
  const icon = 'h-3.5 w-3.5';
  switch (cell.status) {
    case 'played':
      return <Check className={icon} strokeWidth={3} />;
    case 'selected':
      return <Shirt className={icon} />;
    case 'no-show':
      return <BlackSpot />;
    case 'maybe':
      return <span className="text-sm font-bold leading-none">?</span>;
    case 'unavailable':
      return <X className={icon} strokeWidth={3} />;
    case 'elsewhere':
      // Which side they were with that day - the most useful thing the cell can say.
      return <span className="text-[10px] font-semibold leading-none">{shortTeam(cell.elsewhereTeam ?? '')}</span>;
    case 'off':
      return <span className="leading-none">&ndash;</span>;
    default:
      return null;
  }
}

const SOURCE_TEXT: Record<AvailabilitySource, string> = {
  answer: 'Answered for this fixture',
  rule: 'From a standing availability preference',
  'opt-in': 'No answer - opt-in only, so counted unavailable',
  default: 'No answer - assumed available',
};

/** Legend entries, split by when they can appear. */
const LEGEND: { past: boolean; sample: AttendanceCell }[] = (
  [
    [true, 'played', 'answer'],
    [true, 'not-selected', 'answer'],
    [true, 'no-show', 'answer'],
    [true, 'unavailable', 'answer'],
    [false, 'selected', 'answer'],
    [false, 'available', 'answer'],
    [false, 'available', 'default'],
    [false, 'maybe', 'answer'],
    [false, 'unavailable', 'answer'],
    [false, 'unavailable', 'opt-in'],
  ] as [boolean, AttendanceStatus, AvailabilitySource][]
).map(([past, status, source]) => ({
  past,
  sample: {
    team: '', date: '', matchId: '', opponent: '', isHome: true, friendly: false,
    past, status, source, availability: 'Available',
  },
}));

function Swatch({ cell, size = 'h-4 w-4' }: { cell: AttendanceCell; size?: string }) {
  const look = lookFor(cell);
  if (cell.status === 'no-show') {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded ${size} ${look.className}`}>
        <BlackSpot size="h-2 w-2" />
      </span>
    );
  }
  return <span className={`inline-block shrink-0 rounded ${size} ${look.className}`} style={look.style} />;
}

function Detail({ date, cells }: { date: string; cells: AttendanceCell[] }) {
  return (
    <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 text-xs space-y-2">
      <p className="font-medium text-foreground">{safeFormat(date, 'EEEE d MMMM')}</p>
      {cells.map((c) => {
        const look = lookFor(c);
        const scored = c.goalsFor !== undefined && c.goalsAgainst !== undefined;
        return (
          <div key={`${c.matchId}-${c.team}`} className="flex items-start gap-2">
            <Swatch cell={c} size="h-3.5 w-3.5 mt-0.5" />
            <div className="min-w-0">
              <p className="text-foreground">
                {c.team} {scored ? `${c.goalsFor}–${c.goalsAgainst}` : 'v'} {c.opponent}
                <span className="text-muted-foreground">
                  {' '}&middot; {c.isHome ? 'Home' : 'Away'}
                  {c.friendly && <> &middot; Friendly</>}
                </span>
              </p>
              <p className="text-muted-foreground">
                {look.label}
                {c.assumed && ' (picked - no match cards for this game)'}
                {c.status === 'played' && c.goals ? ` · ${c.goals} goal${c.goals === 1 ? '' : 's'}` : ''}
                {c.status !== 'played' && c.status !== 'elsewhere' && c.status !== 'off' && (
                  <> &middot; {c.availability} ({SOURCE_TEXT[c.source].toLowerCase()})</>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TEAM_COL = 'w-14 min-w-14';
const DATE_COL = 'w-10 min-w-10';

/**
 * A player's season at a glance: HKFC teams down the side, match dates
 * across the top. Past columns say what happened, upcoming ones what is
 * planned; a line marks today. Tap a cell for the fixture behind it.
 *
 * Opens scrolled so today sits near the left edge with the last few
 * weeks still visible - the recent past and near future are what a coach
 * weighing up a selection is looking for.
 */
export default function AttendanceGrid({ playerId }: { playerId: string }) {
  const { data, isLoading, isError } = usePlayerAttendance(playerId);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLTableCellElement>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, AttendanceCell[]>();
    for (const c of data?.cells ?? []) {
      const key = `${c.team}|${c.date}`;
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [data]);

  const firstUpcoming = data?.dates.find((d) => d >= data.today);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const th = todayRef.current;
    if (!scroller) return;
    // Season over: the end is the interesting part.
    if (!th) { scroller.scrollLeft = scroller.scrollWidth; return; }
    // Keep ~3 past weeks in view to the left of the today line.
    scroller.scrollLeft = Math.max(0, th.offsetLeft - th.offsetWidth * 4);
  }, [data]);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">Attendance could not be loaded.</p>;
  }
  if (data.dates.length === 0) {
    return <p className="text-sm text-muted-foreground">No fixtures this season yet.</p>;
  }

  const [openTeam, openDate] = openKey ? openKey.split('|') : [];
  const openCells = openKey ? byKey.get(openKey) : undefined;

  return (
    <section>
      <p className="mb-3 text-xs text-muted-foreground">
        {data.team} &middot; season {data.season}
      </p>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className={`${TEAM_COL} sticky left-0 z-10 bg-background shadow-[0_0_0_3px_hsl(var(--background))]`} />
              {data.dates.map((d) => {
                const isToday = d === firstUpcoming;
                const past = d < data.today;
                return (
                  <th
                    key={d}
                    ref={isToday ? todayRef : undefined}
                    title={safeFormat(d, 'EEE d MMM')}
                    className={`${DATE_COL} pb-1 font-normal text-center leading-tight ${
                      past ? 'text-muted-foreground/70' : 'text-foreground'
                    } ${isToday ? 'border-l-2 border-primary' : ''}`}
                  >
                    <span className="block font-semibold tabular-nums">{safeFormat(d, 'd')}</span>
                    <span className="block text-[10px] uppercase tracking-wide">{safeFormat(d, 'MMM')}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((team) => {
              const own = team === data.team;
              return (
                <tr key={team}>
                  <th
                    scope="row"
                    className={`${TEAM_COL} sticky left-0 z-10 bg-background shadow-[0_0_0_3px_hsl(var(--background))] pr-1 text-left whitespace-nowrap ${
                      own ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'
                    }`}
                    title={own ? `${team} (their team)` : team}
                  >
                    {shortTeam(team)}
                    {own && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />}
                  </th>
                  {data.dates.map((d) => {
                    const key = `${team}|${d}`;
                    const cells = byKey.get(key);
                    const todayLine = d === firstUpcoming ? 'border-l-2 border-primary pl-0.5' : '';
                    if (!cells) return <td key={d} className={todayLine} />;
                    const cell = cells[0];
                    const look = lookFor(cell);
                    const open = openKey === key;
                    return (
                      <td key={d} className={todayLine}>
                        <button
                          onClick={() => setOpenKey(open ? null : key)}
                          aria-expanded={open}
                          aria-label={`${team} v ${cell.opponent}, ${safeFormat(d, 'd MMM')}: ${look.label}`}
                          title={`${shortTeam(team)} v ${cell.opponent} - ${look.label}`}
                          style={look.style}
                          className={`relative flex h-8 w-10 items-center justify-center rounded-md transition-transform active:scale-95 ${
                            look.className
                          } ${open ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : ''}`}
                        >
                          <CellGlyph cell={cell} />
                          {cells.length > 1 && (
                            <span className="absolute -top-1 -right-1 rounded-full bg-foreground px-1 text-[9px] leading-tight text-background">
                              {cells.length}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openCells && openDate && openTeam && <Detail date={openDate} cells={openCells} />}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-muted-foreground">
        {[true, false].map((past) => (
          <div key={String(past)}>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide">{past ? 'Past' : 'Upcoming'}</p>
            <ul className="space-y-1">
              {LEGEND.filter((l) => l.past === past).map((l) => (
                <li key={`${l.sample.status}-${l.sample.source}`} className="flex items-center gap-2">
                  <Swatch cell={l.sample} />
                  {lookFor(l.sample).label}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="sm:col-span-2 flex items-center gap-2">
          <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded bg-muted/50 text-muted-foreground/70 text-[9px] font-semibold">C</span>
          With another side that day (the letter says which)
        </p>
      </div>
    </section>
  );
}
