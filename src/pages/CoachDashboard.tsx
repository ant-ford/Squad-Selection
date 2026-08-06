import { useOutletContext } from 'react-router-dom';
import { usePlayUpWatch } from '@/lib/queries';
import { playUpWatchLabel } from '@/lib/readiness';
import FixtureList from './FixtureList';
import { Skeleton } from '@/components/ui/skeleton';
import { Zap } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';

/**
 * Coach Command Centre — deliberately minimal.
 *
 * Philosophy: exception management, not prescription. The dashboard surfaces
 * only what needs attention (play-up compliance) and the fixture list;
 * positional decisions stay with the coach inside Squad Selection, where the
 * recommendation engine already lives.
 */
export default function CoachDashboard() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const { data, isLoading } = usePlayUpWatch();
  const watch = data?.watch ?? [];

  return (
    <div className="pb-8">
      {/* ── Welcome header ── */}
      <div className="container mx-auto px-4 pt-4 pb-2">
        <h1 className="text-xl font-semibold text-foreground">Coach Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back, {profile?.preferredName}.
        </p>
      </div>

      {/* ── Play-Up Watch — compliance-only, hides itself when empty ── */}
      {isLoading ? (
        <div className="container mx-auto px-4 pb-2 space-y-1.5">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : watch.length > 0 ? (
        <section className="container mx-auto px-4 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Play-Up Watch
            </h2>
          </div>
          <div className="space-y-1.5">
            {watch.map((w) => {
              const info = playUpWatchLabel(w.playUpCount);
              const critical = info.severity === 'critical';
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-2 p-2.5 border border-border rounded-lg bg-card text-sm"
                >
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-medium text-foreground">{w.name}</span>{' '}
                    <span className="text-muted-foreground">({w.registeredTeam})</span>
                  </span>
                  <span
                    className={`text-xs font-medium shrink-0 ${
                      critical ? 'text-red-700' : 'text-amber-700'
                    }`}
                  >
                    {w.playUpCount} play-ups — {info.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Fixtures with team tabs (shared query, no duplicate fetch) ── */}
      <FixtureList />
    </div>
  );
}