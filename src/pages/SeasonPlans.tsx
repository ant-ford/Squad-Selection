import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { getSeasonPlanBoard } from '@/api/seasonPlan';
import {
  AVAILABILITY_HALVES,
  AVAILABILITY_LEVELS,
  shortPreference,
  type SeasonPlanPlayer,
} from '@shared/seasonPlan';

const LEVEL_TONE: Record<string, string> = {
  all: 'bg-emerald-500/15 text-emerald-700',
  most: 'bg-sky-500/15 text-sky-700',
  some: 'bg-amber-500/15 text-amber-700',
  none: 'bg-rose-500/15 text-rose-700',
};
const badge = 'text-[11px] font-medium px-2 py-0.5 rounded-full';

const FILTERS: { key: string; label: string; test: (p: SeasonPlanPlayer) => boolean }[] = [
  { key: 'all', label: 'Everyone', test: () => true },
  { key: 'part', label: 'Part of the season', test: (p) => !!p.plan?.availabilityHalf || p.plan?.availabilityLevel === 'some' || p.plan?.availabilityLevel === 'none' },
  { key: 'down', label: 'Next team down', test: (p) => shortPreference(p.plan?.playingPreference ?? null) === 'Next team down' },
  { key: 'missing', label: 'Not answered', test: (p) => !p.plan?.availabilityLevel },
];

function Summary({ players }: { players: SeasonPlanPlayer[] }) {
  const n = (f: (p: SeasonPlanPlayer) => boolean) => players.filter(f).length;
  const parts = [
    ...AVAILABILITY_LEVELS.map((l) => `${n((p) => p.plan?.availabilityLevel === l.key)} ${l.short.toLowerCase()}`),
    `${n((p) => !p.plan?.availabilityLevel)} not answered`,
  ];
  const halves = AVAILABILITY_HALVES.map((h) => `${n((p) => p.plan?.availabilityHalf === h.key)} ${h.short} only`);
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <p>
        <span className="text-foreground font-medium">{players.length} players:</span> {parts.join(' · ')}
      </p>
      <p>
        {halves.join(' · ')} · {n((p) => shortPreference(p.plan?.playingPreference ?? null) === 'Next team down')} prefer the next team down
      </p>
    </div>
  );
}

function PlayerRow({ p }: { p: SeasonPlanPlayer }) {
  const plan = p.plan;
  const level = AVAILABILITY_LEVELS.find((l) => l.key === plan?.availabilityLevel);
  const half = AVAILABILITY_HALVES.find((h) => h.key === plan?.availabilityHalf);
  const pref = shortPreference(plan?.playingPreference ?? null);
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 min-w-0 text-sm text-foreground truncate">
          {p.name}
          {p.playingPosition && <span className="text-xs text-muted-foreground"> {p.playingPosition}</span>}
          {p.status && p.status !== 'Member' && <span className="text-xs text-muted-foreground"> · {p.status}</span>}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {level ? (
          <span className={`${badge} ${LEVEL_TONE[level.key]}`}>{level.label}</span>
        ) : (
          <span className={`${badge} bg-muted text-muted-foreground`}>{plan ? 'How much not given' : 'Not answered'}</span>
        )}
        {half && <span className={`${badge} bg-violet-500/15 text-violet-700`}>{half.short} only</span>}
        {pref === 'Next team down' && <span className={`${badge} bg-muted text-foreground`}>Next team down</span>}
      </div>
    </li>
  );
}

/**
 * Season plans by team, to help allocate players: how much of the season
 * each Active player expects to play and who prefers the next team down.
 * Captaincy interest is collected but not shown here (owner, 2026-10-07).
 * Section Captains see every team, a coach their own.
 */
export default function SeasonPlans() {
  const [params, setParams] = useSearchParams();
  const { data: board, isLoading, error, refetch } = useQuery({ queryKey: ['seasonPlanBoard'], queryFn: getSeasonPlanBoard, staleTime: 60_000 });
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const team = board?.teams.find((t) => t.team === params.get('team')) ?? board?.teams[0] ?? null;
  const filter = FILTERS.find((f) => f.key === params.get('show')) ?? FILTERS[0];
  const shown = useMemo(() => (team ? team.players.filter(filter.test) : []), [team, filter]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Season plans" />
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : error || !board ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">{error instanceof ApiError && error.status < 500 ? error.message : 'Could not load the season plans.'}</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : !team ? (
          <p className="text-center py-12 text-muted-foreground">No Active players yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Season {board.season.replace('-', '–')}. Active players, by the team they're shown in.</p>
            <div className="flex flex-wrap gap-1.5">
              {board.teams.map((t) => (
                <button
                  key={t.team}
                  onClick={() => setParam('team', t.team)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${t.team === team.team ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
                >
                  {t.team} {t.players.length}
                </button>
              ))}
            </div>
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="text-sm font-semibold text-foreground mb-1">{team.team}</h2>
              <Summary players={team.players} />
            </section>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setParam('show', f.key === 'all' ? null : f.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${filter.key === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-foreground'}`}
                >
                  {f.label} {team.players.filter(f.test).length}
                </button>
              ))}
            </div>
            <ul className="rounded-xl border border-border bg-card divide-y divide-border">
              {shown.map((p) => (
                <PlayerRow key={p.id} p={p} />
              ))}
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nobody here.</li>}
            </ul>
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
