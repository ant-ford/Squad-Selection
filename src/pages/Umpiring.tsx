import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Copy, Download, MessageCircle } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { DateHeading } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { StatusChip } from '@/components/ui/status-chip';
import { ErrorState } from '@/components/ui/error-state';
import { inputClass } from '@/components/ui/input';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { toneClasses } from '@/lib/statusTone';
import { createUndoQueue, type UndoQueue } from '@/lib/undoQueue';
import { hasPending, pendingKey, pendingLabel, withPending, type PendingAction, type PendingKind } from '@/lib/umpiringPending';
import { hkDateKey } from '@shared/hkDateKey';
import { toCsv } from '@shared/csv';
import { saveCsv } from '@/lib/saveCsv';
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
  reportCsvRows,
  reportGrid,
  similarOutsideNames,
  umpireMark,
  umpiresMessage,
  weekEnd,
  whatsappShareUrl,
  type DutyAssignment,
  type TeamTally,
  type UmpiringReport,
  type UmpireDuty,
  type UmpiringBoard,
} from '@shared/umpiring';

/** The WhatsApp link, dressed as the kit's primary ActionButton (sm). */
const linkButton =
  'inline-flex items-center justify-center gap-1.5 shrink-0 h-10 px-3 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:h-4 [&_svg]:w-4';
const warningText = toneClasses('warning', 'text');

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

// ── Undo ───────────────────────────────────────────────────────────────

/** How long the Undo toast gives before the request is sent. */
const UNDO_MS = 5000;

interface Undoable {
  /** Waiting or being sent: shown as done, with that duty's buttons hidden. */
  pending: PendingAction[];
  schedule: (kind: PendingKind, assignmentId: string) => void;
}

const UndoContext = createContext<Undoable>({ pending: [], schedule: () => {} });
const useUndo = () => useContext(UndoContext);

const sendPending = (p: PendingAction) => (p.kind === 'noShow' ? setNoShow(p.assignmentId, true) : withdrawAssignment(p.assignmentId));

/**
 * Pull out, Withdraw, Remove and No-show wait out a toast with Undo, and are
 * only sent if it isn't tapped (src/lib/umpiringPending.ts says why). A
 * second one, leaving the page, or hiding the tab sends a waiting one at once.
 */
function useUndoable(): Undoable {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction[]>([]);
  const queue = useRef<UndoQueue | null>(null);
  queue.current ??= createUndoQueue(UNDO_MS);
  const drop = (p: PendingAction) => setPending((all) => all.filter((x) => x !== p));

  const schedule = useCallback(
    (kind: PendingKind, assignmentId: string) => {
      const p: PendingAction = { kind, assignmentId };
      const key = pendingKey(p);
      let toastId: string | number = '';
      setPending((all) => [...all.filter((x) => pendingKey(x) !== key), p]);
      queue.current!.add(key, () => {
        toast.dismiss(toastId);
        // Stays in `pending` until the board has reloaded, so the duty doesn't flicker back.
        sendPending(p)
          .catch((err) => toast.error(errorText(err, "Couldn't save that. Try again.")))
          .then(() => queryClient.invalidateQueries({ queryKey: ['umpiring'] }))
          .finally(() => drop(p));
      });
      toastId = toast(pendingLabel[kind], {
        duration: UNDO_MS + 500,
        action: {
          label: 'Undo',
          onClick: () => {
            if (queue.current!.undo(key)) drop(p);
          },
        },
      });
    },
    [queryClient],
  );

  useEffect(() => {
    const q = queue.current!;
    const hidden = () => document.visibilityState === 'hidden' && q.flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', q.flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', q.flush);
      q.flush();
    };
  }, []);

  return useMemo(() => ({ pending, schedule }), [pending, schedule]);
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

/** The outside-umpire list's choice for typing a name not on it. */
const NEW_NAME = '\u0000new';

/** For the coordinator: "· playing 10:45" when a club umpire has a game then. */
function Playing({ duty, personId }: { duty: UmpireDuty; personId: string | null }) {
  const at = personId ? duty.clashes?.[personId] : undefined;
  return at ? <span className={warningText}> · playing {at}</span> : null;
}

/** What an umpire can do with a duty. */
function UmpireActions({ duty, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const action = useUmpiringAction();
  const { schedule } = useUndo();
  const [anyway, setAnyway] = useState(false);
  const mine = duty.assignments.find((a) => a.personId === board.me.personId);
  const taken = confirmedOf(duty);
  if (duty.status === 'cancelled' || isPast(duty)) return null;

  if (mine?.status === 'confirmed') {
    return (
      <div className="flex items-center gap-2">
        <StatusChip tone="success">You're umpiring</StatusChip>
        <ActionButton variant="outline" onClick={() => schedule('pullOut', mine.id)}>
          Pull out
        </ActionButton>
      </div>
    );
  }
  if (taken) return null;
  if (mine?.status === 'offered') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="info">Paid offer sent</StatusChip>
        <ActionButton variant="outline" loading={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
          Free instead
        </ActionButton>
        <ActionButton variant="ghost" onClick={() => schedule('withdrawOffer', mine.id)}>
          Withdraw
        </ActionButton>
      </div>
    );
  }
  if (duty.clash && !anyway) {
    return (
      <ActionButton variant="outline" onClick={() => setAnyway(true)}>
        Take anyway
      </ActionButton>
    );
  }
  if (board.me.onCommitment) {
    return (
      <ActionButton loading={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
        I'll take it
      </ActionButton>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, false))}>
        I'll take it
      </ActionButton>
      <ActionButton variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => takeDuty(duty.id, true))}>
        Paid
      </ActionButton>
    </div>
  );
}

/** The coordinator's controls: confirm an offer, put someone down, take them off, mark a no-show. */
function CoordinatorActions({ duty, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const action = useUmpiringAction();
  const { schedule } = useUndo();
  const [assigning, setAssigning] = useState(false);
  const [who, setWho] = useState('');
  const [outside, setOutside] = useState('');
  // Typing a name not in the list (straight away when there's no list yet).
  const known = board.externalNames ?? [];
  const [typing, setTyping] = useState(known.length === 0);
  const [paid, setPaid] = useState(false);
  const taken = confirmedOf(duty);
  const offers = duty.assignments.filter((a) => a.status === 'offered');
  const past = isPast(duty);
  const chosen = board.umpires?.find((u) => u.personId === who);
  const suggestions = typing ? similarOutsideNames(outside, known) : [];

  if (duty.status === 'cancelled') {
    return taken ? (
      <ActionButton variant="outline" onClick={() => schedule('remove', taken.id)}>
        Remove
      </ActionButton>
    ) : null;
  }

  // `contents`: these sit in the card's status row; the offers and the
  // assign form break onto rows of their own.
  return (
    <div className="contents">
      {taken &&
        (past ? (
          taken.status === 'no_show' ? (
            // Itself the reverse of a no-show, so it is sent straight away.
            <ActionButton variant="ghost" loading={action.isPending} onClick={() => action.mutate(() => setNoShow(taken.id, false))}>
              Undo no-show
            </ActionButton>
          ) : (
            <ActionButton variant="outline" onClick={() => schedule('noShow', taken.id)}>
              No-show
            </ActionButton>
          )
        ) : taken.personId === board.me.personId ? null : (
          // Their own game: "Pull out" is beside it already.
          <ActionButton variant="outline" onClick={() => schedule('remove', taken.id)}>
            Remove
          </ActionButton>
        ))}
      {!taken && offers.length > 0 && (
        <ul className="basis-full space-y-1">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center gap-3 text-sm">
              <span className="text-foreground">
                💰{o.name}
                <Playing duty={duty} personId={o.personId} />
              </span>
              <ActionButton variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => confirmAssignment(o.id))}>
                Confirm
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {!taken &&
        (assigning ? (
          <div className="basis-full rounded-lg border border-border p-2 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">
                Club umpire
                <select
                  className={inputClass}
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
                {typing ? (
                  <input
                    className={inputClass}
                    value={outside}
                    maxLength={60}
                    autoFocus={known.length > 0}
                    placeholder="Name"
                    onChange={(e) => {
                      setOutside(e.target.value);
                      setWho('');
                    }}
                  />
                ) : (
                  <select
                    className={inputClass}
                    value={outside}
                    onChange={(e) => {
                      if (e.target.value === NEW_NAME) {
                        setTyping(true);
                        setOutside('');
                      } else setOutside(e.target.value);
                      setWho('');
                    }}
                  >
                    <option value="">Choose…</option>
                    {known.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    <option value={NEW_NAME}>New name…</option>
                  </select>
                )}
              </label>
            </div>
            {suggestions.length > 0 && (
              <p className={`flex flex-wrap items-center gap-x-3 text-sm ${warningText}`}>
                Did you mean
                {suggestions.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="min-h-10 font-medium underline underline-offset-2"
                    onClick={() => {
                      setOutside(n);
                      setTyping(false);
                    }}
                  >
                    {n}?
                  </button>
                ))}
              </p>
            )}
            {who && !chosen?.onCommitment && (
              <label className="flex items-center gap-2 min-h-10 text-sm text-foreground">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
                Paid
              </label>
            )}
            <div className="flex gap-2">
              <ActionButton
                loading={action.isPending}
                disabled={!who && !outside.trim()}
                onClick={() =>
                  action.mutate(
                    () => (who ? assignDuty(duty.id, { personId: who, paid: paid && !chosen?.onCommitment }) : assignDuty(duty.id, { externalName: outside })),
                    { onSuccess: () => setAssigning(false) },
                  )
                }
              >
                Confirm
              </ActionButton>
              <ActionButton variant="ghost" onClick={() => setAssigning(false)}>
                Cancel
              </ActionButton>
            </div>
          </div>
        ) : (
          <ActionButton variant="outline" onClick={() => setAssigning(true)}>
            Assign
          </ActionButton>
        ))}
    </div>
  );
}

function DutyCard({ duty: loaded, board }: { duty: UmpireDuty; board: UmpiringBoard }) {
  const { pending } = useUndo();
  // While an Undo is open the duty shows as done, without its buttons.
  const busy = hasPending(loaded, pending);
  const duty = withPending(loaded, pending);
  const coordinator = board.access === 'coordinator';
  const taken = confirmedOf(duty);
  const cancelled = duty.status === 'cancelled';
  return (
    <li className={`px-3 py-2 space-y-1 ${cancelled ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{duty.timeTbc ? 'TBC' : safeFormat(duty.matchDate, 'HH:mm')}</span> · {duty.venue || 'Venue TBC'}
            {duty.division && <span className="text-muted-foreground"> · Div {duty.division}</span>}
          </p>
          <p className={`text-sm text-foreground ${cancelled ? 'line-through' : ''}`}>
            {duty.homeTeam} vs {duty.awayTeam}
          </p>
        </div>
        <StatusChip>{duty.dutyTeam} duty</StatusChip>
      </div>
      {/* Status and the buttons share a row, so more duties fit on a screen;
          the coordinator's assign form and paid offers take a row of their own. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className="text-sm mr-auto">
          {cancelled ? (
            <span className={toneClasses('danger', 'text')}>
              Removed by HKHA
              {taken && coordinator ? ` · tell ${taken.name}` : ''}
            </span>
          ) : taken ? (
            <>
              <Who a={taken} />
              {coordinator && <Playing duty={duty} personId={taken.personId} />}
            </>
          ) : (
            <StatusChip tone="warning">Open</StatusChip>
          )}
          {duty.status === 'rescheduled' && <span className="text-muted-foreground"> · Rescheduled</span>}
          {board.me.isUmpire && duty.clash && !cancelled && <span className={warningText}> · ⚠ Your game {duty.clash}</span>}
        </p>
        {!busy && board.me.isUmpire && <UmpireActions duty={duty} board={board} />}
        {!busy && coordinator && <CoordinatorActions duty={duty} board={board} />}
      </div>
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
        <ActionButton variant="outline" icon={<Copy />} onClick={() => copy(text)}>
          Copy
        </ActionButton>
        <a className={linkButton} href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">
          <MessageCircle aria-hidden="true" /> WhatsApp
        </a>
      </div>
    </section>
  );
}

function Messages({ board }: { board: UmpiringBoard }) {
  const { pending } = useUndo();
  const live = board.duties.filter((d) => d.status !== 'cancelled').map((d) => withPending(d, pending));
  if (live.length === 0) return null;
  return (
    <div className="space-y-3">
      <Message title="Umpires group" text={umpiresMessage(live, board.link)} />
      <Message title="Captains group" text={captainsMessage(live)} />
    </div>
  );
}

// ── Season record ──────────────────────────────────────────────────────

const th = 'px-2 py-1.5 font-medium';
const td = 'px-2 py-1.5';

/** George's summary: per duty team, how its duties were covered. */
function TeamTable({ report }: { report: UmpiringReport }) {
  const rows: [string, (t: TeamTally) => number, number][] = [
    ['Outside, paid', (t) => t.outside, report.coveredExternal],
    ['Members, paid', (t) => t.paidMembers, report.coveredPaidMembers],
    ['Free', (t) => t.free, report.coveredFree],
    ['Uncovered', (t) => t.uncovered, report.uncovered],
  ];
  return (
    <section className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-right">
            <th className={`${th} text-left`} />
            {report.byTeam.map((t) => (
              <th key={t.team} className={th}>
                {t.team.replace(/^HKFC\s+/, '')}
              </th>
            ))}
            <th className={th}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(([label, get, total]) => (
            <tr key={label} className="text-right">
              <td className={`${td} text-left text-foreground whitespace-nowrap`}>{label}</td>
              {report.byTeam.map((t) => (
                <td key={t.team} className={td}>
                  {get(t) || ''}
                </td>
              ))}
              <td className={`${td} font-semibold`}>{total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-right font-semibold text-foreground border-t-2 border-foreground/40 bg-muted/50">
            <td className={`${td} text-left whitespace-nowrap`}>Total duties</td>
            {report.byTeam.map((t) => (
              <td key={t.team} className={td}>
                {t.duties}
              </td>
            ))}
            <td className={td}>{report.duties}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function UmpireTable({ report }: { report: UmpiringReport }) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className={th}>Umpire</th>
            <th className={th}>Affiliation</th>
            <th className={`${th} text-right`}>Free</th>
            <th className={`${th} text-right`}>Paid</th>
            <th className={`${th} text-right`}>No-shows</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {report.umpires.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                Nothing umpired yet.
              </td>
            </tr>
          )}
          {report.umpires.map((u) => (
            <tr key={u.personId ?? `x-${u.name}`}>
              <td className={`${td} text-foreground`}>{u.name}</td>
              <td className={`${td} text-muted-foreground`}>{u.external ? 'Outside' : 'HKFC'}</td>
              <td className={`${td} text-right`}>{u.free || ''}</td>
              <td className={`${td} text-right`}>{u.paid || ''}</td>
              <td className={`${td} text-right`}>{u.noShows || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** George's grid: a row per match day, a column per duty team. */
function DayGrid({ report }: { report: UmpiringReport }) {
  const grid = reportGrid(report);
  if (grid.days.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className={th}>Date</th>
            {grid.teams.map((t) => (
              <th key={t} className={th}>
                {t.replace(/^HKFC\s+/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {grid.days.map(({ day, cells }) => (
            <tr key={day}>
              <td className={`${td} text-foreground whitespace-nowrap`}>{safeFormat(noon(day), 'd MMM')}</td>
              {grid.teams.map((t) => (
                <td key={t} className={`${td} whitespace-nowrap`}>
                  {(cells[t] ?? []).join(', ')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SeasonReport() {
  const { data, isLoading, error } = useQuery({ queryKey: ['umpiring', 'report'], queryFn: () => getUmpiringReport(null), staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) return <ErrorState title={errorText(error, 'Could not load the season.')} />;
  const season = data.season.replace(/^(\d{4})-\d{2}(\d{2})$/, '$1-$2');
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ActionButton
          variant="outline"
          icon={<Download />}
          disabled={data.rows.length === 0}
          onClick={() => saveCsv(`umpiring-${season}.csv`, toCsv(reportCsvRows(data)))}
        >
          CSV
        </ActionButton>
      </div>
      {data.byTeam.length > 0 && <TeamTable report={data} />}
      <UmpireTable report={data} />
      <DayGrid report={data} />
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────

const TABS = [
  { value: 'duties', label: 'Duties' },
  { value: 'season', label: 'Season' },
] as const;

/**
 * HKFC's umpiring duties, a week at a time. The club's umpires put their
 * names down; the Umpire Coordinator fills the gaps, sends the week's two
 * WhatsApp messages and keeps the season's record.
 */
export default function Umpiring() {
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const tab = params.get('view') === 'season' ? 'season' : 'duties';
  const undo = useUndoable();
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
      <AppHeader title="Umpire view" />
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : error || !data ? (
          <ErrorState title={errorText(error, 'Could not load the umpiring duties.')} onRetry={() => refetch()} />
        ) : (
          <UndoContext.Provider value={undo}>
            {coordinator && (
              <Tabs
                id="umpiring"
                label="Umpiring views"
                items={TABS}
                value={tab}
                onChange={(v) => setParam('view', v === 'duties' ? null : v)}
              />
            )}
            {tab === 'season' && coordinator ? (
              <TabPanel tabsId="umpiring" value="season">
                <SeasonReport />
              </TabPanel>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <ActionButton
                    variant="outline"
                    iconOnly
                    icon={<ChevronLeft />}
                    disabled={!prev}
                    onClick={() => setParam('week', prev)}
                    aria-label="Previous week"
                  />
                  <p className="flex-1 text-center text-sm font-semibold text-foreground">{weekLabel(data.week)}</p>
                  <ActionButton
                    variant="outline"
                    iconOnly
                    icon={<ChevronRight />}
                    disabled={!next}
                    onClick={() => setParam('week', next)}
                    aria-label="Next week"
                  />
                </div>
                {byDay.length === 0 ? (
                  <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">No duties this week.</p>
                ) : (
                  byDay.map(([day, duties]) => (
                    <section key={day}>
                      <DateHeading date={noon(day)} />
                      <ul className="rounded-xl border border-border bg-card divide-y divide-border">
                        {duties.map((d) => (
                          <DutyCard key={d.id} duty={d} board={data} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
                {data.messages && <Messages board={data} />}
              </>
            )}
          </UndoContext.Provider>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
