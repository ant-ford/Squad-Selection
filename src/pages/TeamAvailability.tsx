import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AttendanceSheet } from '@/components/SeasonStatsSheet';
import { AttendanceLegend, CellGlyph, Swatch, lookFor, type CellLookInput } from '@/components/AttendanceGrid';
import { safeFormat } from '@/lib/dateUtils';
import { shortTeam } from '@/lib/format';
import { useTeamAttendance } from '@/lib/queries';
import { toneClasses } from '@/lib/statusTone';
import { MIN_SIDE, STATUS_ORDER, countSquad, squadTone } from '@/lib/teamAvailability';
import { openTeamAvailability, rememberOpenTeamAvailability } from '@/lib/scrollMemory';
import type { SquadPlayer, TeamFixture, TeamSquad } from '@/api/getTeamAttendance';

const NAME_COL = 'w-28 min-w-28 max-w-28';
const DATE_COL = 'w-10 min-w-10';
const STICKY = 'sticky left-0 z-10 bg-background shadow-[0_0_0_3px_hsl(var(--background))]';

type OpenPlayer = { id: string; name: string };

/** One team's fixture: the squad's availability as a count, coloured against the target squad size. */
function TeamCell({
  squad,
  fixtures,
  open,
  onToggle,
}: {
  squad: TeamSquad;
  fixtures: TeamFixture[];
  open: boolean;
  onToggle: () => void;
}) {
  const f = fixtures[0];
  const ring = open ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : '';
  const base = `relative flex h-8 w-10 flex-col items-center justify-center rounded-md transition-transform active:scale-95 ${ring}`;
  const badge = fixtures.length > 1 && (
    <span className="absolute -top-1 -right-1 rounded-full bg-foreground px-1 text-[9px] leading-tight text-background">
      {fixtures.length}
    </span>
  );

  if (f.off) {
    return (
      <button onClick={onToggle} aria-expanded={open} aria-label={`${squad.team} v ${f.opponent}: cancelled`} className={`${base} bg-muted/40 text-muted-foreground`}>
        <span className="leading-none">&ndash;</span>
        {badge}
      </button>
    );
  }

  const { available, maybe } = countSquad(squad.players, f.matchId);
  const tone = squadTone(available, squad.targetSquadSize);
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${squad.team} v ${f.opponent}, ${safeFormat(f.date, 'd MMM')}: ${available} available${maybe ? `, ${maybe} maybe` : ''}`}
      className={`${base} ${toneClasses(tone, f.past ? 'faint' : 'solid')}`}
    >
      <span className="text-xs font-semibold tabular-nums leading-none">{available}</span>
      {maybe > 0 && <span className="mt-0.5 text-[9px] leading-none">+{maybe}?</span>}
      {badge}
    </button>
  );
}

/** The fixture behind a tapped cell, and who in the squad is where. */
function FixtureDetail({
  squad,
  fixtures,
  onPlayer,
}: {
  squad: TeamSquad;
  fixtures: TeamFixture[];
  onPlayer: (p: OpenPlayer) => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 text-xs space-y-3">
      <p className="font-medium text-foreground">{safeFormat(fixtures[0].date, 'EEEE d MMMM')}</p>
      {fixtures.map((f) => {
        const groups = new Map<string, { cell: CellLookInput; players: SquadPlayer[] }>();
        for (const p of squad.players) {
          const c = p.cells[f.matchId];
          if (!c) continue;
          const cell = { ...c, past: f.past };
          const label = lookFor(cell).label;
          const group = groups.get(label);
          if (group) group.players.push(p);
          else groups.set(label, { cell, players: [p] });
        }
        const ordered = [...groups.entries()].sort(
          ([a, ga], [b, gb]) => STATUS_ORDER.indexOf(ga.cell.status) - STATUS_ORDER.indexOf(gb.cell.status) || a.localeCompare(b),
        );
        const scored = f.goalsFor !== undefined && f.goalsAgainst !== undefined;
        return (
          <div key={f.matchId} className="space-y-2">
            <p className="text-foreground">
              {f.team} {scored ? `${f.goalsFor}–${f.goalsAgainst}` : 'v'} {f.opponent}
              <span className="text-muted-foreground">
                {' '}&middot; {f.isHome ? 'Home' : 'Away'}
                {f.friendly && <> &middot; Friendly</>}
                {!f.past && !f.off && <> &middot; {f.selectedCount}/{squad.targetSquadSize} picked</>}
              </span>
            </p>
            {ordered.map(([label, g]) => (
              <div key={label} className="flex items-start gap-2">
                <Swatch cell={g.cell} size="h-3.5 w-3.5 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-muted-foreground">
                    {label} &middot; {g.players.length}
                  </p>
                  <p className="text-foreground">
                    {/* The comma stays with its name; the space between names is where lines break. */}
                    {g.players.map((p, i) => (
                      <Fragment key={p.id}>
                        <span className="whitespace-nowrap">
                          <button onClick={() => onPlayer(p)} className="hover:underline">
                            {p.name}
                          </button>
                          {i < g.players.length - 1 && ','}
                        </span>{' '}
                      </Fragment>
                    ))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Every squad's season at a glance: teams down the side, match dates across
 * the top, each cell the number of the squad available for that fixture.
 * A team opens to show its players, each cell exactly as on that player's
 * own attendance grid; a name opens that grid, with every team they can
 * play for. Teams start closed, so the first view is the whole club.
 */
export default function TeamAvailability() {
  const { data, isLoading, isError } = useTeamAttendance();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openTeamAvailability()));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<OpenPlayer | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLTableCellElement>(null);

  const fixturesByKey = useMemo(() => {
    const map = new Map<string, TeamFixture[]>();
    for (const f of data?.fixtures ?? []) {
      const key = `${f.team}|${f.date}`;
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [data]);

  const firstUpcoming = data?.dates.find((d) => d >= data.today);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const th = todayRef.current;
    if (!scroller) return;
    if (!th) { scroller.scrollLeft = scroller.scrollWidth; return; }
    // Keep ~3 past weeks in view to the left of the today line.
    scroller.scrollLeft = Math.max(0, th.offsetLeft - scroller.querySelector('th')!.offsetWidth - th.offsetWidth * 3);
  }, [data]);

  if (isLoading) {
    return (
      <div className="p-4">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="p-4 text-sm text-muted-foreground">Team availability could not be loaded.</p>;
  }
  if (data.dates.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No fixtures this season yet.</p>;
  }

  const toggleTeam = (team: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      rememberOpenTeamAvailability(next);
      return next;
    });
  const toggleCell = (key: string) => setOpenKey((k) => (k === key ? null : key));

  const [openTeam, openDate] = openKey ? openKey.split('|') : [];
  const openSquad = openTeam ? data.teams.find((t) => t.team === openTeam) : undefined;
  const openFixtures = openKey ? fixturesByKey.get(openKey) : undefined;

  const todayLine = (d: string) => (d === firstUpcoming ? 'border-l-2 border-primary pl-0.5' : '');

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8">
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className={`${NAME_COL} ${STICKY}`} />
              {data.dates.map((d) => {
                const isToday = d === firstUpcoming;
                return (
                  <th
                    key={d}
                    ref={isToday ? todayRef : undefined}
                    title={safeFormat(d, 'EEE d MMM')}
                    className={`${DATE_COL} pb-1 font-normal text-center leading-tight ${
                      d < data.today ? 'text-muted-foreground' : 'text-foreground'
                    } ${isToday ? 'border-l-2 border-primary' : ''}`}
                  >
                    <span className="block font-semibold tabular-nums">{safeFormat(d, 'd')}</span>
                    <span className="block text-[10px] uppercase tracking-wide">{safeFormat(d, 'MMM')}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {data.teams.map((squad) => {
            const isOpen = expanded.has(squad.team);
            return (
              <tbody key={squad.team}>
                <tr>
                  <th scope="row" className={`${NAME_COL} ${STICKY} pr-1 text-left`}>
                    <button
                      onClick={() => toggleTeam(squad.team)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-1 py-1.5 font-semibold text-foreground"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="truncate">{shortTeam(squad.team)}</span>
                      <span className="text-[10px] font-normal text-muted-foreground tabular-nums" title={`${squad.players.length} in the squad`}>
                        {squad.players.length}
                      </span>
                    </button>
                  </th>
                  {data.dates.map((d) => {
                    const key = `${squad.team}|${d}`;
                    const fixtures = fixturesByKey.get(key);
                    return (
                      <td key={d} className={todayLine(d)}>
                        {fixtures && (
                          <TeamCell squad={squad} fixtures={fixtures} open={openKey === key} onToggle={() => toggleCell(key)} />
                        )}
                      </td>
                    );
                  })}
                </tr>
                {isOpen &&
                  squad.players.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className={`${NAME_COL} ${STICKY} pr-1 text-left font-normal`}>
                        <button
                          onClick={() => setOpenPlayer(p)}
                          title={p.name}
                          className="block w-full truncate pl-[1.125rem] text-left text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {p.name}
                        </button>
                      </th>
                      {data.dates.map((d) => {
                        const key = `${squad.team}|${d}`;
                        const f = fixturesByKey.get(key)?.[0];
                        const c = f && p.cells[f.matchId];
                        if (!f || !c) return <td key={d} className={todayLine(d)} />;
                        const cell = { ...c, past: f.past };
                        const look = lookFor(cell);
                        return (
                          <td key={d} className={todayLine(d)}>
                            <button
                              onClick={() => toggleCell(key)}
                              aria-label={`${p.name}, ${safeFormat(d, 'd MMM')}: ${look.label}`}
                              title={look.label}
                              style={look.style}
                              className={`flex h-7 w-10 items-center justify-center rounded-md ${look.className}`}
                            >
                              <CellGlyph cell={cell} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>

      {openSquad && openFixtures && openDate && (
        <FixtureDetail squad={openSquad} fixtures={openFixtures} onPlayer={setOpenPlayer} />
      )}

      <details className="mt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Key</summary>
        <ul className="mt-2 mb-3 space-y-1">
          {(
            [
              ['success', 'Full squad available'],
              ['warning', `${MIN_SIDE} or more`],
              ['danger', `Under ${MIN_SIDE}`],
            ] as const
          ).map(([tone, label]) => (
            <li key={tone} className="flex items-center gap-2">
              <span className={`inline-block h-4 w-4 shrink-0 rounded ${toneClasses(tone, 'solid')}`} />
              {label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[9px]">+2?</span>
            Maybes
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px]">19</span>
            By the team: players in the squad
          </li>
        </ul>
        <AttendanceLegend />
      </details>

      <AttendanceSheet
        playerId={openPlayer?.id ?? null}
        playerName={openPlayer?.name}
        onClose={() => setOpenPlayer(null)}
      />
    </div>
  );
}
