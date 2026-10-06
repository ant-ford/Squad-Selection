import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { StepShell, errorText, type StepProps } from '@/components/profile/steps';
import { differs } from '@/lib/drafts';
import { safeFormat } from '@/lib/dateUtils';
import { saveMyTrial, submitRegistration } from '@/api/trials';
import type { MyTrial } from '@shared/trials';

/**
 * The trial sessions they can come to (before the season), or a note that
 * the club will be in touch about a practice (once it has started).
 */
export function TrialDatesStep({ trial, ...nav }: Omit<StepProps, 'details'> & { trial: MyTrial }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string[]>(trial.chosen);
  const [none, setNone] = useState(trial.registeredAt !== null && trial.chosen.length === 0);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveMyTrial(none ? [] : chosen),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myTrial'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  if (trial.sessions.length === 0) {
    return (
      <StepShell title="Trials" {...nav} onNext={nav.onDone} nextLabel="Next">
        <p className="text-sm text-foreground">
          There are no trial sessions coming up: the season has started. Once you've registered, a Section Captain will be in touch about coming down to a
          practice.
        </p>
      </StepShell>
    );
  }
  const toggle = (id: string, on: boolean) => {
    setNone(false);
    setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
  };
  const next = () => {
    const bad = !none && chosen.length === 0 ? "Choose the sessions you can come to, or say you can't make any." : null;
    setProblem(bad);
    if (!bad) save.mutate();
  };
  return (
    <StepShell
      title="Trials"
      {...nav}
      onNext={next}
      busy={save.isPending}
      problem={problem}
      dirty={!save.isSuccess && differs({ chosen, none }, { chosen: trial.chosen, none: trial.registeredAt !== null && trial.chosen.length === 0 })}
    >
      <p className="text-xs text-muted-foreground">Which trial sessions can you come to?</p>
      <div className="space-y-1">
        {trial.sessions.map((s) => (
          <label key={s.id} className="flex gap-2 items-start text-sm text-foreground py-1">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              checked={chosen.includes(s.id)}
              onChange={(e) => toggle(s.id, e.target.checked)}
            />
            <span>
              {safeFormat(s.startsAt, 'EEE d MMM yyyy, h:mm a')} · {s.place}
              {s.notes && <span className="block text-xs text-muted-foreground">{s.notes}</span>}
            </span>
          </label>
        ))}
        <label className="flex gap-2 items-center text-sm text-foreground py-1">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={none}
            onChange={(e) => {
              setNone(e.target.checked);
              if (e.target.checked) setChosen([]);
            }}
          />
          I can't make any of these
        </label>
      </div>
    </StepShell>
  );
}

/** Sends the registration to the Section Captains (and updates it if sent before). */
export function RegisterStep({ trial, ...nav }: Omit<StepProps, 'details'> & { trial: MyTrial }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: submitRegistration,
    onSuccess: () => {
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['myTrial'] });
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const sent = trial.registeredAt || send.isSuccess;
  return (
    <StepShell
      title="Send your registration"
      {...nav}
      onNext={() => send.mutate()}
      nextLabel={sent ? 'Send my changes' : 'Send registration'}
      busy={send.isPending}
      problem={problem}
    >
      {sent ? (
        <p className="text-sm text-foreground flex gap-2 items-start">
          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          Thanks, you're registered{trial.registeredAt ? ` (${safeFormat(trial.registeredAt, 'd MMM yyyy')})` : ''}. We will be in touch. You can come
          back and change your details any time.
        </p>
      ) : (
        <p className="text-sm text-foreground">
          That's everything. Send your registration and we will be in touch.
        </p>
      )}
    </StepShell>
  );
}
