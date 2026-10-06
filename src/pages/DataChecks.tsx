import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import LinkCardSheet from '@/components/admin/LinkCardSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { StatusChip } from '@/components/ui/status-chip';
import { ErrorState } from '@/components/ui/error-state';
import { inputClass } from '@/components/ui/input';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import {
  DUPLICATE_LABELS,
  FIXING_LABELS,
  MISSING_LABELS,
  checkRefusal,
  fixingValue,
  moveTargets,
  visibleTabs,
  type CheckTab,
} from '@/lib/dataChecks';
import { getDataChecks, resolveReRegistration, type DataCheckPerson, type ReRegistration, type ResolveAction, type UnlinkedCard } from '@/api/dataChecks';

const KEY = ['dataChecks'] as const;
const listClass = 'rounded-xl border border-border bg-card divide-y divide-border';

function PersonLink({ p }: { p: DataCheckPerson }) {
  return (
    <Link to={`/people/${encodeURIComponent(p.id)}`} className="text-sm font-medium text-foreground hover:underline">
      {p.name}
    </Link>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li className="px-3 py-2 space-y-1">{children}</li>;
}

const sub = (parts: (string | null | false | undefined)[]) => (
  <span className="block text-xs text-muted-foreground">{parts.filter(Boolean).join(' · ')}</span>
);

function ReRegistrationRow({ r, onResolve }: { r: ReRegistration; onResolve: (r: ReRegistration, change: ResolveAction) => void }) {
  const targets = moveTargets(r);
  const [team, setTeam] = useState(targets[0] ?? '');
  return (
    <Row>
      <span className="flex flex-wrap items-center gap-1.5">
        <PersonLink p={r.person} />
        <StatusChip tone="info">{`${r.playUps.length} play-up${r.playUps.length === 1 ? '' : 's'}`}</StatusChip>
      </span>
      {sub([`On ${r.previousTeam}`, r.season, r.detail])}
      <div className="flex flex-wrap gap-2 pt-1">
        {targets.length > 1 && (
          <select className={`${inputClass} w-auto`} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Move up to">
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        {team && <ActionButton onClick={() => onResolve(r, { action: 'move', team })}>{`Move up to ${team}`}</ActionButton>}
        <ActionButton variant="outline" onClick={() => onResolve(r, { action: 'keep' })}>
          Keep
        </ActionButton>
      </div>
    </Row>
  );
}

/** Records to put right (the `dataChecks` section). Empty tabs are hidden. */
export default function DataChecks() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('dataChecks') ?? false;
  const [tab, setTab] = useState<CheckTab | null>(null);
  const [linking, setLinking] = useState<UnlinkedCard | null>(null);
  const [resolving, setResolving] = useState<{ r: ReRegistration; change: ResolveAction } | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: KEY, queryFn: getDataChecks, enabled: allowed, staleTime: 30_000 });
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    void queryClient.invalidateQueries({ queryKey: ['personHistory'] });
  };

  const resolve = useMutation({
    mutationFn: (v: { r: ReRegistration; change: ResolveAction }) => resolveReRegistration(v.r.id, v.change),
    onSuccess: (res, v) => {
      toast.success(v.change.action === 'move' ? `Moved up to ${res.team}` : 'Kept on their team');
      changed();
    },
    onError: (err) => {
      toast.error(checkRefusal(err));
      changed();
    },
  });

  const body = () => {
    if (profileLoading || (allowed && isLoading)) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for the Men's Convenor and Section Captains.</p>;
    if (error || !data) return <ErrorState message="The checks didn't load." onRetry={() => void refetch()} retrying={isFetching} />;

    const tabs = visibleTabs(data);
    if (tabs.length === 0) return <p className="text-center py-12 text-sm text-muted-foreground">Nothing to fix.</p>;
    const shown = tab && tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

    return (
      <>
        <Tabs id="checks" label="Data checks" items={tabs} value={shown} onChange={setTab} />
        <TabPanel tabsId="checks" value={shown}>
          <ul className={listClass}>
            {shown === 'cards' &&
              data.unlinkedCards.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground">{c.rawName}</span>
                    {sub([c.team, safeFormat(c.matchDate, 'd MMM yyyy', ''), c.opponent && `v ${c.opponent}`])}
                    {c.suggestions.length > 0 && sub([`Maybe ${c.suggestions.map((s) => s.name).join(', ')}`])}
                  </span>
                  <ActionButton variant="outline" onClick={() => setLinking(c)}>
                    Link
                  </ActionButton>
                </li>
              ))}
            {shown === 'names' &&
              data.sharedRegisteredNames.map((n) => (
                <Row key={n.registeredName}>
                  <span className="block text-sm font-medium text-foreground">{n.registeredName}</span>
                  <span className="flex flex-wrap gap-x-3">
                    {n.people.map((p) => (
                      <PersonLink key={p.id} p={p} />
                    ))}
                  </span>
                </Row>
              ))}
            {shown === 'reregistrations' &&
              data.reRegistrations.map((r) => <ReRegistrationRow key={r.id} r={r} onResolve={(rr, change) => setResolving({ r: rr, change })} />)}
            {shown === 'incomplete' &&
              data.incomplete.map((i) => (
                <Row key={i.person.id}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PersonLink p={i.person} />
                    {i.missing.map((m) => (
                      <StatusChip key={m} tone="warning">
                        {MISSING_LABELS[m]}
                      </StatusChip>
                    ))}
                  </span>
                  {i.person.team && sub([i.person.team])}
                </Row>
              ))}
            {shown === 'duplicates' &&
              data.duplicates.map((g, i) => (
                <Row key={`${g.match}-${i}`}>
                  <StatusChip tone="neutral">{DUPLICATE_LABELS[g.match]}</StatusChip>
                  <span className="flex flex-wrap gap-x-3">
                    {g.people.map((p) => (
                      <PersonLink key={p.id} p={p} />
                    ))}
                  </span>
                </Row>
              ))}
            {shown === 'fixing' &&
              data.needsFixing.map((f, i) => (
                <Row key={`${f.kind}-${f.person?.id ?? f.commitmentId ?? i}`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {f.person ? <PersonLink p={f.person} /> : <span className="text-sm text-muted-foreground">No person</span>}
                    <StatusChip tone="warning">{FIXING_LABELS[f.kind]}</StatusChip>
                  </span>
                  {sub([fixingValue(f.value)])}
                </Row>
              ))}
          </ul>
        </TabPanel>
        {linking && (
          <LinkCardSheet
            card={linking}
            onClose={() => setLinking(null)}
            onSaved={() => {
              setLinking(null);
              changed();
            }}
          />
        )}
        {resolving && (
          <ConfirmDialog
            title={
              resolving.change.action === 'move'
                ? `Move ${resolving.r.person.name} up to ${resolving.change.team}?`
                : `Keep ${resolving.r.person.name} on ${resolving.r.previousTeam}?`
            }
            message={resolving.change.action === 'move' ? 'Their registered team changes.' : 'Their registered team stays as it is.'}
            confirmLabel={resolving.change.action === 'move' ? 'Move up' : 'Keep'}
            onCancel={() => setResolving(null)}
            onConfirm={() => {
              resolve.mutate(resolving);
              setResolving(null);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Data checks" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
