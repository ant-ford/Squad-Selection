import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, PackageOpen, Search } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Skeleton } from '@/components/ui/skeleton';
import HandOutSheet from '@/components/kit/HandOutSheet';
import SetSheet from '@/components/kit/SetSheet';
import NeedsKit from '@/components/kit/NeedsKit';
import KitInsights from '@/components/kit/KitInsights';
import { PlaceBadge, inputClass, primaryButton, secondaryButton, sizesLine } from '@/components/kit/kitUi';
import { ApiError } from '@/lib/apiClient';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import { getKitBoard, setOrderExpected, setOrderReceived } from '@/api/kit';
import { hkDateKey } from '@shared/hkDateKey';
import { suggestSwaps, type KitSet } from '@shared/kit';

const FILTERS: { key: string; label: string; test: (s: KitSet) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'in_store', label: 'In store', test: (s) => s.place === 'in_store' && !!s.owner },
  { key: 'with_holder', label: 'With someone', test: (s) => s.place === 'with_holder' },
  { key: 'with_owner', label: 'Handed out', test: (s) => s.place === 'with_owner' },
  { key: 'spare', label: 'Spares', test: (s) => !s.owner },
  { key: 'sizes', label: 'Size issues', test: (s) => s.mismatches.length > 0 },
];

/**
 * The kit screens (Kit Convenor, Section Captains): every set in an order,
 * in box order (by number), where each one is, handing kit out, and who
 * still needs kit. Refreshes itself, since several people hand out at once.
 */
export default function Kit() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('kit') ?? false;
  const [params, setParams] = useSearchParams();
  const orderId = params.get('order');
  const view = (['needs', 'insights'] as const).find((v) => v === params.get('view')) ?? 'sets';
  const filter = FILTERS.find((f) => f.key === params.get('show')) ?? FILTERS[0];
  const team = params.get('team') ?? '';
  const q = params.get('q') ?? '';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const { data: board, isLoading, error, refetch } = useQuery({
    queryKey: ['kitBoard', orderId],
    queryFn: () => getKitBoard(orderId),
    enabled: allowed,
    refetchInterval: 20_000,
  });
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: ['kitBoard'] });
    void queryClient.invalidateQueries({ queryKey: ['kitHistory'] });
    void queryClient.invalidateQueries({ queryKey: ['myKit'] });
  };

  const [handingOut, setHandingOut] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmArrived, setConfirmArrived] = useState(false);
  const arrived = useMutation({
    mutationFn: (on: string | null) => setOrderReceived(board!.order!.id, on),
    onSuccess: changed,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Not saved. Try again.'),
  });
  // Players whose kit is on order see this date on their page.
  const expected = useMutation({
    mutationFn: (on: string | null) => setOrderExpected(board!.order!.id, on),
    onSuccess: (_r, on) => {
      toast.success(on ? `Players will see delivery expected ${safeFormat(on, 'do MMMM')}` : 'Expected date cleared');
      changed();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Not saved. Try again.'),
  });

  const sets = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (board?.sets ?? []).filter(
      (s) =>
        filter.test(s) &&
        (!team || s.owner?.team === team || (!s.owner && s.teamRange === team)) &&
        (!t || String(s.shirtNo) === t || (s.owner?.name ?? '').toLowerCase().includes(t) || (s.holder?.name ?? '').toLowerCase().includes(t)),
    );
  }, [board, filter, team, q]);
  const count = (key: string) => (board?.sets ?? []).filter(FILTERS.find((f) => f.key === key)!.test).length;
  const open = board?.sets.find((s) => s.id === openId) ?? null;
  const order = board?.order ?? null;

  const body = () => {
    if (profileLoading || (allowed && isLoading)) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      );
    }
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">The kit screens are for the Kit Convenor and the Section Captains.</p>;
    if (error || !board) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{error instanceof ApiError && error.status < 500 ? error.message : 'Could not load the kit.'}</p>
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    if (!order) return <p className="text-center py-12 text-muted-foreground">No kit order has been loaded yet.</p>;

    return (
      <>
        <section className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[12rem]">
            {board.orders.length > 1 ? (
              <select className={inputClass} value={order.id} onChange={(e) => setParam('order', e.target.value)} aria-label="Order">
                {board.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-semibold text-foreground">{order.name}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {order.orderedOn ? `Ordered ${safeFormat(order.orderedOn, LONG_DATE)} · ` : ''}
              {order.receivedOn ? `Arrived ${safeFormat(order.receivedOn, LONG_DATE)}` : 'Not arrived yet'}
            </p>
            {!order.receivedOn && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                Expected delivery
                <input
                  // Keyed on the saved date so a refresh shows what was saved.
                  key={order.expectedOn ?? ''}
                  type="date"
                  className={inputClass.replace('w-full', 'w-40')}
                  defaultValue={order.expectedOn ?? ''}
                  disabled={expected.isPending}
                  onBlur={(e) => {
                    const on = e.target.value || null;
                    if (on !== order.expectedOn) expected.mutate(on);
                  }}
                />
              </label>
            )}
          </div>
          {!order.receivedOn && (
            <button className={secondaryButton} disabled={arrived.isPending} onClick={() => setConfirmArrived(true)}>
              <PackageOpen className="h-4 w-4" /> The kit has arrived
            </button>
          )}
          {order.receivedOn && (
            <button className={primaryButton} onClick={() => setHandingOut(true)}>
              Hand out kit
            </button>
          )}
        </section>

        <div className="flex gap-1 border-b border-border">
          {(['sets', 'needs', 'insights'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setParam('view', v === 'sets' ? null : v)}
              className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${view === v ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}
            >
              {v === 'sets'
                ? `Sets (${board.sets.length})`
                : v === 'needs'
                ? `Needs kit (${board.people.filter((p) => p.active && !p.hasSet).length})`
                : 'Insights'}
            </button>
          ))}
        </div>

        {view === 'insights' ? (
          <KitInsights
            board={board}
            onOpenSet={setOpenId}
            onShowSets={(show) => {
              // One update: two setParam calls would each start from the same old params.
              const next = new URLSearchParams(params);
              next.delete('view');
              if (show === 'all') next.delete('show');
              else next.set('show', show);
              setParams(next, { replace: true });
            }}
          />
        ) : view === 'needs' ? (
          <NeedsKit board={board} onChanged={changed} />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setParam('show', f.key === 'all' ? null : f.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${filter.key === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
                >
                  {f.label} {count(f.key)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <input className={`${inputClass} pl-8`} value={q} onChange={(e) => setParam('q', e.target.value || null)} placeholder="Name or number" aria-label="Search" />
              </div>
              <select className={`${inputClass.replace('w-full', 'w-36 shrink-0')}`} value={team} onChange={(e) => setParam('team', e.target.value || null)} aria-label="Team">
                <option value="">All teams</option>
                {board.teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <ul className="rounded-xl border border-border bg-card divide-y divide-border">
              {sets.map((s) => (
                <li key={s.id}>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50" onClick={() => setOpenId(s.id)}>
                    <span className="w-9 text-right font-mono text-sm font-semibold">{s.shirtNo}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">
                        {s.owner ? s.owner.name : <em className="text-muted-foreground">Spare</em>}
                        {s.owner?.team && <span className="text-xs text-muted-foreground"> {s.owner.team}</span>}
                        {s.owner && s.owner.status !== 'Member' && <span className="text-xs text-muted-foreground"> · {s.owner.status}</span>}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">{sizesLine(s.sizes)}</span>
                      {s.mismatches.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-amber-700 truncate">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {s.mismatches.join('; ')}
                        </span>
                      )}
                      {s.mismatches.length > 0 && suggestSwaps(s, board.sets).length > 0 && (
                        <span className="block text-xs text-primary">Swap available</span>
                      )}
                    </span>
                    <PlaceBadge set={s} />
                  </button>
                </li>
              ))}
              {sets.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No sets match.</li>}
            </ul>
          </>
        )}

        {handingOut && <HandOutSheet board={board} onClose={() => setHandingOut(false)} onDone={changed} />}
        {open && <SetSheet key={open.id} set={open} board={board} onClose={() => setOpenId(null)} onChanged={changed} />}
        {confirmArrived && (
          <ConfirmDialog
            title="Has the kit arrived?"
            message={`Every set in ${order.name} goes into the kit store today, ready to hand out. Players see their kit is ready to collect.`}
            confirmLabel="Yes, it's here"
            onCancel={() => setConfirmArrived(false)}
            onConfirm={() => {
              arrived.mutate(hkDateKey(new Date().toISOString()));
              setConfirmArrived(false);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Kit" guide="kit" />
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
