import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { answerEventDates } from '@/api/events';
import { toast } from '@/lib/toast';
import { errorText } from '@/components/profile/steps';
import { ActionButton } from '@/components/ui/action-button';
import { differs } from '@/lib/drafts';
import { DATE_ANSWER_LABEL, type DateAnswer, type DateAnswers } from '@shared/eventDates';
import type { MyEvent } from '@shared/events';
import { eventWhen } from './eventText';

const choices: DateAnswer[] = ['available', 'maybe', 'unavailable'];
export default function DatePollEditor({ event, onDirtyChange }: { event: MyEvent; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const initial = event.myDateAnswers ?? {};
  const [answers, setAnswers] = useState<DateAnswers>(initial);
  const dirty = differs(answers, initial);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { setAnswers(event.myDateAnswers ?? {}); }, [event.myDateAnswers]);
  const save = useMutation({
    mutationFn: () => answerEventDates(event.id, answers),
    onSuccess: () => {
      toast.success('Date availability saved');
      setProblem(null);
      onDirtyChange(false);
      void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
      void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
      void queryClient.invalidateQueries({ queryKey: ['eventResponses', event.id] });
      void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    },
    onError: (err) => {
      setProblem(errorText(err));
      if ((err as { status?: number }).status === 409) void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
    },
  });
  const complete = event.dateOptions!.every((o) => answers[o.id]);
  return (
    <section aria-label="Date availability" className="rounded-xl border border-border p-3 space-y-3">
      <h3 className="text-sm font-semibold">Which dates can you make?</h3>
      <p className="text-xs text-muted-foreground">Answer each date. When the organiser chooses a date, Available for that date carries over as Going. You can change your RSVP afterwards.</p>
      {event.dateOptions!.map((o, i) => (
        <div key={o.id} className="space-y-2">
          <p className="text-sm font-medium">{eventWhen(o)}</p>
          <div role="radiogroup" aria-label={`Date ${i + 1}: ${eventWhen(o)}`} className="grid grid-cols-3 gap-2">
            {choices.map((s) => <button key={s} type="button" role="radio" aria-checked={answers[o.id] === s} disabled={!event.open || !event.invited || save.isPending} onClick={() => setAnswers({ ...answers, [o.id]: s })} className={`h-10 rounded-md border text-sm font-medium ${answers[o.id] === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}>{DATE_ANSWER_LABEL[s]}</button>)}
          </div>
        </div>
      ))}
      {problem && <p role="alert" className="text-xs text-danger-soft-foreground">{problem}</p>}
      {event.open && event.invited ? <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{complete ? event.myDateAnswers && !dirty ? 'Your dates are saved' : 'Ready to save' : 'Answer every date to save'}</p>
        <ActionButton loading={save.isPending} disabled={!complete || !dirty} onClick={() => save.mutate()}>Save dates</ActionButton>
      </div> : <p className="text-xs text-muted-foreground">The date poll has closed.</p>}
    </section>
  );
}
