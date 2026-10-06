import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, User, X } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';

/** Mirrors worker/src/systemHealth.ts SystemView. */
interface SystemView {
  ok: boolean;
  checks: { key: string; label: string; ok: boolean; note?: string }[];
  jobs: { job: string; ran_at: string; ok: boolean; last_ok_at: string | null }[];
  errors: { at: string; source: string; route: string | null; status: number | null; message: string | null; request_id: string | null }[];
  serverErrors24h: number;
  clientErrors24h: number;
}

const when = (iso: string | null) => safeFormat(iso, 'd MMM HH:mm');
const card = 'rounded-xl border border-border bg-card';

/** System health: the owner and the Section Captains (worker/src/systemHealth.ts). */
export default function System() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['system'],
    queryFn: () => apiGet<SystemView>('/api/system'),
    retry: false,
  });

  const body = () => {
    if (isLoading) return <Skeleton className="h-40 w-full" />;
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

        <section className={card}>
          <h2 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Errors · 24h: {data.serverErrors24h} server, {data.clientErrors24h} app
          </h2>
          {data.errors.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.errors.map((e, i) => (
                <li key={`${e.at}-${i}`} className="px-3 py-2 text-xs">
                  <div className="flex gap-2 text-muted-foreground">
                    <span>{when(e.at)}</span>
                    <span>{e.source === 'client' ? 'app' : e.status}</span>
                    <span className="truncate">{e.route}</span>
                  </div>
                  <p className="text-foreground break-words">{e.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="System">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
