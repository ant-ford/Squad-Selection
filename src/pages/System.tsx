import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import SystemErrors from '@/components/SystemErrors';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import type { SystemErrorDays, SystemView } from '@shared/systemHealth';

const when = (iso: string | null) => safeFormat(iso, 'd MMM HH:mm');
const card = 'rounded-xl border border-border bg-card';

/** System health: the owner and the Section Captains (worker/src/systemHealth.ts). */
export default function System() {
  const [days, setDays] = useState<SystemErrorDays>(1);
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.system ?? false;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['system', days],
    queryFn: () => apiGet<SystemView>(`/api/system?days=${days}`),
    placeholderData: keepPreviousData,
    enabled: allowed,
    retry: false,
  });

  const body = () => {
    if (profileLoading || (allowed && isLoading)) return <Skeleton className="h-40 w-full" />;
    if (!allowed) return <p className="text-sm text-muted-foreground">Not available.</p>;
    if (error || !data)
      return <p className="text-sm text-muted-foreground">{error instanceof ApiError && error.status === 403 ? 'Not available.' : "Couldn't load. Try again."}</p>;
    return (
      <>
        <section className={`${card} divide-y divide-border`}>
          {data.checks.map((c) => (
            <div key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm">
              {c.ok ? <Check className="h-4 w-4 text-emerald-600 shrink-0" aria-label="OK" /> : <X className="h-4 w-4 text-destructive shrink-0" aria-label="Failed" />}
              <span className="font-medium text-foreground">{c.label}</span>
              {c.note && <span className="ml-auto text-xs text-muted-foreground">{c.note}</span>}
            </div>
          ))}
        </section>

        <section className={card}>
          <h2 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jobs</h2>
          <table className="w-full text-sm">
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.job} className="border-t border-border first:border-0">
                  <td className="px-3 py-1.5 text-foreground">{j.job}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{when(j.ran_at)}</td>
                  <td className={`px-3 py-1.5 text-right ${j.ok ? 'text-emerald-600' : 'text-destructive'}`}>{j.ok ? 'ok' : 'failed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <SystemErrors data={data} days={days} onDays={setDays} updating={isFetching} />
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="System" guide="captains" />
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
