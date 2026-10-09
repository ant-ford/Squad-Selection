import type { SystemErrorDays, SystemView } from '@shared/systemHealth';
import { explainSystemError } from '@shared/systemErrorExplanation';
import { safeFormat } from '@/lib/dateUtils';

const when = (iso: string | null) => safeFormat(iso, 'd MMM HH:mm');
const periods = [{ days: 1, label: 'Last 24 hours' }, { days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }] as const;

export default function SystemErrors({ data, days, onDays, updating }: {
  data: SystemView;
  days: SystemErrorDays;
  onDays: (days: SystemErrorDays) => void;
  updating: boolean;
}) {
  const summary = data.errorSummary;
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="px-3 pt-3 pb-2 space-y-2">
        <h2 className="text-sm font-semibold">Errors</h2>
        <p className="text-xs text-muted-foreground">
          Last 24 hours: {data.serverErrors24h} server, {data.clientErrors24h} app
        </p>
        <label className="flex items-center gap-2 text-xs">
          Period
          <select
            className="min-h-10 rounded-md border border-border bg-background px-2 text-foreground"
            value={days}
            onChange={(event) => onDays(Number(event.target.value) as SystemErrorDays)}
          >
            {periods.map((period) => <option key={period.days} value={period.days}>{period.label}</option>)}
          </select>
          {updating && <span role="status" className="text-muted-foreground">Updating…</span>}
        </label>
      </div>
      {summary ? (
        <>
          <p className="px-3 pb-2 text-xs text-muted-foreground" aria-live="polite">
            {periods.find((period) => period.days === summary.days)?.label}: {summary.totalGroups} {summary.totalGroups === 1 ? 'issue' : 'issues'}, {summary.totalOccurrences} {summary.totalOccurrences === 1 ? 'occurrence' : 'occurrences'}.
            {' '}Earlier reports remain history; no issue is marked resolved automatically.
          </p>
          {summary.groups.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">No errors reported in this period.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {summary.groups.map((group) => {
                const info = explainSystemError(group.kind);
                return (
                  <li key={group.key}>
                    <details className="px-3 py-3">
                      <summary className="cursor-pointer min-h-10 text-sm">
                        <span className="font-semibold">{info.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.count} {group.count === 1 ? 'occurrence' : 'occurrences'}</span>
                        <span className="block mt-1 text-xs text-muted-foreground">
                          Latest {when(group.lastSeen)} · {group.recentCount > 0 ? `${group.recentCount} in the last 24 hours` : 'Not seen in the last 24 hours'}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-3 text-xs">
                        <p>{info.explanation}</p>
                        <p className="text-muted-foreground">{info.action}</p>
                        <p>First in this period: {when(group.firstSeen)} · Latest: {when(group.lastSeen)}</p>
                        <div>
                          <p className="font-medium mb-1">Affected screens or routes</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {group.routes.map((route) => <li key={route} className="break-all">{route}</li>)}
                          </ul>
                          {group.routeCount > group.routes.length && <p className="text-muted-foreground">Showing {group.routes.length} of {group.routeCount} routes.</p>}
                        </div>
                        <div>
                          <p className="font-medium mb-1">App builds</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {group.builds.map((build) => (
                              <li key={build.build ?? 'unknown'} className="break-words">
                                {build.build ?? 'Not recorded'} · {build.count} {build.count === 1 ? 'occurrence' : 'occurrences'} · latest {when(build.lastSeen)}
                              </li>
                            ))}
                          </ul>
                          {group.buildCount > group.builds.length && <p className="text-muted-foreground">Showing {group.builds.length} of {group.buildCount} builds.</p>}
                          <p className="mt-1 text-muted-foreground">Compare these with the build containing a fix. Older reports may have no build or browser recorded.</p>
                        </div>
                        <div>
                          <p className="font-medium mb-1">Recent examples ({group.samples.length} of {group.count})</p>
                          <ul className="space-y-3">
                            {group.samples.map((sample, index) => (
                              <li key={`${sample.at}-${index}`} className="rounded-md bg-muted/40 p-2 space-y-1">
                                <p className="text-muted-foreground">{when(sample.at)} · {sample.source === 'client' ? 'app' : sample.status ?? sample.source}</p>
                                <p className="break-all">{sample.route}</p>
                                <p className="break-words">{sample.message}</p>
                                <p className="text-muted-foreground break-words">Build: {sample.build ?? 'not recorded'} · Browser: {sample.browser ?? 'not recorded'}</p>
                                {sample.request_id && <p className="text-muted-foreground break-all">Request: {sample.request_id}</p>}
                                {sample.stack && (
                                  <details>
                                    <summary className="cursor-pointer min-h-10 flex items-center">Technical details</summary>
                                    <pre className="whitespace-pre-wrap break-all text-muted-foreground">{sample.stack}</pre>
                                  </details>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
          {summary.totalGroups > summary.groups.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Showing the {summary.groups.length} most recently seen issues of {summary.totalGroups}. Counts include the whole period.</p>
          )}
        </>
      ) : (
        <div className="px-3 pb-3 text-xs space-y-2">
          <p className="text-muted-foreground">The API has not supplied grouped errors yet. These are its latest reports; period filtering is unavailable.</p>
          {data.errors.length === 0 ? <p>None.</p> : data.errors.map((error, index) => (
            <p key={`${error.at}-${index}`} className="break-words">{when(error.at)} · {error.route}<br />{error.message}</p>
          ))}
        </div>
      )}
    </section>
  );
}
