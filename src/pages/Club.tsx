import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { ArrowRightLeft, Plus } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import OfficeSheet from '@/components/admin/OfficeSheet';
import TeamCard from '@/components/admin/TeamCard';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { ErrorState } from '@/components/ui/error-state';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useMyProfile } from '@/lib/queries';
import { canReactivate, clubRefusal, groupOffices, handoverFrom, type OfficeGroup } from '@/lib/club';
import { listOffices, listTeams, setOfficeStatus, type OfficeView } from '@/api/club';

type Tab = 'offices' | 'teams';
const TABS = [
  { value: 'offices' as const, label: 'Offices' },
  { value: 'teams' as const, label: 'Teams' },
];
const OFFICES = ['adminOffices'] as const;
const TEAMS = ['adminTeams'] as const;
const listClass = 'rounded-xl border border-border bg-card divide-y divide-border';

function OfficeCard({
  group,
  onAdd,
  onStatus,
}: {
  group: OfficeGroup;
  onAdd: () => void;
  onStatus: (row: OfficeView, status: 'Active' | 'Retired') => void;
}) {
  const [showRetired, setShowRetired] = useState(false);
  const from = handoverFrom(group);
  const reactivate = canReactivate(group);
  const name = (o: OfficeView) =>
    o.holder ? (
      <Link to={`/people/${encodeURIComponent(o.holder.id)}`} className="text-sm text-foreground hover:underline">
        {o.holder.name}
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">No one</span>
    );
  return (
    <section className="rounded-xl border border-border bg-card" aria-label={group.label}>
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold text-foreground">{group.label}</h2>
        <ActionButton variant="ghost" icon={from ? <ArrowRightLeft /> : <Plus />} onClick={onAdd}>
          {from ? 'Hand over' : 'Add'}
        </ActionButton>
      </div>
      {group.active.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {group.active.map((o) => (
            <li key={o.id} className="flex items-center gap-2 px-3 py-1">
              <span className="flex-1 min-w-0">
                {name(o)}
                {o.designation && <span className="block text-xs text-muted-foreground">{o.designation}</span>}
              </span>
              <ActionButton variant="ghost" onClick={() => onStatus(o, 'Retired')}>
                Retire
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {group.retired.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setShowRetired((v) => !v)}
            aria-expanded={showRetired}
            className="w-full min-h-10 px-3 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Retired ({group.retired.length})
          </button>
          {showRetired && (
            <ul className="divide-y divide-border">
              {group.retired.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-1">
                  <span className="flex-1 min-w-0 opacity-70">{name(o)}</span>
                  {reactivate && (
                    <ActionButton variant="ghost" onClick={() => onStatus(o, 'Active')}>
                      Reactivate
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Offices and teams, for Section Captains (the `club` section). */
export default function Club() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('club') ?? false;
  const [tab, setTab] = useState<Tab>('offices');
  const [adding, setAdding] = useState<OfficeGroup['office'] | null>(null);
  const [status, setStatus] = useState<{ row: OfficeView; to: 'Active' | 'Retired' } | null>(null);

  const offices = useQuery({ queryKey: OFFICES, queryFn: listOffices, enabled: allowed && tab === 'offices', staleTime: 30_000 });
  const teams = useQuery({ queryKey: TEAMS, queryFn: listTeams, enabled: allowed && tab === 'teams', staleTime: 30_000 });
  const officesChanged = () => {
    void queryClient.invalidateQueries({ queryKey: OFFICES });
    void queryClient.invalidateQueries({ queryKey: ['personHistory'] });
    void queryClient.invalidateQueries({ queryKey: ['myProfile'] });
  };
  const teamsChanged = () => {
    void queryClient.invalidateQueries({ queryKey: TEAMS });
    void queryClient.invalidateQueries({ queryKey: ['personHistory'] });
  };

  const changeStatus = useMutation({
    mutationFn: (s: { row: OfficeView; to: 'Active' | 'Retired' }) => setOfficeStatus(s.row.id, s.to),
    onSuccess: (_r, s) => {
      toast.success(s.to === 'Retired' ? 'Retired' : 'Reactivated');
      officesChanged();
    },
    onError: (err) => {
      toast.error(clubRefusal(err).message);
      officesChanged();
    },
  });

  const groups = offices.data ? groupOffices(offices.data.offices) : [];
  const addingGroup = adding ? groups.find((g) => g.office === adding) : undefined;

  const panel = () => {
    if (tab === 'offices') {
      if (offices.isLoading) return <Skeleton className="h-96 w-full" />;
      if (offices.error || !offices.data) {
        return <ErrorState message="The offices didn't load." onRetry={() => void offices.refetch()} retrying={offices.isFetching} />;
      }
      return (
        <div className="space-y-3">
          {groups.map((g) => (
            <OfficeCard key={g.office} group={g} onAdd={() => setAdding(g.office)} onStatus={(row, to) => setStatus({ row, to })} />
          ))}
        </div>
      );
    }
    if (teams.isLoading) return <Skeleton className="h-96 w-full" />;
    if (teams.error || !teams.data) {
      return <ErrorState message="The teams didn't load." onRetry={() => void teams.refetch()} retrying={teams.isFetching} />;
    }
    return (
      <ul className={listClass}>
        {teams.data.teams
          .filter((t) => t.active)
          .map((t) => (
            <TeamCard key={t.id} team={t} onSaved={teamsChanged} />
          ))}
      </ul>
    );
  };

  const body = () => {
    if (profileLoading) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for Section Captains.</p>;
    return (
      <>
        <Tabs id="club" label="Offices and teams" items={TABS} value={tab} onChange={setTab} />
        <TabPanel tabsId="club" value={tab}>
          {panel()}
        </TabPanel>
        {addingGroup && (
          <OfficeSheet
            group={addingGroup}
            onClose={() => setAdding(null)}
            onStale={officesChanged}
            onSaved={() => {
              setAdding(null);
              officesChanged();
            }}
          />
        )}
        {status && (
          <ConfirmDialog
            title={`${status.to === 'Retired' ? 'Retire' : 'Reactivate'} ${status.row.holder?.name ?? 'this holder'}?`}
            message={groups.find((g) => g.office === status.row.office)?.label ?? ''}
            confirmLabel={status.to === 'Retired' ? 'Retire' : 'Reactivate'}
            destructive={status.to === 'Retired'}
            onCancel={() => setStatus(null)}
            onConfirm={() => {
              changeStatus.mutate(status);
              setStatus(null);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Offices and teams" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
