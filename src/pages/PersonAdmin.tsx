import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { ErrorState } from '@/components/ui/error-state';
import { AdminBlock } from '@/components/admin/AdminBlock';
import MembershipBlock from '@/components/admin/MembershipBlock';
import StageBlock from '@/components/admin/StageBlock';
import ActiveBlock from '@/components/admin/ActiveBlock';
import SquadBlock from '@/components/admin/SquadBlock';
import HistoryList, { historyKey } from '@/components/admin/HistoryList';
import { useMyProfile } from '@/lib/queries';
import { isApiError, personChip } from '@/lib/peopleAdmin';
import { getPersonAdmin } from '@/api/adminPeople';

const personAdminKey = (id: string) => ['personAdmin', id] as const;

/**
 * One person, for officers (the `people` section). Each block shows only
 * when the API's `can` flags open it for the caller; the API checks again
 * on every save.
 */
export default function PersonAdmin() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('people') ?? false;
  const { data: person, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: personAdminKey(id),
    queryFn: () => getPersonAdmin(id),
    enabled: allowed && !!id,
    staleTime: 30_000,
  });

  const saved = () => {
    void queryClient.invalidateQueries({ queryKey: personAdminKey(id) });
    void queryClient.invalidateQueries({ queryKey: historyKey(id) });
    void queryClient.invalidateQueries({ queryKey: ['peopleSearch'] });
  };
  // Someone else saved first: fetch their values (the blocks restart from them).
  const reload = saved;

  const body = () => {
    if (profileLoading || (allowed && isLoading)) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for officers.</p>;
    if (error || !person) {
      const gone = isApiError(error) && error.status === 404;
      return (
        <ErrorState
          title={gone ? 'Not found' : 'Could not load this person'}
          message={gone ? 'This person is no longer on record.' : undefined}
          onRetry={gone ? undefined : () => void refetch()}
          retrying={isFetching}
        />
      );
    }
    const chip = personChip(person);
    const { can } = person;
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{person.team ?? 'No registered team'}</p>
          {chip && <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
        </div>
        {can.membership && person.membership && (
          <MembershipBlock personId={person.id} membership={person.membership} onSaved={saved} onReload={reload} />
        )}
        {can.stage && person.stageTargets && person.stageTargets.length > 0 && (
          <StageBlock personId={person.id} stage={person.stage} targets={person.stageTargets} onSaved={saved} onReload={reload} />
        )}
        {can.squad && person.squad && (
          <SquadBlock
            personId={person.id}
            squad={person.squad}
            teamOptions={person.teamOptions ?? []}
            can={can}
            onSaved={saved}
            onReload={reload}
          />
        )}
        {can.activate && <ActiveBlock personId={person.id} name={person.name} active={person.active} onSaved={saved} />}
        {can.suspend && (
          <AdminBlock title="Suspension">
            <Link
              to={`/suspensions?person=${encodeURIComponent(person.id)}`}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-border bg-background text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
              Suspend
            </Link>
          </AdminBlock>
        )}
        <AdminBlock title="History">
          <HistoryList personId={person.id} />
        </AdminBlock>
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title={person?.name ?? 'Person'} back="/people" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
