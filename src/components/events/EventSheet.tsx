import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, MapPin, Plus, Search, Ticket, Trash2, UserPlus, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { safeFormat } from '@/lib/dateUtils';
import { respondToEvent, searchEventPeople } from '@/api/events';
import { EVENT_TYPE_LABEL, RESPONSE_LABEL, asksDietary, missingAnswer, type EventDetails, type Guest, type MyEvent, type ResponseDetails, type ResponseStatus } from '@shared/events';
import { eventWhen, priceLines } from './eventText';
import BillBox from './BillBox';
import PosterImage from './PosterImage';

const STATUSES: ResponseStatus[] = ['going', 'maybe', 'not_going'];

export const statusChip: Record<ResponseStatus, string> = {
  going: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  maybe: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  not_going: 'bg-muted text-muted-foreground',
};

export interface Draft {
  status: ResponseStatus | null;
  guests: Guest[];
  canHelp: boolean;
  answers: Record<string, string>;
  notes: string;
}

export const draftOf = (r: ResponseDetails | null, fallback: ResponseStatus | null = null): Draft => ({
  status: r?.status ?? fallback,
  guests: r?.guests ?? [],
  canHelp: r?.canHelp ?? false,
  answers: r?.answers ?? {},
  notes: r?.notes ?? '',
});

/** Going / Maybe / Not going, guests, the event's questions, "I can help" and a note, for one person. */
export function ResponseEditor({
  event,
  initial,
  saving,
  saveLabel = 'Save',
  onSave,
  onCancel,
  relaxed = false,
}: {
  event: Pick<EventDetails, 'guestsAllowed' | 'maxGuests' | 'helpNeeded' | 'questions'>;
  initial: Draft;
  saving: boolean;
  saveLabel?: string;
  onSave: (d: Draft) => void;
  onCancel?: () => void;
  /** A social secretary answering on someone's behalf: required questions may be left. */
  relaxed?: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const max = event.maxGuests ?? 1;
  const going = d.status && d.status !== 'not_going';
  const dietary = asksDietary(event.questions);
  const dietaryRequired = !!event.questions.find((q) => q.key === 'dietary')?.required;
  const missing = going && !relaxed ? missingAnswer(event.questions, d.answers, d.guests) : null;
  const required = (on: boolean | undefined) => (on && !relaxed ? <span className="text-destructive"> *</span> : null);
  const setGuest = (i: number, g: Partial<Guest>) => setD({ ...d, guests: d.guests.map((x, j) => (j === i ? { ...x, ...g } : x)) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Your answer">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={d.status === s}
            onClick={() => setD({ ...d, status: s })}
            className={`h-10 rounded-md border text-sm font-medium ${d.status === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}
          >
            {RESPONSE_LABEL[s]}
          </button>
        ))}
      </div>
      {going && event.guestsAllowed && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">
            Guests <span className="font-normal text-muted-foreground">(up to {max})</span>
          </p>
          {d.guests.map((g, i) => (
            <div key={i} className="rounded-md border border-border p-2 space-y-2">
              <div className="flex gap-2">
                <input className={`${fieldInput} flex-1 min-w-0`} placeholder="Name" value={g.name} onChange={(e) => setGuest(i, { name: e.target.value })} aria-label={`Guest ${i + 1} name`} />
                <select className={`${fieldInput.replace('w-full ', '')} w-24 shrink-0`} value={g.age} onChange={(e) => setGuest(i, { age: e.target.value as Guest['age'] })} aria-label={`Guest ${i + 1} adult or child`}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
                <button className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label={`Remove guest ${i + 1}`} onClick={() => setD({ ...d, guests: d.guests.filter((_, j) => j !== i) })}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {dietary && (
                <input className={fieldInput} placeholder={dietaryRequired && !relaxed ? 'Dietary requirements (None if none)' : 'Dietary requirements (if any)'} value={g.dietary ?? ''} onChange={(e) => setGuest(i, { dietary: e.target.value })} aria-label={`Guest ${i + 1} dietary requirements`} />
              )}
            </div>
          ))}
          {d.guests.length < max && (
            <button className="inline-flex items-center gap-1 text-sm text-primary" onClick={() => setD({ ...d, guests: [...d.guests, { name: '', age: 'adult' }] })}>
              <Plus className="h-4 w-4" /> Add a guest
            </button>
          )}
        </div>
      )}
      {going &&
        event.questions.map((q) => (
          <label key={q.key} className="block space-y-1 text-xs font-medium text-foreground">
            {q.key === 'dietary' ? 'Your dietary requirements' : q.label}
            {required(q.required)}
            <input
              className={fieldInput}
              value={d.answers[q.key] ?? ''}
              placeholder={q.key === 'dietary' ? (q.required && !relaxed ? 'e.g. vegetarian, no nuts, or None' : 'e.g. vegetarian, no nuts (leave blank if none)') : ''}
              onChange={(e) => setD({ ...d, answers: { ...d.answers, [q.key]: e.target.value } })}
            />
          </label>
        ))}
      {going && event.helpNeeded && (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={d.canHelp} onChange={(e) => setD({ ...d, canHelp: e.target.checked })} />
          <span>
            I can help <span className="text-muted-foreground">({event.helpNeeded})</span>
          </span>
        </label>
      )}
      <input className={fieldInput} placeholder="Anything the organiser should know (optional)" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Note for the organiser" />
      {missing && <p className="text-xs text-muted-foreground text-right">{missing}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className={secondary} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className={primary} disabled={saving || !d.status || !!missing} onClick={() => onSave(d)}>
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

export function answerLine(r: ResponseDetails): string {
  const guests = r.guests.length ? ` +${r.guests.length} guest${r.guests.length === 1 ? '' : 's'}` : '';
  return `${RESPONSE_LABEL[r.status]}${r.status !== 'not_going' ? guests : ''}`;
}

/**
 * One event: the poster and details, their answer, and the people they've
 * signed up. Answers can change until the deadline; after it the sheet
 * shows them and says to ask the social secretary.
 */
export default function EventSheet({ event, onClose }: { event: MyEvent; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ personId: string | null; name: string; initial: Draft } | null>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    void queryClient.invalidateQueries({ queryKey: ['eventPeople', event.id] });
  };
  const save = useMutation({
    mutationFn: ({ personId, d }: { personId: string | null; d: Draft }) =>
      respondToEvent(event.id, {
        ...(personId ? { personId } : {}),
        status: d.status!,
        guests: d.guests.map((g) => ({ ...g, name: g.name.trim() })),
        canHelp: d.canHelp,
        answers: d.answers,
        notes: d.notes,
      }),
    onSuccess: (_r, v) => {
      toast.success(v.personId ? 'Signed up' : 'Answer saved');
      setEditing(null);
      setSearch('');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const takeOff = useMutation({
    mutationFn: (personId: string) => respondToEvent(event.id, { personId, remove: true }),
    onSuccess: () => {
      toast.success('Taken off');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const people = useQuery({
    queryKey: ['eventPeople', event.id, search.trim()],
    queryFn: () => searchEventPeople(event.id, search.trim()),
    enabled: adding && search.trim().length >= 2,
  });
  const cancelled = event.status === 'cancelled';
  const prices = priceLines(event);
  const mine = event.mine;
  const editingMe = editing && editing.personId === null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="p-4 sm:max-w-lg sm:mx-auto">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{event.title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          {event.posterUrl && <PosterImage url={event.posterUrl} title={event.title} className="max-h-[50vh]" />}
          {cancelled && <p className="rounded-md bg-destructive/10 text-destructive text-sm font-medium p-2">This event has been cancelled.</p>}
          <div className="space-y-1 text-sm text-foreground">
            <p className="text-xs font-medium text-muted-foreground">
              {EVENT_TYPE_LABEL[event.type]}
              {event.team ? ` · ${event.team}` : ''}
            </p>
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" /> {eventWhen(event)}
            </p>
            {event.location && (
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" /> {event.location}
              </p>
            )}
            {prices.length > 0 && (
              <p className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-muted-foreground shrink-0" /> {prices.join(' · ')}
              </p>
            )}
            {event.description && <p className="whitespace-pre-line pt-1">{event.description}</p>}
          </div>

          {!cancelled && (
            <section className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Are you coming?</h3>
                <p className="text-xs text-muted-foreground">
                  {event.open ? `Answer by ${safeFormat(event.respondBy ?? event.startsAt, 'EEE d MMM, h:mm a')}` : 'Answers have closed'}
                </p>
              </div>
              {mine?.signedUpBy && <p className="text-xs text-muted-foreground">Signed up by {mine.signedUpBy.name}, who pays for you.</p>}
              {event.open && (!mine || editingMe) ? (
                <ResponseEditor
                  key={`me-${mine?.status ?? 'none'}`}
                  event={event}
                  initial={draftOf(mine)}
                  saving={save.isPending}
                  onSave={(d) => save.mutate({ personId: null, d })}
                  onCancel={mine ? () => setEditing(null) : undefined}
                />
              ) : mine ? (
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${statusChip[mine.status]}`}>{answerLine(mine)}</span>
                  {mine.canHelp && <span className="text-xs text-muted-foreground">You can help</span>}
                  {event.open && (
                    <button className="ml-auto text-sm text-primary" onClick={() => setEditing({ personId: null, name: 'You', initial: draftOf(mine) })}>
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">You didn't answer.</p>
              )}
              {!event.open && <p className="text-xs text-muted-foreground">To change anything now, ask the social secretary.</p>}
            </section>
          )}

          {event.bill && event.paymentMode !== 'free' && !cancelled && <BillBox event={event} />}

          {(event.signedUp.length > 0 || (event.open && event.invited)) && !cancelled && (
            <section className="rounded-xl border border-border p-3 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Other players you're signing up</h3>
              <p className="text-xs text-muted-foreground">You pay for anyone you sign up.</p>
              {event.signedUp.map((p) =>
                editing?.personId === p.personId ? (
                  <div key={p.personId} className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    <ResponseEditor event={event} initial={editing.initial} saving={save.isPending} onSave={(d) => save.mutate({ personId: p.personId, d })} onCancel={() => setEditing(null)} />
                  </div>
                ) : (
                  <div key={p.personId} className="flex items-center gap-2">
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{p.name}</span>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${statusChip[p.status]}`}>{answerLine(p)}</span>
                    {event.open && (
                      <>
                        <button className="text-sm text-primary" onClick={() => setEditing({ personId: p.personId, name: p.name, initial: draftOf(p) })}>
                          Change
                        </button>
                        <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" aria-label={`Take ${p.name} off`} onClick={() => takeOff.mutate(p.personId)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                ),
              )}
              {event.open && event.invited && editing?.personId && !event.signedUp.some((p) => p.personId === editing.personId) ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Signing up {editing.name}</p>
                  <ResponseEditor event={event} initial={editing.initial} saving={save.isPending} saveLabel="Sign up" onSave={(d) => save.mutate({ personId: editing.personId, d })} onCancel={() => setEditing(null)} />
                </div>
              ) : event.open && event.invited && !adding ? (
                <button className="inline-flex items-center gap-1.5 text-sm text-primary" onClick={() => setAdding(true)}>
                  <UserPlus className="h-4 w-4" /> Sign up someone else
                </button>
              ) : event.open && event.invited ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input autoFocus className={`${fieldInput} pl-8`} placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search players by name" />
                  </div>
                  {people.data?.people.length === 0 && search.trim().length >= 2 && <p className="text-xs text-muted-foreground">Nobody invited by that name.</p>}
                  <ul className="divide-y divide-border">
                    {people.data?.people.map((p) => (
                      <li key={p.personId} className="py-2 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {p.answer ? `${RESPONSE_LABEL[p.answer.status]}${p.answer.signedUpBy ? ` · signed up by ${p.answer.signedUpBy}` : ' · answered'}` : p.team ?? ''}
                          </p>
                        </div>
                        {p.answer ? (
                          <span className={`text-xs font-medium px-2 py-1 rounded ${statusChip[p.answer.status]}`}>Already {RESPONSE_LABEL[p.answer.status].toLowerCase()}</span>
                        ) : (
                          <button
                            className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                            onClick={() => {
                              setEditing({ personId: p.personId, name: p.name, initial: draftOf(null, 'going') });
                              setAdding(false);
                            }}
                          >
                            Add
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button className="text-xs text-muted-foreground" onClick={() => { setAdding(false); setSearch(''); }}>
                    Close search
                  </button>
                </div>
              ) : null}
            </section>
          )}

          {event.manager && (
            <Link to={`/events/manage?event=${event.id}`} className="block text-center text-sm text-primary">
              Manage this event
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
