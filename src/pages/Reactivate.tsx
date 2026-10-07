import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { ActionButton } from '@/components/ui/action-button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText } from '@/components/profile/steps';
import { safeFormat } from '@/lib/dateUtils';
import { answerReactivation, getReactivationRequest } from '@/api/reactivation';

/**
 * A Section Captain's answer to a member asking to be reactivated: Activate
 * or Not now. The first captain to answer closes it for all of them.
 */
export default function ReactivatePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const request = useQuery({ queryKey: ['reactivation', id], queryFn: () => getReactivationRequest(id) });
  const answer = useMutation({
    mutationFn: (activate: boolean) => answerReactivation(id, activate),
    onSuccess: (r) => {
      toast.success(r.status === 'activated' ? 'Activated' : r.status === 'declined' ? 'Left inactive' : 'Already answered');
      void queryClient.invalidateQueries({ queryKey: ['reactivation', id] });
      void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const body = () => {
    if (request.isLoading) return <Skeleton className="h-40 w-full" />;
    if (request.error || !request.data) {
      return <ErrorState title={errorText(request.error)} onRetry={() => void request.refetch()} retrying={request.isFetching} />;
    }
    const r = request.data;
    return (
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Asked {safeFormat(r.askedAt, 'd MMM yyyy')}</p>
          <h2 className="text-base font-semibold text-foreground">{r.name} asks to be reactivated</h2>
          <p className="text-sm text-muted-foreground">
            {[r.team, r.inactiveSince ? `inactive since ${safeFormat(r.inactiveSince, 'd MMM yyyy')}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {r.doneAt ? (
          <p className="text-sm text-primary flex items-center gap-1">
            <Check className="h-4 w-4" /> Answered {safeFormat(r.doneAt, 'd MMM')}{r.doneBy ? ` by ${r.doneBy}` : ''}
          </p>
        ) : (
          <div className="flex gap-2 pt-4 border-t border-border">
            <ActionButton variant="outline" className="flex-1" disabled={answer.isPending} onClick={() => answer.mutate(false)}>
              Not now
            </ActionButton>
            <ActionButton className="flex-1" loading={answer.isPending} onClick={() => answer.mutate(true)}>
              Activate
            </ActionButton>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Reactivate" back="/" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4">{body()}</main>
      <AppFooter />
    </div>
  );
}
