import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, MapPin } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { checkIn, getCheckIn } from '@/api/events';
import { eventWhen } from '@/components/events/eventText';

/**
 * Where the event's check-in QR code leads: tick yourself in, with anyone
 * you signed up who came too and how many guests. Opens an hour before the
 * start and closes an hour after the end.
 */
export default function CheckInPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const code = params.get('c') ?? '';
  const q = useQuery({ queryKey: ['checkin', id, code], queryFn: () => getCheckIn(id, code), retry: false });
  const [picked, setPicked] = useState<Record<string, { here: boolean; guests: number }>>({});
  // Everyone starts ticked, with all their guests.
  useEffect(() => {
    if (!q.data) return;
    setPicked(Object.fromEntries(q.data.people.map((p) => [p.personId, { here: true, guests: p.response?.guestsCame ?? p.response?.guests.length ?? 0 }])));
  }, [q.data]);
  const send = useMutation({
    mutationFn: () =>
      checkIn(id, {
        code,
        people: Object.entries(picked)
          .filter(([, v]) => v.here)
          .map(([personId, v]) => ({ personId, guestsCame: v.guests })),
      }),
  });

  const body = () => {
    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">{errorText(q.error)}</p>;
    const { event, open, people } = q.data;
    const already = people.every((p) => p.response?.attended);
    return (
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{event.title}</h2>
          <p className="text-sm text-foreground flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" /> {eventWhen(event)}
          </p>
          {event.location && (
            <p className="text-sm text-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" /> {event.location}
            </p>
          )}
        </div>
        {send.isSuccess || already ? (
          <div className="text-center space-y-2 py-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <p className="text-base font-semibold text-foreground">You're checked in. Enjoy!</p>
            <button className={secondary} onClick={() => navigate('/')}>
              My page
            </button>
          </div>
        ) : !open ? (
          <p className="text-sm text-muted-foreground">Check-in opens an hour before the start and closes an hour after the end.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {people.map((p) => {
                const v = picked[p.personId] ?? { here: true, guests: 0 };
                const guests = p.response?.guests.length ?? 0;
                return (
                  <li key={p.personId} className="py-2 flex items-center gap-2">
                    <label className="flex-1 min-w-0 flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" className="h-4 w-4" checked={v.here} onChange={(ev) => setPicked({ ...picked, [p.personId]: { ...v, here: ev.target.checked } })} />
                      <span className="truncate">{p.self ? `${p.name} (you)` : p.name}</span>
                    </label>
                    {guests > 0 && v.here && (
                      <select
                        className={`${fieldInput.replace('w-full ', '')} w-32 shrink-0`}
                        value={v.guests}
                        aria-label={`How many of ${p.self ? 'your' : `${p.name}'s`} guests came`}
                        onChange={(ev) => setPicked({ ...picked, [p.personId]: { ...v, guests: Number(ev.target.value) } })}
                      >
                        {Array.from({ length: guests + 1 }, (_, n) => (
                          <option key={n} value={n}>
                            +{n} guest{n === 1 ? '' : 's'}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
            {!people[0]?.response && <p className="text-xs text-muted-foreground">You hadn't answered: checking in puts you down as Going.</p>}
            {send.isError && (
              <p role="alert" className="text-xs text-destructive">
                {errorText(send.error)}
              </p>
            )}
            <button className={`${primary} w-full`} disabled={send.isPending || !Object.values(picked).some((v) => v.here)} onClick={() => send.mutate()}>
              {send.isPending ? 'Checking in…' : "I'm here"}
            </button>
          </>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Check in" />
      <main className="flex-1 container mx-auto max-w-md px-4 py-4">{body()}</main>
      <AppFooter />
    </div>
  );
}
