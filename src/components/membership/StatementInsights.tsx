import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatementBoard } from '@/lib/queries';
import { hkDateKey } from '@shared/hkDateKey';
import { seasonLabel, seasonStartYear } from '@shared/membershipInsights';
import { shortReviewStage } from '@shared/statementStages';
import { emailsAhead, outcomesThisSeason, reviewSponsorLoad, reviewWaits, stepTimes } from '@shared/statementInsights';
import { ChartCard, DataTable, HBars, MonthColumns, StatTile, monthLabel } from './charts';

const days = (n: number | null) => (n === null ? '–' : `${n}d`);
const bars = (rows: { label: string; count: number }[]) => rows.map((r) => ({ label: r.label, value: r.count }));

/**
 * Commitment reviews, the second group on Insights (its heading bar is
 * InsightsGroup's). Counted from the Statements
 * board's data (the same cached request as that tab), so the period picker
 * above does not apply: this is now, the months ahead, and this season.
 */
export default function StatementInsights() {
  const { data, isLoading, isError, refetch } = useStatementBoard();
  const today = hkDateKey(new Date().toISOString());

  const view = useMemo(() => {
    if (!data) return null;
    const facts = data.cards;
    const waits = reviewWaits(facts);
    return {
      ahead: emailsAhead(facts, today),
      waits,
      over30: waits.reduce((n, w) => n + w.over30, 0),
      steps: stepTimes(facts),
      sponsors: reviewSponsorLoad(facts),
      outcomes: outcomesThisSeason(facts, today),
    };
  }, [data, today]);

  return (
    <div className="space-y-3">

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : isError || !view ? (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">Could not load the commitment reviews.</p>
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatTile label="Emails due now" value={view.ahead.dueNow} hint="Window open or period ended" />
            <StatTile label="Emails in 6 months" value={view.ahead.total} hint="Automatic, by month below" />
            <StatTile label="Waiting over 30 days" value={view.over30} hint="On a member, sponsor or officer" />
            <StatTile
              label="Completed this season"
              value={view.outcomes.completed}
              hint={seasonLabel(seasonStartYear(today))}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard
              title="Review emails coming up"
              caption={`Automatic emails by month (60 days before Period End).${
                view.ahead.dueNow > 0 ? ` ${view.ahead.dueNow} more ${view.ahead.dueNow === 1 ? 'is' : 'are'} due now.` : ''
              } Notify now on the Statements tab can spread a busy month.`}
              table={
                <DataTable
                  head={['Month', 'Emails']}
                  rows={view.ahead.byMonth.map((m) => [monthLabel(m.month), m.count])}
                />
              }
            >
              <MonthColumns rows={view.ahead.byMonth} unit="emails" />
            </ChartCard>

            <ChartCard title="Where reviews are waiting" caption="Reviews waiting on a person now, by days in their stage.">
              <DataTable
                head={['Stage', 'Waiting', 'Median', 'Over 30d', 'Longest']}
                rows={view.waits.map((w) => [
                  shortReviewStage(w.stage),
                  w.count,
                  days(w.medianDays),
                  w.over30,
                  w.longest ? `${w.longest.name} (${w.longest.days}d)` : '–',
                ])}
              />
            </ChartCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard
              title="How long each step takes"
              caption="Median days for finished steps, from the submission dates. The member's own step is not timed: the base does not record when the review email went."
            >
              <DataTable
                head={['Step', 'Median', 'Reviews']}
                rows={view.steps.map((s) => [s.step, days(s.medianDays), s.reviews])}
              />
            </ChartCard>

            <ChartCard title="Sponsors" caption="Reviews waiting on each sponsor's section now.">
              {view.sponsors.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No reviews are waiting on a sponsor.</p>
              ) : (
                <DataTable
                  head={['Sponsor', 'Waiting on them']}
                  rows={view.sponsors.slice(0, 10).map((s) => [s.sponsor, s.waiting])}
                />
              )}
            </ChartCard>
          </div>

          <h3 className="text-xs font-semibold text-muted-foreground pt-1">
            Completed this season ({view.outcomes.completed})
          </h3>
          {view.outcomes.completed === 0 ? (
            <p className="text-xs text-muted-foreground">No reviews completed yet this season.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard title="Recommended commitment reduction">
                <HBars rows={bars(view.outcomes.reductions)} unit="reviews" />
              </ChartCard>
              <ChartCard title="Matches played" caption="As a share of the team's matches.">
                <HBars rows={bars(view.outcomes.participation)} unit="reviews" />
              </ChartCard>
              <ChartCard title="Practices">
                <HBars rows={bars(view.outcomes.practices)} unit="reviews" />
              </ChartCard>
              <ChartCard title="Games umpired">
                <HBars rows={bars(view.outcomes.umpired)} unit="reviews" />
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
