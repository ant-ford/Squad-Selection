import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Check, ExternalLink } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import { errorText, primary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { completeJoinerTask, getJoinerTask } from '@/api/joiners';

/**
 * A Section Captain's request to the Kit Convenor or the Hockey Convenor
 * for a new joiner: the details they need, the documents for HockeyHK, and
 * a Done button (there's nothing to fill in).
 */
export default function JoinerTaskPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const task = useQuery({ queryKey: ['joinerTask', id], queryFn: () => getJoinerTask(id) });
  const [confirming, setConfirming] = useState(false);
  const done = useMutation({
    mutationFn: () => completeJoinerTask(id),
    onSuccess: () => {
      toast.success('Marked done');
      void queryClient.invalidateQueries({ queryKey: ['joinerTask', id] });
      void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const body = () => {
    if (task.isLoading) return <Skeleton className="h-64 w-full" />;
    if (task.error || !task.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{errorText(task.error)}</p>
          <button onClick={() => void task.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    const t = task.data;
    const title = t.kind === 'kit' ? `Kit for ${t.applicant}` : `Register ${t.applicant} with HockeyHK`;
    return (
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Asked {safeFormat(t.startedAt, 'd MMM yyyy')}</p>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {t.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground">{v || '–'}</dd>
            </div>
          ))}
        </dl>
        {t.kind === 'kit' && (
          <p className="text-xs text-muted-foreground">
            Allocate their set on the{' '}
            <button className="text-primary underline" onClick={() => navigate('/kit')}>
              kit screen
            </button>
            , then mark this done once they have it.
          </p>
        )}
        {t.kind === 'registration' && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Documents</p>
            {t.files.length === 0 && <p className="text-xs text-muted-foreground">None uploaded yet.</p>}
            {t.files.map((f) => (
              <a key={f.label} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-primary underline">
                {f.label} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-4 border-t border-border">
          {t.doneAt ? (
            <p className="text-sm text-primary flex items-center gap-1">
              <Check className="h-4 w-4" /> Done {safeFormat(t.doneAt, 'd MMM yyyy')}
            </p>
          ) : (
            <button className={primary} onClick={() => setConfirming(true)} disabled={done.isPending}>
              {done.isPending ? 'Saving…' : 'Mark as done'}
            </button>
          )}
        </div>
        {confirming && (
          <ConfirmDialog
            title={t.kind === 'kit' ? 'Have they got their kit?' : 'Are they registered?'}
            message="It comes off your tasks, and the Section Captain sees it's done."
            confirmLabel="Yes, done"
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              done.mutate();
            }}
          />
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="New joiner" back="/" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4">{body()}</main>
      <AppFooter />
    </div>
  );
}
