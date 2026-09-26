import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Small, dependency-free chart pieces for the membership Insights tab.
 *
 * Colours come from the validated reference palette (checked against the
 * card surface #f7f8f8 with the dataviz validator): slot 1 blue for current
 * players and single-series bars, slot 2 orange for applicants. Marks carry
 * colour; text always uses the app's text colours. Every chart can switch to
 * a table, so no value is reachable only by hovering.
 */
export const chartVars = {
  '--series-1': '#2a78d6',
  '--series-2': '#eb6834',
  '--grid': '#e1e0d9',
  '--baseline': '#c3c2b7',
  '--ink': '#0b0b0b',
  '--good': '#006300',
  '--bad': '#d03b3b',
} as CSSProperties;

const fmt = (n: number) => n.toLocaleString('en-GB');

/** Share of the row the longest bar takes, leaving room for its value label. */
const BAR_SPAN = 70;

/** Tick ceiling: the next 1, 2 or 5 x 10^k at or above `n` (minimum 1). */
export function niceMax(n: number): number {
  if (n <= 1) return 1;
  const step = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) if (m * step >= n) return m * step;
  return 10 * step;
}

export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Change against a named earlier period; `upIsGood` sets the colour. */
  delta?: { change: number; vs: string; upIsGood?: boolean } | null;
}) {
  const good = delta ? (delta.change >= 0) === (delta.upIsGood ?? true) : true;
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-0.5">{value}</p>
      {delta && (
        <p className="text-[11px] mt-0.5 flex items-center gap-0.5 flex-wrap text-muted-foreground">
          {delta.change !== 0 && (
            <span
              className="inline-flex items-center font-medium"
              style={{ color: good ? 'var(--good)' : 'var(--bad)' }}
            >
              {delta.change > 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
              <span className="sr-only">{delta.change > 0 ? 'up' : 'down'} </span>
              {fmt(Math.abs(delta.change))}
            </span>
          )}
          <span>
            {delta.change === 0 ? 'No change vs' : 'vs'} {delta.vs}
          </span>
        </p>
      )}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

/** A titled card with an optional table twin of its chart. */
export function ChartCard({
  title,
  caption,
  table,
  children,
  className = '',
}: {
  title: string;
  caption?: string;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={`bg-card border border-border rounded-lg p-3 sm:p-4 min-w-0 ${className}`}>
      <figcaption className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {caption && <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>}
        </div>
        {table && (
          <button
            onClick={() => setAsTable((v) => !v)}
            className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-pressed={asTable}
          >
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </figcaption>
      {asTable && table ? table : children}
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`px-1 pb-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, i) => (
                <td key={i} className={`px-1 py-1.5 text-foreground ${i > 0 ? 'text-right' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One series of horizontal bars, value at the tip. Bars are at most 12px
 * thick with a 4px rounded end and a square base on the shared baseline.
 */
export function HBars({
  rows,
  unit,
  max: fixedMax,
  suffix = '',
  narrowLabels = false,
  colourOf,
}: {
  rows: { label: string; value: number; note?: string }[];
  unit: string;
  /** The scale's end, e.g. 100 for percentages; defaults to the largest value. */
  max?: number;
  /** Written after the value, e.g. "%". */
  suffix?: string;
  /** Short labels (team names): the label column fits them instead of a player name. */
  narrowLabels?: boolean;
  /** Colour each bar by its label (team colours); one series colour otherwise. */
  colourOf?: (label: string) => string;
}) {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <Empty />;
  const cols = narrowLabels
    ? 'grid-cols-[max-content_1fr]'
    : 'grid-cols-[minmax(0,9rem)_1fr] sm:grid-cols-[minmax(0,12rem)_1fr]';
  return (
    <ul className="space-y-1.5" style={chartVars}>
      {rows.map((r) => (
        <li
          key={r.label}
          className={`grid ${cols} items-center gap-2 group`}
          title={`${r.label}: ${fmt(r.value)}${suffix} ${unit}${r.note ? ` (${r.note})` : ''}`}
        >
          <span className="text-xs text-foreground truncate">{r.label}</span>
          <span className="flex items-center gap-1.5 min-w-0 border-l" style={{ borderColor: 'var(--baseline)' }}>
            {/* shrink-0: a long note must never squeeze the bar - its length is the value. */}
            <span
              className="h-3 shrink-0 rounded-r transition-opacity group-hover:opacity-80"
              style={{
                width: `${(Math.min(r.value, max) / max) * BAR_SPAN}%`,
                minWidth: r.value > 0 ? 2 : 0,
                background: colourOf ? colourOf(r.label) : 'var(--series-1)',
              }}
            />
            <span className="text-xs text-foreground tabular-nums whitespace-nowrap truncate min-w-0">
              {fmt(r.value)}
              {suffix}
              {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/**
 * Monthly columns, one series. Hover or focus a column for its value; the
 * table twin carries every month. Long ranges label only each January.
 */
export function MonthColumns({ rows, unit }: { rows: { month: string; count: number }[]; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const top = niceMax(Math.max(...rows.map((r) => r.count)));
  const ticks = top >= 2 ? [top, top / 2, 0] : [top, 0];
  const everyMonth = rows.length <= 13;
  const hovered = active !== null ? rows[active] : null;
  return (
    <div style={chartVars}>
      <div className="relative flex">
        {/* y-axis ticks */}
        <div className="flex flex-col justify-between h-36 pr-1.5 text-[10px] text-muted-foreground tabular-nums text-right w-7 shrink-0">
          {ticks.map((t) => (
            <span key={t} className="leading-none -translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0 h-36 flex flex-col justify-between pointer-events-none">
            {ticks.map((t) => (
              <div
                key={t}
                className="border-t"
                style={{ borderColor: t === 0 ? 'var(--baseline)' : 'var(--grid)' }}
              />
            ))}
          </div>
          <div className="relative h-36 flex items-end gap-0.5" onPointerLeave={() => setActive(null)}>
            {rows.map((r, i) => (
              <button
                key={r.month}
                type="button"
                className="flex-1 h-full flex items-end justify-center focus:outline-none group"
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${monthLabel(r.month)}: ${fmt(r.count)} ${unit}`}
              >
                <span
                  className="w-full max-w-6 rounded-t transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-primary"
                  style={{
                    height: `${(r.count / top) * 100}%`,
                    minHeight: r.count > 0 ? 2 : 0,
                    background: 'var(--series-1)',
                    opacity: active === null || active === i ? 1 : 0.45,
                  }}
                />
              </button>
            ))}
          </div>
          {hovered && (
            <div
              role="status"
              className="absolute -top-1 z-10 -translate-x-1/2 -translate-y-full px-2 py-1 rounded-md bg-background border border-border shadow-sm text-xs whitespace-nowrap pointer-events-none"
              style={{ left: `${((active! + 0.5) / rows.length) * 100}%` }}
            >
              <span className="font-semibold text-foreground">{fmt(hovered.count)}</span>{' '}
              <span className="text-muted-foreground">
                {unit}, {monthLabel(hovered.month)}
              </span>
            </div>
          )}
          <div className="flex gap-0.5 mt-1 text-[10px] text-muted-foreground">
            {rows.map((r, i) => {
              const m = Number(r.month.slice(5, 7));
              const show = everyMonth || m === 1 || i === 0;
              return (
                <span key={r.month} className="flex-1 text-center truncate">
                  {show ? (everyMonth ? MONTHS[m - 1].slice(0, everyMonth && rows.length > 8 ? 1 : 3) : r.month.slice(0, 4)) : ''}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Per team: Active players (slot 1) with open applicants stacked after them
 * (slot 2) behind a 2px surface gap, and a tick at the matchday squad size.
 */
export function SquadBars({
  rows,
}: {
  rows: { team: string; active: number; pipeline: number; target: number }[];
}) {
  if (rows.length === 0) return <Empty />;
  const top = niceMax(Math.max(...rows.map((r) => Math.max(r.active + r.pipeline, r.target))));
  const pct = (n: number) => `${(n / top) * 100}%`;
  return (
    <div style={chartVars}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-1)' }} /> Active players
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-2)' }} /> Applicants in the pipeline
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5" style={{ background: 'var(--ink)' }} /> Matchday squad size
        </li>
      </ul>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.team}
            className="grid grid-cols-[4.5rem_1fr] items-center gap-2"
            title={`${r.team}: ${r.active} active, ${r.pipeline} in the pipeline, matchday squad ${r.target}`}
          >
            <span className="text-xs text-foreground truncate">{r.team}</span>
            <span className="relative flex items-center h-5 border-l" style={{ borderColor: 'var(--baseline)' }}>
              <span className="flex items-center h-3 gap-[2px]" style={{ width: pct(r.active + r.pipeline) }}>
                {r.active > 0 && (
                  <span
                    className={`h-full ${r.pipeline > 0 ? '' : 'rounded-r'}`}
                    style={{ flexGrow: r.active, flexBasis: 0, background: 'var(--series-1)' }}
                  />
                )}
                {r.pipeline > 0 && (
                  <span
                    className="h-full rounded-r"
                    style={{ flexGrow: r.pipeline, flexBasis: 0, background: 'var(--series-2)' }}
                  />
                )}
              </span>
              <span className="ml-1.5 text-xs text-foreground tabular-nums whitespace-nowrap">
                {r.active}
                {r.pipeline > 0 && <span className="text-muted-foreground"> +{r.pipeline}</span>}
              </span>
              <span
                className="absolute top-0 bottom-0 w-0.5"
                style={{ left: pct(r.target), background: 'var(--ink)' }}
                aria-hidden
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground py-4 text-center">Nothing in this period.</p>;
}

/**
 * One colour per HKFC team, the reference palette's eight slots in order
 * (validated on the card surface #f7f8f8: adjacent CVD ΔE ≥ 9.1, normal
 * vision ≥ 19.6). Keyed by team so a colour always means the same team,
 * whoever else is on the chart. Aqua, yellow and magenta sit under 3:1 on
 * the card, so every chart using them also has a table view and a written
 * total beside each bar.
 */
export const TEAM_COLOURS: Record<string, string> = {
  'HKFC A': '#2a78d6',
  'HKFC B': '#eb6834',
  'HKFC C': '#1baf7a',
  'HKFC D': '#eda100',
  'HKFC E': '#e87ba4',
  'HKFC F': '#008300',
  'HKFC G': '#4a3aa7',
  'HKFC H': '#e34948',
};
const OTHER_TEAM = '#8a8984';
export const teamColour = (team: string) => TEAM_COLOURS[team] ?? OTHER_TEAM;
const shortTeam = (team: string) => team.replace(/^HKFC /, '');

/** The key for team-coloured charts: only the teams present, A to H. */
export function TeamKey({ teams }: { teams: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 mb-2" aria-label="Key">
      {teams.map((t) => (
        <li key={t} className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: teamColour(t) }} aria-hidden />
          {shortTeam(t)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Horizontal bars split by team: each segment is one team's share, stacked
 * in team order (A first) so the same colour sits in the same place on every
 * row. The whole bar's length is the total; a 2px gap separates segments and
 * only the end is rounded. Hover a segment for its team and value.
 */
export function TeamStackedBars({
  rows,
  unit,
  narrowLabels = false,
}: {
  rows: { label: string; total: number; parts: [string, number][]; note?: string }[];
  unit: string;
  /** Short labels (seasons): the label column fits them instead of a player name. */
  narrowLabels?: boolean;
}) {
  if (rows.length === 0) return <Empty />;
  const max = Math.max(1, ...rows.map((r) => r.total));
  // A note after the total ("75 apps") needs more room on a phone.
  const span = rows.some((r) => r.note) ? BAR_SPAN - 12 : BAR_SPAN;
  const teams = [...new Set(rows.flatMap((r) => r.parts.map(([t]) => t)))].sort((a, b) => a.localeCompare(b));
  return (
    <div style={chartVars}>
      <TeamKey teams={teams} />
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const parts = [...r.parts].sort((a, b) => a[0].localeCompare(b[0]));
          const summary = parts.map(([t, n]) => `${shortTeam(t)} ${fmt(n)}`).join(', ');
          return (
            <li
              key={r.label}
              className={`grid ${narrowLabels ? 'grid-cols-[max-content_1fr]' : 'grid-cols-[minmax(0,9rem)_1fr] sm:grid-cols-[minmax(0,12rem)_1fr]'} items-center gap-2`}
              aria-label={`${r.label}: ${fmt(r.total)} ${unit} (${summary})`}
            >
              <span className="text-xs text-foreground truncate">{r.label}</span>
              <span className="flex items-center gap-1.5 min-w-0 border-l" style={{ borderColor: 'var(--baseline)' }}>
                <span
                  className="h-3 shrink-0 flex gap-[2px] overflow-hidden rounded-r"
                  style={{ width: `${(r.total / max) * span}%`, minWidth: r.total > 0 ? 2 : 0 }}
                >
                  {parts.map(([t, n]) => (
                    <span
                      key={t}
                      className="h-full hover:opacity-80"
                      style={{ flex: `${n} 0 0`, minWidth: 1, background: teamColour(t) }}
                      title={`${r.label} · ${t}: ${fmt(n)} ${unit}`}
                    />
                  ))}
                </span>
                <span className="text-xs text-foreground tabular-nums whitespace-nowrap truncate min-w-0">
                  {fmt(r.total)}
                  {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Columns along a category axis (seasons, say), one series, on a fixed or
 * nice scale, with an optional dashed reference line (50% for a win rate).
 * Only the highest and lowest columns carry a written value; hover or focus
 * any column for its value and detail, and the table twin has them all.
 */
export function Columns({
  rows,
  unit,
  max: fixedMax,
  suffix = '',
  reference,
  colour = 'var(--series-1)',
}: {
  rows: { key: string; label: string; value: number; detail?: string }[];
  unit: string;
  max?: number;
  suffix?: string;
  /** A dashed line across the plot at this value, e.g. 50 for "won half"; it gets its own tick label. */
  reference?: number;
  /** Column colour: one series, or a team's own colour. */
  colour?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const top = fixedMax ?? niceMax(Math.max(...rows.map((r) => r.value)));
  const ticks = [...new Set([top, reference ?? top / 2, 0])].sort((x, y) => y - x);
  const values = rows.map((r) => r.value);
  const hi = values.indexOf(Math.max(...values));
  const lo = values.indexOf(Math.min(...values));
  const hovered = active !== null ? rows[active] : null;
  return (
    // Room above the tallest column for its written value.
    <div style={chartVars} className="pt-4">
      <div className="relative flex">
        {/* Tick labels sit centred on their gridlines, the reference line's included. */}
        <div className="relative h-40 w-8 shrink-0 mr-1.5 text-[10px] text-muted-foreground tabular-nums text-right" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 leading-none -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {fmt(t)}
              {suffix}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-x-0 top-0 h-40 pointer-events-none">
            {ticks.map((t) =>
              t === reference ? null : (
                <div
                  key={t}
                  className="absolute inset-x-0 border-t"
                  style={{ top: `${(1 - t / top) * 100}%`, borderColor: t === 0 ? 'var(--baseline)' : 'var(--grid)' }}
                />
              ),
            )}
            {reference !== undefined && reference > 0 && reference < top && (
              <div
                className="absolute inset-x-0 border-t border-dashed"
                style={{ top: `${(1 - reference / top) * 100}%`, borderColor: 'var(--baseline)' }}
              />
            )}
          </div>
          <div className="relative h-40 flex items-end gap-[2px]" onPointerLeave={() => setActive(null)}>
            {rows.map((r, i) => (
              <button
                key={r.key}
                type="button"
                className="relative flex-1 h-full flex items-end justify-center focus:outline-none group"
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${r.label}: ${fmt(r.value)}${suffix} ${unit}${r.detail ? `, ${r.detail}` : ''}`}
              >
                {(i === hi || i === lo) && rows.length > 2 && (
                  <span
                    className="absolute text-[10px] text-foreground tabular-nums"
                    style={{ bottom: `calc(${(Math.min(r.value, top) / top) * 100}% + 2px)` }}
                    aria-hidden
                  >
                    {fmt(r.value)}
                    {suffix}
                  </span>
                )}
                <span
                  className="w-full max-w-7 rounded-t transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-primary"
                  style={{
                    height: `${(Math.min(r.value, top) / top) * 100}%`,
                    minHeight: r.value > 0 ? 2 : 0,
                    background: colour,
                    opacity: active === null || active === i ? 1 : 0.45,
                  }}
                />
              </button>
            ))}
          </div>
          {hovered && (
            <div
              role="status"
              className="absolute -top-1 z-10 -translate-x-1/2 -translate-y-full px-2 py-1 rounded-md bg-background border border-border shadow-sm text-xs whitespace-nowrap pointer-events-none"
              style={{ left: `${((active! + 0.5) / rows.length) * 100}%` }}
            >
              <span className="font-semibold text-foreground">
                {fmt(hovered.value)}
                {suffix}
              </span>{' '}
              <span className="text-muted-foreground">
                {unit}, {hovered.label}
                {hovered.detail ? ` · ${hovered.detail}` : ''}
              </span>
            </div>
          )}
          <div className="flex gap-[2px] mt-1 text-[10px] text-muted-foreground">
            {rows.map((r, i) => (
              // Unlabelled neighbours leave room, so a label may spill over its column.
              <span key={r.key} className="flex-1 min-w-0 text-center whitespace-nowrap overflow-visible flex justify-center">
                {/* Every other label when crowded, always including the latest. */}
                {rows.length <= 8 || i % 2 === (rows.length - 1) % 2 ? r.label : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
