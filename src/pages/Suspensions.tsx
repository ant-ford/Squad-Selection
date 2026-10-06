import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import SuspensionSheet from '@/components/admin/SuspensionSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { StatusChip } from '@/components/ui/status-chip';
import { ErrorState } from '@/components/ui/error-state';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/tabs';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import { saveRefusal } from '@/lib/peopleAdmin';
import { closedHow, leftLabel, queueLabel, queuePositions } from '@/lib/suspensions';
import { hkDateKey } from '@shared/hkDateKey';
import { getPersonAdmin } from '@/api/adminPeople';
import { clearSuspension, getSuspensions, type SuspensionRow } from '@/api/suspensions';

type Tab = 'open' | 'cleared' | 'cards' | 'legacy';
const KEY = ['suspensions'] as const;

const day = (d: string | null) => safeFormat(d, 'd MMM', '');
const personLink = (id: string, name: string) => (
  <Link to={`/people/${encodeURIComponent(id)}`} className="text-sm font-medium text-foreground hover:underline">
    {name}
  </Link>
);
const listClass = 'rounded-xl border border-border bg-card divide-y divide-border';
const empty = (text: string) => <p className="text-center py-8 text-sm text-muted-foreground">{text}</p>;

/** The Men's Convenor's suspensions (the `discipline` section). */
export default function Suspensions() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('discipline') ?? false;
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('open');
  const [sheet, setSheet] = useState<{ row?: SuspensionRow; person?: { id: string; name: string } | null } | null>(null);
  const [clearing, setClearing] = useState<SuspensionRow | null>(null);
  const today = hkDateKey(new Date().toISOString());

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: KEY,
    queryFn: getSuspensions,
    enabled: allowed,
    staleTime: 30_000,
  });

  // From the person page: /suspensions?person=<id> opens Add for them.
  const fromPerson = params.get('person');
  const { data: preset } = useQuery({
    queryKey: ['personAdmin', fromPerson],
    queryFn: () => getPersonAdmin(fromPerson!),
    enabled: allowed && !!fromPerson,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!preset || !fromPerson) return;
    setSheet({ person: { id: preset.id, name: preset.name } });
    const next = new URLSearchParams(params);
    next.delete('person');
    setParams(next, { replace: true });
  }, [preset, fromPerson, params, setParams]);

  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    void queryClient.invalidateQueries({ queryKey: ['personHistory'] });
  };
  const clear = useMutation({
    mutationFn: (id: string) => clearSuspension(id),
    onSuccess: () => {
      toast.success('Cleared');
      changed();
    },
    onError: (err) => toast.error(saveRefusal(err).message),
  });

  const body = () => {
    if (profileLoading || (allowed && isLoading)) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for the Men's Convenor.</p>;
    if (error || !data) return <ErrorState message="The suspensions didn't load." onRetry={() => void refetch()} retrying={isFetching} />;

    const queue = queuePositions(data.open);
    const tabs: TabItem<Tab>[] = [
      { value: 'open', label: `Open (${data.open.length})` },
      { value: 'cleared', label: `Cleared (${data.cleared.length})` },
      { value: 'cards', label: `Cards (${data.cards.length})` },
      ...(data.legacy.length > 0 ? [{ value: 'legacy' as const, label: `Old flags (${data.legacy.length})` }] : []),
    ];
    const shown = tabs.some((t) => t.value === tab) ? tab : 'open';

    return (
      <>
        <div className="flex items-end gap-2">
          <Tabs id="susp" label="Suspensions" items={tabs} value={shown} onChange={setTab} className="flex-1 min-w-0" />
          <ActionButton icon={<Plus />} onClick={() => setSheet({})}>
            Add
          </ActionButton>
        </div>
        <TabPanel tabsId="susp" value={shown}>
          {shown === 'open' &&
            (data.open.length === 0 ? (
              empty('Nobody is suspended.')
            ) : (
              <ul className={listClass}>
                {data.open.map((s) => {
                  const left = leftLabel(s);
                  const q = queueLabel(queue.get(s.id));
                  return (
                    <li key={s.id} className="flex items-start gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSheet({ row: s })}
                        className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Edit ${s.name}'s suspension`}
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{s.name}</span>
                          <StatusChip tone={left.tone}>{left.label}</StatusChip>
                          {q && <StatusChip tone="neutral">{q}</StatusChip>}
                        </span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {s.servingTeam} · from {day(s.fromDate)}
                        </span>
                        <span className="block text-xs text-muted-foreground line-clamp-2">{s.reason}</span>
                      </button>
                      <ActionButton variant="outline" onClick={() => setClearing(s)}>
                        Clear
                      </ActionButton>
                    </li>
                  );
                })}
              </ul>
            ))}
          {shown === 'cleared' &&
            (data.cleared.length === 0 ? (
              empty('None in the last 90 days.')
            ) : (
              <ul className={listClass}>
                {data.cleared.map((s) => {
                  const how = closedHow(s);
                  return (
                    <li key={s.id} className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {personLink(s.player, s.name)}
                        <StatusChip tone={how.label === 'Served' ? 'success' : 'neutral'}>
                          {how.label} {day(how.date)}
                        </StatusChip>
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {s.matches == null ? 'Until cleared' : `${s.matches} match${s.matches === 1 ? '' : 'es'}`} · {s.servingTeam} · from{' '}
                        {day(s.fromDate)}
                      </span>
                      <span className="block text-xs text-muted-foreground line-clamp-2">{s.reason}</span>
                    </li>
                  );
                })}
              </ul>
            ))}
          {shown === 'cards' &&
            (data.cards.length === 0 ? (
              empty('No card suspensions.')
            ) : (
              <ul className={listClass}>
                {data.cards.map((c) => (
                  <li key={c.player} className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {personLink(c.player, c.name)}
                      <StatusChip tone="warning">{`${c.remainingMatches} left`}</StatusChip>
                      {c.dcReferral && <StatusChip tone="danger">DC referral</StatusChip>}
                      {c.indeterminate && <StatusChip tone="neutral">Can't count</StatusChip>}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {c.servingTeam ?? 'No registered team'} · {c.points} points
                    </span>
                  </li>
                ))}
              </ul>
            ))}
          {shown === 'legacy' && (
            <ul className={listClass}>
              {data.legacy.map((l) => (
                <li key={l.player} className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {personLink(l.player, l.name)}
                    <StatusChip tone="warning">{l.matchesToServe ? `${l.matchesToServe} to serve` : 'Suspended'}</StatusChip>
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{l.team ?? 'No registered team'}</span>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
        {sheet && (
          <SuspensionSheet
            row={sheet.row}
            person={sheet.person}
            today={today}
            onClose={() => setSheet(null)}
            onSaved={() => {
              setSheet(null);
              changed();
            }}
          />
        )}
        {clearing && (
          <ConfirmDialog
            title={`Clear ${clearing.name}'s suspension?`}
            message={`${leftLabel(clearing).label} · ${clearing.reason}`}
            confirmLabel="Clear"
            onCancel={() => setClearing(null)}
            onConfirm={() => {
              clear.mutate(clearing.id);
              setClearing(null);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Suspensions" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
