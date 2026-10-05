import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Copy, MessageCircle, User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { hkDateKey } from '@shared/hkDateKey';
import {
  assignDuty,
  confirmAssignment,
  getUmpiringBoard,
  getUmpiringReport,
  setNoShow,
  takeDuty,
  withdrawAssignment,
} from '@/api/umpiring';
import {
  captainsMessage,
  confirmedOf,
  umpireMark,
  umpiresMessage,
  weekEnd,
  whatsappShareUrl,
  type DutyAssignment,
  type UmpireDuty,
  type UmpiringBoard,
} from '@shared/umpiring';

const input =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const btn = 'inline-flex items-center justify-center gap-1 h-8 px-3 rounded-md text-xs font-medium disabled:opacity-50';
const primaryBtn = `${btn} bg-primary text-primary-foreground`;
const plainBtn = `${btn} border border-border bg-background text-foreground`;
const linkBtn = 'text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
const noon = (day: string) => `${day}T12:00:00+08:00`;
const weekLabel = (monday: string) => `${safeFormat(noon(monday), 'EEE d MMM')} – ${safeFormat(noon(weekEnd(monday)), 'EEE d MMM')}`;
const isPast = (d: UmpireDuty) => new Date(d.matchDate).getTime() + (d.timeTbc ? 24 * 3600_000 : 0) <= Date.now();

function useUmpiringAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['umpiring'] }),
    onError: (err) => toast.error(errorText(err, "Couldn't save that. Try again.")),
  });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch {
    toast.error("Couldn't copy. Try again.");
  }
}

// ── One duty ───────────────────────────────────────────────────────────

function Who({ a }: { a: DutyAssignment }) {
  return (
    <span className={a.status === 'no_show' ? 'line-through text-muted-foreground' : 'text-foreground'}>
      {umpireMark(a)}
    </span>
  );
}

/** For the coordinator: "· playing 10:45" when a club umpire has a game then. */
function Playing({ duty, personId }: { duty: UmpireDuty; personId: string | null }) {
  const at = personId ? duty.clashes?.[personId] : undefined;
  return at ? <span className="text-amber-600 dark:text-amber-400"> · playing {at}</span> : null;
}

/** What an umpire can do with a duty. */
function UmpireActions({ duty, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const action = useUmpiringAction();
  const [anyway, setAnyway] = useState(false);
  const mine = duty.assignments.find((a) => a.personId === board.me.personId);
  const taken = confirmedOf(duty);
  if (duty.status === 'cancelled' || isPast(duty)) return null;

  if (mine?.status === 'confirmed') {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-primary">You're umpiring</span>
        <button className={linkBtn} disabled={action.isPending} onClick={() => action.mutate(() => withdrawAssignment(mine.id))}>
          Pull out
        </button>
      </div>
    );
  }
  if (taken) return null;
  if (mine?.status === 'offered') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Paid offer sent</span>
        <button className={plainBtn} disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
          Free instead
        </button>
        <button className={linkBtn} disabled={action.isPending} onClick={() => action.mutate(() => withdrawAssignment(mine.id))}>
          Withdraw
        </button>
      </div>
    );
  }
  if (duty.clash && !anyway) {
    return (
      <button className={linkBtn} onClick={() => setAnyway(true)}>
        Take anyway
      </button>
    );
  }
  if (board.me.onCommitment) {
    return (
      <button className={primaryBtn} disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
        I'll take it
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button className={primaryBtn} disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
        I'll take it
      </button>
      <button className={plainBtn} disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, true))}>
        Paid
      </button>
    </div>
  );
}

/** The coordinator's controls: confirm an offer, put someone down, take them off, mark a no-show. */
function CoordinatorActions({ duty, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const action = useUmpiringAction();
  const [assigning, setAssigning] = useState(false);
  const [who, setWho] = useState('');
  const [outside, setOutside] = useState('');
  const [paid, setPaid] = useState(false);
  const taken = confirmedOf(duty);
  const offers = duty.assignments.filter((a) => a.status === 'offered');
  const past = isPast(duty);
  const chosen = board.umpires?.find((u) => u.personId === who);

  if (duty.status === 'cancelled') {
    return taken ? (
      <button className={linkBtn} disabled={action.isPending} onClick={() => action.mutate(() => withdrawAssignment(taken.id))}>
        Remove
      </button>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {taken && (
        <div className="flex flex-wrap items-center gap-3">
          {past ? (
            <button
              className={linkBtn}
              disabled={action.isPending}
              onClick={() => action.mutate(() => setNoShow(taken.id, taken.status !== 'no_show'))}
            >
              {taken.status === 'no_show' ? 'Undo no-show' : 'No-show'}
            </button>
          ) : taken.personId === board.me.personId ? null : (
            // Their own game: "Pull out" is beside it already.
            <button className={linkBtn} disabled={action.isPending} onClick={() => action.mutate(() => withdrawAssignment(taken.id))}>
              Remove
            </button>
          )}
        </div>
      )}
      {!taken && offers.length > 0 && (
        <ul className="space-y-1">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center gap-3 text-xs">
              <span className="text-foreground">
                💰{o.name}
                <Playing duty={duty} personId={o.personId} />
              </span>
              <button className={plainBtn} disabled={action.isPending} onClick={() => action.mutate(() => confirmAssignment(o.id))}>
                Confirm
              </button>
            </li>
          ))}
        </ul>
      )}
      {!taken &&
        (assigning ? (
          <div className="rounded-lg border border-border p-2 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">
                Club umpire
                <select
                  className={input}
                  value={who}
                  onChange={(e) => {
                    setWho(e.target.value);
                    setOutside('');
                  }}
                >
                  <option value="">Choose…</option>
                  {board.umpires?.map((u) => (
                    <option key={u.personId} value={u.personId}>
                      {u.fullName}
                      {duty.clashes?.[u.personId] ? ` · playing ${duty.clashes[u.personId]}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Outside umpire
                <input
                  className={input}
                  list="outside-umpires"
                  value={outside}
                  maxLength={60}
                  onChange={(e) => {
                    setOutside(e.target.value);
                    setWho('');
                  }}
                />
                <datalist id="outside-umpires">
                  {board.externalNames?.map((n) => <option key={n} value={n} />)}
                </datalist>
              </label>
            </div>
            {who && !chosen?.onCommitment && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
                Paid
              </label>
            )}
            <div className="flex gap-2">
              <button
                className={primaryBtn}
                disabled={action.isPending || (!who && !outside.trim())}
                onClick={() =>
                  action.mutate(
                    () => (who ? assignDuty(duty.id, { personId: who, paid: paid && !chosen?.onCommitment }) : assignDuty(duty.id, { externalName: outside })),
                    { onSuccess: () => setAssigning(false) },
                  )
                }
              >
                Confirm
              </button>
              <button className={plainBtn} onClick={() => setAssigning(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className={plainBtn} onClick={() => setAssigning(true)}>
            Assign
          </button>
        ))}
    </div>
  );
}

function DutyCard({ duty, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const coordinator = board.access === 'coordinator';
  const taken = confirmedOf(duty);
  const cancelled = duty.status === 'cancelled';
  return (
    <li className={`px-3 py-2.5 space-y-1.5 ${cancelled ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{duty.timeTbc ? 'TBC' : safeFormat(duty.matchDate, 'HH:mm')}</span> · {duty.venue || 'Venue TBC'}
            {duty.division && <span className="text-muted-foreground"> · Div {duty.division}</span>}
          </p>
          <p className={`text-xs text-muted-foreground ${cancelled ? 'line-through' : ''}`}>
            {duty.homeTeam} v {duty.awayTeam}
          </p>
        </div>
        <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground">{duty.dutyTeam} duty</span>
      </div>
      <p className="text-sm">
        {cancelled ? (
          <span className="text-destructive">
            Removed by HKHA
            {taken && coordinator ? ` · tell ${taken.name}` : ''}
          </span>
        ) : taken ? (
          <>
            <Who a={taken} />
            {coordinator && <Playing duty={duty} personId={taken.personId} />}
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-400 font-medium">Open</span>
        )}
        {duty.status === 'rescheduled' && <span className="text-muted-foreground"> · Rescheduled</span>}
        {board.me.isUmpire && duty.clash && !cancelled && <span className="text-amber-600 dark:text-amber-400"> · ⚠ Your game {duty.clash}</span>}
      </p>
      {board.me.isUmpire && <UmpireActions duty={duty} board={board} />}
      {coordinator && <CoordinatorActions duty={duty} board={board} />}
    </li>
  );
}

// ── The week's WhatsApp messages ───────────────────────────────────────

function Message({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-xs text-foreground font-sans">{text}</pre>
      <div className="flex gap-2">
        <button className={plainBtn} onClick={() => copy(text)}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        <a className={primaryBtn} href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </a>
      </div>
    </section>
  );
}

function Messages({ board }: { board: UmpiringBoard }) {
  const live = board.duties.filter((d) => d.status !== 'cancelled');
  if (live.length === 0) return null;
  return (
    <div className="space-y-3">
      <Message title="Umpires group" text={umpiresMessage(live, board.link)} />
      <Message title="Captains group" text={captainsMessage(live)} />
    </div>
  );
}

// ── Season record ──────────────────────────────────────────────────────

function SeasonReport() {
  const { data, isLoading, error } = useQuery({ queryKey: ['umpiring', 'report'], queryFn: () => getUmpiringReport(null), staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) return <p className="text-sm text-muted-foreground">{errorText(error, 'Could not load the season.')}</p>;
  const tiles: [string, number][] = [
    ['Duties', data.duties],
    ['Free', data.coveredFree],
    ['Paid', data.coveredPaidMembers],
    ['Outside', data.coveredExternal],
    ['Uncovered', data.uncovered],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-border bg-card py-2 text-center">
            <p className="text-lg font-semibold text-foreground">{n}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Umpire</th>
              <th className="px-3 py-2 font-medium text-right">Free</th>
              <th className="px-3 py-2 font-medium text-right">Paid</th>
              <th className="px-3 py-2 font-medium text-right">No-shows</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.umpires.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                  Nothing umpired yet.
                </td>
              </tr>
            )}
            {data.umpires.map((u) => (
              <tr key={u.personId ?? `x-${u.name}`}>
                <td className="px-3 py-1.5 text-foreground">
                  {u.name}
                  {u.external && <span className="text-xs text-muted-foreground"> (outside)</span>}
                </td>
                <td className="px-3 py-1.5 text-right">{u.free || ''}</td>
                <td className="px-3 py-1.5 text-right">{u.paid || ''}</td>
                <td className="px-3 py-1.5 text-right">{u.noShows || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {data.byTeam.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-3">
          <h3 className="text-sm font-semibold text-foreground mb-1">By duty team</h3>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            {data.byTeam.map((t) => (
              <li key={t.team} className="text-foreground">
                {t.team}: {t.duties} {t.duties === 1 ? 'duty' : 'duties'}, {t.free} free
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────

/**
 * HKFC's umpiring duties, a week at a time. The club's umpires put their
 * names down; the Umpire Coordinator fills the gaps, sends the week's two
 * WhatsApp messages and keeps the season's record.
 */
export default function Umpiring() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const tab = params.get('view') === 'season' ? 'season' : 'duties';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['umpiring', 'board', week],
    queryFn: () => getUmpiringBoard(week),
    staleTime: 30_000,
  });
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const byDay = useMemo(() => {
    const days = new Map<string, UmpireDuty[]>();
    for (const d of data?.duties ?? []) {
      const key = hkDateKey(d.matchDate);
      days.set(key, [...(days.get(key) ?? []), d]);
    }
    return [...days.entries()];
  }, [data]);

  const coordinator = data?.access === 'coordinator';
  const at = data ? data.weeks.indexOf(data.week) : -1;
  const prev = data && at > 0 ? data.weeks[at - 1] : null;
  const next = data && at >= 0 && at < data.weeks.length - 1 ? data.weeks[at + 1] : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Umpiring">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : error || !data ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">{errorText(error, 'Could not load the umpiring duties.')}</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : (
          <>
            {coordinator && (
              <div className="flex gap-1 border-b border-border">
                {(['duties', 'season'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setParam('view', v === 'duties' ? null : v)}
                    className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === v ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}
                  >
                    {v === 'duties' ? 'Duties' : 'Season'}
                  </button>
                ))}
              </div>
            )}
            {tab === 'season' && coordinator ? (
              <SeasonReport />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button className={plainBtn} disabled={!prev} onClick={() => setParam('week', prev)} aria-label="Previous week">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <p className="flex-1 text-center text-sm font-semibold text-foreground">{weekLabel(data.week)}</p>
                  <button className={plainBtn} disabled={!next} onClick={() => setParam('week', next)} aria-label="Next week">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {byDay.length === 0 ? (
                  <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">No duties this week.</p>
                ) : (
                  byDay.map(([day, duties]) => (
                    <section key={day}>
                      <h2 className="text-xs font-bold uppercase tracking-wide text-foreground mb-1.5">{safeFormat(noon(day), 'EEEE d MMMM')}</h2>
                      <ul className="rounded-xl border border-border bg-card divide-y divide-border">
                        {duties.map((d) => (
                          <DutyCard key={d.id} duty={d} board={data} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
                {coordinator && <Messages board={data} />}
              </>
            )}
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
