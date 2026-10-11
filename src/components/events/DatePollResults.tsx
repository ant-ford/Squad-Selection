import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { chooseEventDate } from '@/api/events';
import { toast } from '@/lib/toast';
import { errorText } from '@/components/profile/steps';
import { ActionButton } from '@/components/ui/action-button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DATE_ANSWER_LABEL, isDatePoll, type DateAnswer, type EventDateOption } from '@shared/eventDates';
import type { EventResponses } from '@shared/events';
import { eventWhen } from './eventText';

const choices: DateAnswer[] = ['available', 'maybe', 'unavailable'];
export default function DatePollResults({ data }: { data: EventResponses }) {
  const queryClient = useQueryClient();
  const event = data.event;
  const [choosing, setChoosing] = useState<EventDateOption | null>(null);
  const rows = data.dateResponses ?? [];
  const select = useMutation({
    mutationFn: (o: EventDateOption) => chooseEventDate(event.id, o.id, event.dateOptions!),
    onSuccess: () => {
      toast.success('Date chosen: Available replies carried over as Going');
      setChoosing(null);
      for (const key of [['eventResponses', event.id], ['manageEvents'], ['myEvents'], ['myTasks']]) void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => {
      toast.error(errorText(err));
      if ((err as { status?: number }).status === 409) void queryClient.invalidateQueries({ queryKey: ['eventResponses', event.id] });
    },
  });
  return (
    <section aria-label="Date replies" className="space-y-3">
      <div><h3 className="text-sm font-semibold">{event.chosenDateId ? 'Date chosen' : 'Choose a date'}</h3>
        <p className="text-xs text-muted-foreground">{rows.length} replied · {event.invited} invited. Available replies for the chosen date carry over as Going.</p>
      </div>
      {event.dateOptions!.map((o) => (
        <article key={o.id} aria-label={eventWhen(o)} className={`rounded-lg border p-3 space-y-2 ${event.chosenDateId === o.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
          <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{eventWhen(o)}</p>{event.chosenDateId === o.id && <span className="text-xs text-primary">Chosen</span>}</div>
          <div className="flex flex-wrap gap-3 text-xs">{choices.map((s) => <span key={s}>{DATE_ANSWER_LABEL[s]}: <strong>{rows.filter((r) => r.answers[o.id] === s).length}</strong></span>)}{isDatePoll(event) && <span>No reply: <strong>{data.notAnswered.length}</strong></span>}</div>
          {rows.length > 0 && <details><summary className="text-xs text-primary cursor-pointer min-h-10 flex items-center">Show names</summary>
            <div className="space-y-2 text-xs">{choices.map((s) => <p key={s}><span className="font-medium">{DATE_ANSWER_LABEL[s]}:</span> {rows.filter((r) => r.answers[o.id] === s).map((r) => r.name).join(', ') || 'None'}</p>)}</div>
          </details>}
          {isDatePoll(event) && event.status === 'published' && <ActionButton variant="outline" disabled={Date.parse(o.startsAt) <= Date.now() || select.isPending} onClick={() => setChoosing(o)}>Choose this date</ActionButton>}
        </article>
      ))}
      {isDatePoll(event) && data.notAnswered.length > 0 && <details><summary className="min-h-10 text-xs text-primary cursor-pointer flex items-center">{data.notAnswered.length} still to answer</summary><p className="text-xs">{data.notAnswered.map((p) => p.name).join(', ')}</p></details>}
      {choosing && <ConfirmDialog title="Choose this date?" message={`${eventWhen(choosing)}. The poll will close. Available replies for this date will carry over as Going; everyone else can RSVP. You can still edit the event details.`} confirmLabel="Choose date" busy={select.isPending} onConfirm={() => select.mutate(choosing)} onCancel={() => !select.isPending && setChoosing(null)} />}
    </section>
  );
}
