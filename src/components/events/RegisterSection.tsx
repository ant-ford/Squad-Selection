import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCheck, Plus, QrCode, Search } from 'lucide-react';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { safeFormat } from '@/lib/dateUtils';
import { searchEventPeople, setAttendance, setRegisterTaken, tickEveryone } from '@/api/events';
import type { EventResponseRow, ManagedEvent } from '@shared/events';
import CheckInQrSheet from './CheckInQrSheet';

/**
 * Who came, ticked off at the door (owner, 6 Oct 2026): everyone who said
 * Going, a tick each, with how many of their guests came. Members who scan
 * the check-in QR code tick themselves. Only ticked people count as having
 * come; charging is unchanged.
 */
export default function RegisterSection({ event, responses }: { event: ManagedEvent; responses: EventResponseRow[] }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [qr, setQr] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['eventResponses', event.id] });
    void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
  };
  const mark = useMutation({
    mutationFn: (v: { personId: string; attended: boolean; guestsCame?: number }) => setAttendance(event.id, v.personId, v.attended, v.guestsCame),
    onSuccess: refresh,
    onError: (err) => toast.error(errorText(err)),
  });
  const all = useMutation({
    mutationFn: () => tickEveryone(event.id),
    onSuccess: (r) => {
      toast.success(`${r.ticked} ticked`);
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const taken = useMutation({
    mutationFn: (value: boolean) => setRegisterTaken(event.id, value),
    onSuccess: (_r, value) => {
      toast.success(value ? 'Register taken' : 'Register reopened');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const people = useQuery({
    queryKey: ['eventPeople', event.id, search.trim()],
    queryFn: () => searchEventPeople(event.id, search.trim()),
    enabled: adding && search.trim().length >= 2,
  });

  const list = responses.filter((r) => r.status === 'going' || r.attended);
  const came = list.filter((r) => r.attended).length;
  const unticked = list.some((r) => !r.attended);
  const ticked = new Set(list.filter((r) => r.attended).map((r) => r.personId));

  return (
    <section className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Register</h3>
        <span className="text-xs text-muted-foreground">
          {came} of {list.length} here
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={`${secondary} h-8 text-xs inline-flex items-center gap-1`} onClick={() => setQr(true)}>
          <QrCode className="h-3.5 w-3.5" /> Check-in QR code
        </button>
        {unticked && (
          <button className={`${secondary} h-8 text-xs inline-flex items-center gap-1`} disabled={all.isPending} onClick={() => all.mutate()}>
            <CheckCheck className="h-3.5 w-3.5" /> Tick everyone
          </button>
        )}
      </div>
      {list.length === 0 && <p className="text-sm text-muted-foreground">Nobody has said Going yet.</p>}
      <ul className="divide-y divide-border">
        {list.map((r) => (
          <li key={r.personId} className="py-1.5 flex items-center gap-2">
            <label className="flex-1 min-w-0 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={r.attended}
                disabled={mark.isPending}
                onChange={(ev) => mark.mutate({ personId: r.personId, attended: ev.target.checked, guestsCame: ev.target.checked ? r.guests.length : undefined })}
              />
              <span className="truncate">{r.name}</span>
              {r.checkedInAt && <span className="text-xs text-muted-foreground shrink-0">checked in {safeFormat(r.checkedInAt, 'h:mm a')}</span>}
            </label>
            {r.guests.length > 0 && r.attended && (
              <select
                className={`${fieldInput.replace('w-full ', '')} w-32 shrink-0 h-8 text-xs`}
                value={r.guestsCame ?? 0}
                aria-label={`How many of ${r.name}'s guests came`}
                onChange={(ev) => mark.mutate({ personId: r.personId, attended: true, guestsCame: Number(ev.target.value) })}
              >
                {Array.from({ length: r.guests.length + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    +{n} of {r.guests.length} guest{r.guests.length === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      {!adding ? (
        <button className="inline-flex items-center gap-1.5 text-sm text-primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add someone who came
        </button>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input autoFocus className={`${fieldInput} pl-8`} placeholder="Search by name" value={search} onChange={(ev) => setSearch(ev.target.value)} aria-label="Search for someone who came" />
          </div>
          <ul className="divide-y divide-border">
            {people.data?.people
              .filter((p) => !ticked.has(p.personId))
              .map((p) => (
                <li key={p.personId} className="py-2 flex items-center gap-2">
                  <span className="text-sm text-foreground flex-1 truncate">{p.name}</span>
                  <button
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                    onClick={() => {
                      mark.mutate({ personId: p.personId, attended: true });
                      setSearch('');
                    }}
                  >
                    They came
                  </button>
                </li>
              ))}
          </ul>
          <p className="text-xs text-muted-foreground">Anyone added here is put down as Going, and charged like everyone else.</p>
          <button className="text-xs text-muted-foreground" onClick={() => { setAdding(false); setSearch(''); }}>
            Close search
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        {event.registerTakenAt ? (
          <>
            <span className="text-xs text-muted-foreground">Register taken {safeFormat(event.registerTakenAt, 'EEE d MMM, h:mm a')}</span>
            <button className="text-xs text-primary" disabled={taken.isPending} onClick={() => taken.mutate(false)}>
              Reopen
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">Only ticked names count on commitment reviews.</span>
            <button className={`${primary} h-8 text-xs shrink-0`} disabled={taken.isPending} onClick={() => taken.mutate(true)}>
              Register done
            </button>
          </>
        )}
      </div>
      {qr && <CheckInQrSheet event={event} onClose={() => setQr(false)} />}
    </section>
  );
}
