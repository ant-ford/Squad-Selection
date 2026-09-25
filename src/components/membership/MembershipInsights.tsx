import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembershipInsights } from '@/lib/queries';
import { hkDateKey } from '@shared/hkDateKey';
import {
  applicationsIn,
  breakdown,
  funnel,
  joinedIn,
  monthly,
  nowSummary,
  periodRanges,
  pipelineByTeam,
  seasonLabel,
  seasonStartYear,
  sponsorLoad,
  waitsByStage,
  type Period,
} from '@shared/membershipInsights';
import { ChartCard, DataTable, HBars, MonthColumns, SquadBars, StatTile, monthLabel } from './charts';

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Flexible/Varies'];

/**
 * The membership Insights tab. "Right now" is the pipeline as it stands and
 * ignores the period; everything below the period picker is scoped to it,
 * so every number under the picker agrees with every other.
 */
export default function MembershipInsights() {
  const { data, isLoading, isError, refetch } = useMembershipInsights();
  const [params, setParams] = useSearchParams();
  const today = hkDateKey(new Date().toISOString());
  const y = seasonStartYear(today);
  const periods: { key: Period; label: string }[] = [
    { key: 'season', label: `This season (${seasonLabel(y)})` },
    { key: 'last-season', label: `Last season (${seasonLabel(y - 1)})` },
    { key: '12m', label: 'Last 12 months' },
    { key: 'all', label: 'All time' },
  ];
  const period = (periods.find((p) => p.key === params.get('period'))?.key ?? 'season') as Period;
  const setPeriod = (p: Period) => {
    const next = new URLSearchParams(params);
    if (p === 'season') next.delete('period');
    else next.set('period', p);
    setParams(next, { replace: true });
  };

  const view = useMemo(() => {
    if (!data) return null;
    const { facts, teams } = data;
    const ranges = periodRanges(period, today);
    const applied = applicationsIn(facts, ranges.current);
    const joined = joinedIn(facts, ranges.current);
    const byTeam = pipelineByTeam(facts);
    const stages = funnel(facts, ranges.current);
    const first = stages[0]?.reached || 0;
    return {
      ranges,
      now: nowSummary(facts),
      waits: waitsByStage(facts),
      sponsors: sponsorLoad(facts),
      applied,
      joined,
      previousApplied: ranges.previous ? applicationsIn(facts, ranges.previous).length : null,
      previousJoined: ranges.previous ? joinedIn(facts, ranges.previous).length : null,
      funnel: stages.map((s) => ({
        label: s.stage,
        value: s.reached,
        note: first ? `${Math.round((s.reached / first) * 100)}%` : undefined,
      })),
      appliedMonthly: monthly(facts, ranges.current, today, 'applied'),
      joinedMonthly: monthly(facts, ranges.current, today, 'joined'),
      byType: breakdown(applied, 'applicantType'),
      byPosition: breakdown(applied, 'playingPosition'),
      squads: teams.map((t) => ({
        team: t.team,
        active: t.active,
        pipeline: byTeam.get(t.team)?.length ?? 0,
        target: t.targetSquadSize,
        byPosition: t.byPosition,
        pipelineByPosition: breakdown(byTeam.get(t.team) ?? [], 'playingPosition'),
      })),
    };
  }, [data, period, today]);

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError || !data || !view) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl">
        <p className="text-muted-foreground mb-2">Could not load Insights.</p>
        <button onClick={() => refetch()} className="text-sm text-primary underline">
          Try again
        </button>
      </div>
    );
  }

  const waitWord = data.hasStageDates ? 'in stage' : 'since applying';
  const vs = view.ranges.previousLabel ?? '';
  const delta = (current: number, previous: number | null) =>
    previous === null ? null : { change: current - previous, vs };

  return (
    <div className="space-y-6">
      {/* ── Right now: not affected by the period ── */}
      <section className="space-y-3" aria-labelledby="now-heading">
        <h2 id="now-heading" className="text-sm font-semibold text-foreground">
          Right now
        </h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatTile label="In the pipeline" value={view.now.inPipeline} hint="Stages 1 to 6" />
          <StatTile label="Ready to approve" value={view.now.readyToApprove} hint="At stage 6" />
          <StatTile label="Waiting over 30 days" value={view.now.over30} hint={`Days ${waitWord}`} />
          <StatTile
            label="Median wait"
            value={view.now.medianWait === null ? '–' : `${view.now.medianWait}d`}
            hint={`Days ${waitWord}`}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Where applications are waiting"
            caption={`Open applications by stage. Days are counted ${waitWord}.`}
          >
            <DataTable
              head={['Stage', 'Waiting', 'Median', 'Longest']}
              rows={view.waits.map((w) => [
                w.stage,
                w.count,
                w.medianDays === null ? '–' : `${w.medianDays}d`,
                w.longest ? `${w.longest.name} (${w.longest.days}d)` : '–',
              ])}
            />
          </ChartCard>

          <ChartCard
            title="Squad sizes"
            caption="Active players per Selected Team, with the applicants heading for each."
            table={
              <DataTable
                head={['Team', 'Active', 'Pipeline', 'Matchday squad']}
                rows={view.squads.map((s) => [s.team, s.active, s.pipeline, s.target])}
              />
            }
          >
            <SquadBars rows={view.squads} />
          </ChartCard>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Positions by team"
            caption="Active players, with applicants in the pipeline shown as +n."
          >
            <DataTable
              head={['Team', 'GK', 'DEF', 'MID', 'FWD', 'Flex']}
              rows={view.squads.map((s) => [
                s.team,
                ...POSITIONS.map((p) => {
                  const extra = s.pipelineByPosition.find((x) => x.label === p)?.count ?? 0;
                  const have = s.byPosition[p] ?? 0;
                  return (
                    <span key={p} className={have === 0 && p === 'Goalkeeper' ? 'font-semibold' : ''}>
                      {have}
                      {extra > 0 && <span className="text-muted-foreground"> +{extra}</span>}
                    </span>
                  );
                }),
              ])}
            />
          </ChartCard>

          <ChartCard title="Sponsors" caption="Open applications each sponsor has, and how many wait on their signature.">
            {view.sponsors.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No sponsors on open applications.</p>
            ) : (
              <DataTable
                head={['Sponsor', 'Open', 'Waiting on them']}
                rows={view.sponsors.slice(0, 10).map((s) => [s.sponsor, s.open, s.waitingOnThem])}
              />
            )}
          </ChartCard>
        </div>
      </section>

      {/* ── The period picker scopes everything below it ── */}
      <section className="space-y-3" aria-labelledby="period-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="period-heading" className="text-sm font-semibold text-foreground mr-1">
            Over time
          </h2>
          <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1.5">
            {periods.map((p) => (
              <button
                key={p.key}
                role="radio"
                aria-checked={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                  period === p.key
                    ? 'bg-secondary text-secondary-foreground border-secondary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2">
          <StatTile
            label="Applications"
            value={view.applied.length}
            delta={delta(view.applied.length, view.previousApplied)}
          />
          <StatTile label="New members" value={view.joined.length} delta={delta(view.joined.length, view.previousJoined)} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Applications per month"
            caption="By application date. Temporary players are not counted."
            table={
              <DataTable
                head={['Month', 'Applications']}
                rows={view.appliedMonthly.map((m) => [monthLabel(m.month), m.count])}
              />
            }
          >
            <MonthColumns rows={view.appliedMonthly} unit="applications" />
          </ChartCard>
          <ChartCard
            title="New members per month"
            caption="By Join Date."
            table={
              <DataTable
                head={['Month', 'New members']}
                rows={view.joinedMonthly.map((m) => [monthLabel(m.month), m.count])}
              />
            }
          >
            <MonthColumns rows={view.joinedMonthly} unit="new members" />
          </ChartCard>
        </div>

        <ChartCard
          title="How far applicants got"
          caption="Applications made in this period, by the furthest stage they have reached. Judged by each applicant's current stage, so anyone Pending, On Hold or Rejected counts as having applied only."
          table={
            <DataTable
              head={['Stage', 'Reached', 'Of applicants']}
              rows={view.funnel.map((f) => [f.label, f.value, f.note ?? '–'])}
            />
          }
        >
          <HBars rows={view.funnel} unit="applicants" />
        </ChartCard>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="Who applied: applicant type">
            <HBars rows={view.byType.map((r) => ({ label: r.label, value: r.count }))} unit="applicants" />
          </ChartCard>
          <ChartCard title="Who applied: position">
            <HBars rows={view.byPosition.map((r) => ({ label: r.label, value: r.count }))} unit="applicants" />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}
