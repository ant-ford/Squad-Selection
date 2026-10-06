import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import VolunteeringSection from '@/components/VolunteeringSection';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { getMyVolunteering, saveVolunteering } from '@/api/volunteering';
import { volunteeringMissing, type MyVolunteering, type VolunteeringAnswers } from '@shared/volunteering';

function Form({ initial, onSaved }: { initial: MyVolunteering; onSaved: () => void }) {
  const [answers, setAnswers] = useState<VolunteeringAnswers>(initial);
  const save = useMutation({ mutationFn: () => saveVolunteering(answers), onSuccess: onSaved });
  const missing = volunteeringMissing(answers);
  return (
    <>
      {initial.updatedAt && <p className="text-xs text-muted-foreground">Last updated {safeFormat(initial.updatedAt, 'd MMM yyyy')}.</p>}
      <VolunteeringSection value={answers} onChange={setAnswers} />
      {save.error && (
        <p role="alert" className="text-xs text-destructive">
          {save.error instanceof ApiError ? save.error.message : 'Not saved: the connection or the server failed. Please try again.'}
        </p>
      )}
      {missing && <p className="text-xs text-muted-foreground">{missing}</p>}
      <button
        className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        disabled={!!missing || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

/** "My volunteering": the player's own roles and levels, changeable any time. */
export default function MyVolunteeringPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering });
  const saved = () => {
    toast.success('Volunteering saved');
    void queryClient.invalidateQueries({ queryKey: ['myVolunteering'] });
    void queryClient.invalidateQueries({ queryKey: ['volunteersBoard'] });
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="My volunteering" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : error || !data ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">{error instanceof ApiError && error.status < 500 ? error.message : 'Could not load your volunteering.'}</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : (
          <Form initial={data} onSaved={saved} />
        )}
      </main>
      <AppFooter />
    </div>
  );
}
