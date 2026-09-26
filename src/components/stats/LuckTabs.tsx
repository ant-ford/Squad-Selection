import { useMemo } from 'react';
import { ChartCard, DataTable, HBars, StatTile, TeamKey, teamColour } from '@/components/membership/charts';
import { games, winPct, type SeasonSummary, type WDL } from '@shared/clubStats';
import { CHARM_MIN_WITH, CHARM_MIN_WITHOUT, cardsPerGame, luckyCharms, umpireRows, umpireSplits } from '@shared/luck';

const wdl = (r: WDL) => `${r.w}-${r.d}-${r.l}`;
const pct = (r: WDL) => {
  const p = winPct(r);
  return p === null ? '–' : `${p}%`;
};
const gamesText = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

/**
 * Umpires: HKFC's results by who umpired, and with each umpire. A season
 * has few games per umpire, so the per-umpire lists ask for fewer games in
 * one season than over all time.
 */
export function UmpiresTab({ summaries, allTime }: { summaries: SeasonSummary[]; allTime: boolean }) {
  const rows = useMemo(() => umpireRows(summaries), [summaries]);
  const splits = useMemo(() => umpireSplits(summaries), [summaries]);
  const minGames = allTime ? 8 : 3;

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No umpires recorded for this period.</p>;
  }

  const byWho = [
    { label: 'Appointed', r: splits.appointed },
    { label: 'Team umpires', r: splits.duty },
    { label: 'Not recorded', r: splits.unknown },
  ].filter((x) => games(x.r) > 0);
  const record = rows
    .filter((r) => games(r.hkfc) >= minGames)
    .sort((a, b) => (winPct(b.hkfc) ?? 0) - (winPct(a.hkfc) ?? 0) || games(b.hkfc) - games(a.hkfc));
  const carded = rows
    .map((r) => ({ r, perGame: cardsPerGame(r, minGames) }))
    .filter((x): x is { r: (typeof rows)[number]; perGame: number } => x.perGame !== null)
    .sort((a, b) => b.perGame - a.perGame || b.r.cardGames - a.r.cardGames);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Umpires" value={rows.length} hint="In HKFC games" />
        <StatTile label="With appointed" value={pct(splits.appointed)} hint={`W-D-L ${wdl(splits.appointed)}`} />
        <StatTile label="With team umpires" value={pct(splits.duty)} hint={`W-D-L ${wdl(splits.duty)}`} />
        <StatTile label="Most games" value={rows[0].games} hint={rows[0].name} />
      </div>

      <ChartCard title="Appointed or team umpires" caption="HKFC's win rate against other clubs.">
        <HBars
          rows={byWho.map((x) => ({ label: x.label, value: winPct(x.r) ?? 0, note: `${wdl(x.r)} · ${gamesText(games(x.r))}` }))}
          unit="won"
          max={100}
          suffix="%"
          narrowLabels
        />
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Most HKFC games"
          table={
            <DataTable
              head={['Umpire', 'Games', 'Appointed', 'Team', 'W-D-L', 'Win', 'Cards / game']}
              rows={rows.map((r) => [r.name, r.games, r.appointed, r.duty, wdl(r.hkfc), pct(r.hkfc), cardsPerGame(r)?.toFixed(2) ?? '–'])}
            />
          }
        >
          <HBars
            rows={rows.slice(0, 10).map((r) => ({
              label: r.name,
              value: r.games,
              note: [r.appointed && `${r.appointed} appointed`, r.duty && `${r.duty} team`].filter(Boolean).join(' · ') || undefined,
            }))}
            unit="games"
          />
        </ChartCard>

        <ChartCard title="Our record with each umpire" caption={`${minGames}+ games.`}>
          {record.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No umpire has {minGames} games yet.</p>
          ) : (
            <HBars
              rows={record.slice(0, 10).map((r) => ({ label: r.name, value: winPct(r.hkfc) ?? 0, note: `${wdl(r.hkfc)}` }))}
              unit="won"
              max={100}
              suffix="%"
            />
          )}
        </ChartCard>
      </div>

      {carded.length > 0 && (
        <ChartCard title="Most cards per game" caption={`Cards to HKFC players, ${minGames}+ games.`}>
          <HBars
            rows={carded.slice(0, 10).map(({ r, perGame }) => ({ label: r.name, value: perGame, note: gamesText(r.cardGames) }))}
            unit="cards per game"
          />
        </ChartCard>
      )}
    </div>
  );
}

/**
 * Lucky charms: how much more often a team wins when the player plays.
 * Only the positive side is shown - a "wins more without them" list would
 * single players out, which is not what this is for.
 */
export function CharmsTab({ summaries }: { summaries: SeasonSummary[] }) {
  const charms = useMemo(() => luckyCharms(summaries), [summaries]);
  const lucky = charms.filter((c) => c.lift > 0);
  const caption = `Team win rate with them vs without (${CHARM_MIN_WITH}+ games with, ${CHARM_MIN_WITHOUT}+ without).`;
  // A player can be a charm for two teams: then the team goes in their label, keeping labels unique.
  const top = lucky.slice(0, 15).map((c, _i, list) => ({
    c,
    label: list.filter((x) => x.key === c.key).length > 1 ? `${c.name} (${c.team.replace(/^HKFC /, '')})` : c.name,
  }));

  if (lucky.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No lucky charms yet: it takes {CHARM_MIN_WITH}+ games for a team with the player and {CHARM_MIN_WITHOUT}+ without. Try All time.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ChartCard
        title="Lucky charms"
        caption={caption}
        table={
          <DataTable
            head={['Player', 'Team', 'With', 'Win', 'Without', 'Win', 'Lift']}
            rows={lucky.map((c) => [c.name, c.team, wdl(c.with), `${c.withPct}%`, wdl(c.without), `${c.withoutPct}%`, `+${c.lift}`])}
          />
        }
      >
        <TeamKey teams={[...new Set(top.map(({ c }) => c.team))].sort()} />
        <HBars
          rows={top.map(({ c, label }) => ({
            label,
            value: c.lift,
            note: `${c.withPct}% vs ${c.withoutPct}%`,
          }))}
          unit="points"
          suffix=" pts"
          colourOf={(label) => teamColour(top.find((x) => x.label === label)?.c.team ?? '')}
        />
      </ChartCard>
    </div>
  );
}
