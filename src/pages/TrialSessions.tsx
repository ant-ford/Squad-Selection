import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Trash2, Users } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import { addTrialSession, listTrialSessions, removeTrialSession } from '@/api/trials';

/**
 * The trial sessions people registering to join can choose from (Section
 * Captains). Only sessions still to come are offered; once they've all
 * passed, registrants are told the club will be in touch about a practice.
 */
export default function TrialSessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  // The planning section is the Section Captains office, on the Supabase backend only.
  const allowed = profile?.sections?.includes('planning') ?? false;
  const list = useQuery({ queryKey: ['trialSessions'], queryFn: listTrialSessions, enabled: allowed });
  const [startsAt, setStartsAt] = useState('');
  const [place, setPlace] = useState('HKFC pitch');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['trialSessions'] });
  const add = useMutation({
    mutationFn: () => addTrialSession(new Date(startsAt).toISOString(), place, notes),
    onSuccess: () => {
      toast.success('Trial session added');
      setStartsAt('');
      setNotes('');
      setProblem(null);
      refresh();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const remove = useMutation({ mutationFn: (id: string) => removeTrialSession(id), onSuccess: refresh, onError: (err) => toast.error(errorText(err)) });
  const link = `${window.location.origin}/join`;

  const body = () => {
    if (profileLoading || list.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!allowed) return <p className="text-sm text-muted-foreground">Trial sessions are kept by the Section Captains.</p>;
    const now = Date.now();
    return (
      <>
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-base font-semibold text-foreground">Trial sessions</h2>
          {list.data?.sessions.length ? (
            <ul className="divide-y divide-border">
              {list.data.sessions.map((s) => {
                const past = Date.parse(s.startsAt) < now;
                return (
                  <li key={s.id} className="py-2 flex items-center gap-3">
                    <div className={`flex-1 min-w-0 ${past ? 'text-muted-foreground' : 'text-foreground'}`}>
                      <p className="text-sm">
                        {safeFormat(s.startsAt, 'EEE d MMM yyyy, h:mm a')} · {s.place}
                        {past && ' (passed)'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.count} can come{s.notes ? ` · ${s.notes}` : ''}
                      </p>
                    </div>
                    <button className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Remove" onClick={() => setRemoving(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None yet. Once the season has started, registrants are told you'll be in touch about a practice.</p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-base font-semibold text-foreground">Add a session</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium text-foreground">
              Date and time
              <input type="datetime-local" className={fieldInput} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground">
              Place
              <input className={fieldInput} value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </div>
          <label className="block space-y-1 text-xs font-medium text-foreground">
            Notes (optional)
            <input className={fieldInput} value={notes} placeholder="e.g. Bring a stick, shin pads and a mouthguard" onChange={(e) => setNotes(e.target.value)} />
          </label>
          {problem && (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          )}
          <div className="flex justify-end">
            <button className={primary} disabled={add.isPending || !startsAt} onClick={() => add.mutate()}>
              {add.isPending ? 'Adding…' : 'Add session'}
            </button>
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="text-base font-semibold text-foreground">The registration link</h2>
          <p className="text-xs text-muted-foreground">Every member also has their own on their player page, which tells you who sent them.</p>
          <button
            className="inline-flex items-center gap-1.5 text-sm text-primary underline"
            onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))}
          >
            <Copy className="h-4 w-4" /> {link}
          </button>
        </section>
        {removing && (
          <ConfirmDialog
            title="Remove this session?"
            message="Anyone who said they can come to it is no longer down for it."
            confirmLabel="Remove"
            destructive
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              remove.mutate(removing);
              setRemoving(null);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Trial sessions">
        <button onClick={() => navigate('/membership')} className={headerNavClass()}>
          <Users className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Membership</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
