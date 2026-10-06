import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Download, PartyPopper, Plus, QrCode, Search, X } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import FileUpload from '@/components/profile/FileUpload';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ResponseEditor, answerLine, draftOf, statusChip, type Draft } from '@/components/events/EventSheet';
import { eventWhen, fromLocalInput, priceLines, toLocalInput } from '@/components/events/eventText';
import {
  countAudience,
  deleteEvent,
  findPeople,
  getEventResponses,
  getManageView,
  respondToEvent,
  saveEvent,
  searchEventPeople,
  setEventStatus,
  setSocialSecretaries,
  uploadPoster,
  waiveCharge,
} from '@/api/events';
import PaymentsSection from '@/components/events/PaymentsSection';
import { saveCsv } from '@/lib/saveCsv';
import PosterImage from '@/components/events/PosterImage';
import RegisterSection from '@/components/events/RegisterSection';
import CheckInQrSheet from '@/components/events/CheckInQrSheet';
import {
  DEFAULT_AUDIENCE,
  EVENT_GROUPS,
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
  PAYMENT_LABEL,
  PAYMENT_MODES_OFFERED,
  DIETARY,
  MAX_OWN_QUESTIONS,
  SOCIAL_FUNCTIONS,
  answersCsv,
  asksDietary,
  audienceOptions,
  billed,
  registerOpen,
  describeAudience,
  type EventInput,
  type ManageView,
  type ManagedEvent,
  type PaymentMode,
} from '@shared/events';
import type { Selection } from '@shared/emailLists';

const STATUS_BADGE: Record<ManagedEvent['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700',
  cancelled: 'bg-destructive/10 text-destructive',
};
const STATUS_LABEL: Record<ManagedEvent['status'], string> = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' };
const label = 'space-y-1 text-xs font-medium text-foreground';

const eventLink = (id: string) => `${window.location.origin}/?event=${id}`;
const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));

function countsLine(e: ManagedEvent): string {
  const c = e.counts;
  const guests = c.adultGuests + c.childGuests;
  return [`${c.going} going`, `${c.maybe} maybe`, guests ? `${guests} guest${guests === 1 ? '' : 's'}` : '', `${e.invited} invited`].filter(Boolean).join(' · ');
}

// ── The form ─────────────────────────────────────────────────────────────

type Form = {
  type: EventInput['type'];
  title: string;
  socialFunction: string;
  team: string;
  startsAt: string;
  endsAt: string;
  respondBy: string;
  location: string;
  description: string;
  paymentMode: PaymentMode;
  paymentDetails: string;
  memberPrice: string;
  guestsAllowed: boolean;
  maxGuests: string;
  guestAdultPrice: string;
  guestChildPrice: string;
  helpNeeded: string;
  linkUrl: string;
  dietary: boolean;
  dietaryRequired: boolean;
  ownQuestions: { label: string; required: boolean }[];
  audience: Selection;
};

const num = (v: number | null) => (v == null ? '' : String(v));
const formOf = (e: ManagedEvent | null, view: ManageView): Form => ({
  type: e?.type ?? (view.club ? 'social_function' : 'team_social'),
  title: e?.title ?? '',
  socialFunction: e?.socialFunction ?? '',
  team: e?.team ?? (view.club ? '' : view.teams[0] ?? ''),
  startsAt: toLocalInput(e?.startsAt),
  endsAt: toLocalInput(e?.endsAt),
  respondBy: toLocalInput(e?.respondBy),
  location: e?.location ?? '',
  description: e?.description ?? '',
  paymentMode: e?.paymentMode ?? 'free',
  paymentDetails: e?.paymentDetails ?? '',
  memberPrice: num(e?.memberPrice ?? null),
  guestsAllowed: e?.guestsAllowed ?? false,
  maxGuests: num(e?.maxGuests ?? 1),
  guestAdultPrice: num(e?.guestAdultPrice ?? null),
  guestChildPrice: num(e?.guestChildPrice ?? null),
  helpNeeded: e?.helpNeeded ?? '',
  linkUrl: e?.linkUrl ?? '',
  dietary: e ? asksDietary(e.questions) : false,
  dietaryRequired: !!e?.questions.find((q) => q.key === DIETARY.key)?.required,
  ownQuestions: e?.questions.filter((q) => q.key !== DIETARY.key).map((q) => ({ label: q.label, required: !!q.required })) ?? [],
  audience: e?.audience ?? DEFAULT_AUDIENCE,
});

/** A datetime-local value an hour later (read and written on the Hong Kong clock). */
const plusHour = (v: string) => toLocalInput(new Date(Date.parse(fromLocalInput(v)!) + 3_600_000).toISOString());

const priceOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function EventForm({ view, event, onClose, onSaved }: { view: ManageView; event: ManagedEvent | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Form>(() => formOf(event, view));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const [count, setCount] = useState<number | null>(null);
  // The start the end was last defaulted from: picking the end after the start changes fills in an hour later.
  const [endFrom, setEndFrom] = useState(f.startsAt);
  const defaultEnd = () => {
    if (!f.startsAt || endFrom === f.startsAt) return;
    setEndFrom(f.startsAt);
    set({ endsAt: plusHour(f.startsAt) });
  };
  const endBeforeStart = !!f.startsAt && !!f.endsAt && f.endsAt < f.startsAt;
  const lateDeadline = !!f.respondBy && !!f.startsAt && f.respondBy > (f.endsAt || f.startsAt);
  // The invited count, a moment after the groups change.
  useEffect(() => {
    const t = setTimeout(() => {
      countAudience(f.audience, f.team || null)
        .then((r) => setCount(r.count))
        .catch(() => setCount(null));
    }, 400);
    return () => clearTimeout(t);
  }, [f.audience, f.team]);
  const save = useMutation({
    mutationFn: () =>
      saveEvent({
        ...(event ? { id: event.id } : {}),
        type: f.type,
        title: f.title,
        socialFunction: f.type === 'social_function' && f.socialFunction ? (f.socialFunction as EventInput['socialFunction']) : null,
        team: f.team || null,
        startsAt: fromLocalInput(f.startsAt) ?? '',
        endsAt: fromLocalInput(f.endsAt),
        respondBy: fromLocalInput(f.respondBy),
        location: f.location,
        description: f.description,
        paymentMode: f.paymentMode,
        paymentDetails: f.paymentMode === 'payme_fps' ? f.paymentDetails : null,
        memberPrice: priceOrNull(f.memberPrice),
        guestsAllowed: f.guestsAllowed,
        maxGuests: f.guestsAllowed ? Number(f.maxGuests || 1) : null,
        guestAdultPrice: priceOrNull(f.guestAdultPrice),
        guestChildPrice: priceOrNull(f.guestChildPrice),
        helpNeeded: f.helpNeeded,
        linkUrl: f.linkUrl,
        questions: [
          ...(f.dietary ? [{ ...DIETARY, required: f.dietaryRequired }] : []),
          ...f.ownQuestions.filter((q) => q.label.trim()).map((q, i) => ({ key: `q${i + 1}`, label: q.label, required: q.required })),
        ],
        audience: f.audience,
      }),
    onSuccess: (r) => {
      toast.success(event ? 'Event saved' : 'Draft saved: add a poster, then publish it');
      onSaved(r.id);
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const toggle = (key: string, value: string) => {
    const now = f.audience[key] ?? [];
    const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
    const audience = { ...f.audience };
    if (next.length) audience[key] = next;
    else delete audience[key];
    set({ audience });
  };
  const paid = billed(f.paymentMode);
  const selfFunded = f.paymentMode === 'self_funded';

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="p-4 sm:max-w-xl sm:mx-auto">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{event ? 'Edit event' : 'New event'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className={label}>
              Type
              <select className={fieldInput} value={f.type} onChange={(e) => set({ type: e.target.value as Form['type'] })}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Team
              <select className={fieldInput} value={f.team} onChange={(e) => set({ team: e.target.value })}>
                {view.club && <option value="">Club-wide</option>}
                {view.teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {f.type === 'social_function' && (
            <label className={`block ${label}`}>
              Counts for commitments as
              <select className={fieldInput} value={f.socialFunction} onChange={(e) => set({ socialFunction: e.target.value })}>
                <option value="">None of these</option>
                {SOCIAL_FUNCTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={`block ${label}`}>
            Title
            <input className={fieldInput} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Christmas Party" />
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className={label}>
              Starts
              <input type="datetime-local" className={fieldInput} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
            </label>
            <label className={label}>
              Ends (optional)
              <input type="datetime-local" className={fieldInput} value={f.endsAt} min={f.startsAt || undefined} onFocus={defaultEnd} onChange={(e) => set({ endsAt: e.target.value })} />
            </label>
            <label className={label}>
              Answer by (optional)
              <input type="datetime-local" className={fieldInput} value={f.respondBy} max={f.startsAt || undefined} onChange={(e) => set({ respondBy: e.target.value })} />
            </label>
          </div>
          {endBeforeStart && <p className="text-xs text-destructive">It can't end before it starts.</p>}
          {lateDeadline && <p className="text-xs text-destructive">The answer-by date must be before the event ends.</p>}
          <label className={`block ${label}`}>
            Location
            <input className={fieldInput} value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. HKFC Members' Bar" />
          </label>
          <label className={`block ${label}`}>
            Details (optional)
            <textarea className={`${fieldInput} h-24 py-2`} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Dress code, what's included, what to bring" />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className={label}>
              Payment
              <select className={fieldInput} value={f.paymentMode} onChange={(e) => set({ paymentMode: e.target.value as PaymentMode })}>
                {PAYMENT_MODES_OFFERED.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            {(paid || selfFunded) && (
              <label className={label}>
                {selfFunded ? 'Estimated cost each (HK$, optional)' : 'Member price (HK$)'}
                <input type="number" min={0} inputMode="decimal" className={fieldInput} value={f.memberPrice} onChange={(e) => set({ memberPrice: e.target.value })} />
              </label>
            )}
          </div>
          {f.paymentMode === 'payme_fps' && (
            <label className={`block ${label}`}>
              PayMe link or FPS ID to pay to
              <input className={fieldInput} value={f.paymentDetails} onChange={(e) => set({ paymentDetails: e.target.value })} placeholder="e.g. https://payme.hsbc/yourname, or FPS ID 1234567" />
              <span className="block font-normal text-muted-foreground">Everyone invited sees this. Each payer uploads a screenshot of their payment, which Eddy reads for you to confirm.</span>
            </label>
          )}
          {f.paymentMode === 'account' && <p className="text-xs text-muted-foreground">After answers close, download the list (name, membership no., amount) for the treasurer.</p>}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={f.guestsAllowed} onChange={(e) => set({ guestsAllowed: e.target.checked })} />
            Members can bring guests
          </label>
          {f.guestsAllowed && (
            <div className="grid sm:grid-cols-3 gap-3">
              <label className={label}>
                Guests each
                <input type="number" min={1} max={10} className={fieldInput} value={f.maxGuests} onChange={(e) => set({ maxGuests: e.target.value })} />
              </label>
              {paid && (
                <>
                  <label className={label}>
                    Adult guest (HK$)
                    <input type="number" min={0} inputMode="decimal" className={fieldInput} value={f.guestAdultPrice} placeholder="Member price" onChange={(e) => set({ guestAdultPrice: e.target.value })} />
                  </label>
                  <label className={label}>
                    Child guest (HK$)
                    <input type="number" min={0} inputMode="decimal" className={fieldInput} value={f.guestChildPrice} placeholder="Adult guest price" onChange={(e) => set({ guestChildPrice: e.target.value })} />
                  </label>
                </>
              )}
            </div>
          )}
          <label className={`block ${label}`}>
            Link (optional)
            <input className={fieldInput} type="url" inputMode="url" value={f.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} placeholder="e.g. the event's WhatsApp group link" />
          </label>
          <label className={`block ${label}`}>
            Help needed (optional)
            <input className={fieldInput} value={f.helpNeeded} onChange={(e) => set({ helpNeeded: e.target.value })} placeholder="e.g. 3 for the BBQ and setting up" />
          </label>

          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">Ask people for</p>
            <div className="flex items-center gap-2">
              <label className="flex-1 min-w-0 flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" className="mt-1" checked={f.dietary} onChange={(e) => set({ dietary: e.target.checked, dietaryRequired: e.target.checked && f.dietaryRequired })} />
                <span>
                  Dietary requirements
                  {f.guestsAllowed && <span className="block text-xs text-muted-foreground">Theirs and their guests'</span>}
                </span>
              </label>
              {f.dietary && (
                <label className="flex items-center gap-1.5 text-xs text-foreground shrink-0">
                  <input type="checkbox" checked={f.dietaryRequired} onChange={(e) => set({ dietaryRequired: e.target.checked })} />
                  Required
                </label>
              )}
            </div>
            {f.ownQuestions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={`${fieldInput} flex-1`}
                  value={q.label}
                  placeholder="Your question, e.g. T-shirt size"
                  onChange={(e) => set({ ownQuestions: f.ownQuestions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  aria-label={`Question ${i + 1}`}
                />
                <label className="flex items-center gap-1.5 text-xs text-foreground shrink-0">
                  <input type="checkbox" checked={q.required} onChange={(e) => set({ ownQuestions: f.ownQuestions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
                  Required
                </label>
                <button className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label={`Remove question ${i + 1}`} onClick={() => set({ ownQuestions: f.ownQuestions.filter((_, j) => j !== i) })}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {f.ownQuestions.length < MAX_OWN_QUESTIONS && (
              <button className="inline-flex items-center gap-1 text-sm text-primary" onClick={() => set({ ownQuestions: [...f.ownQuestions, { label: '', required: false }] })}>
                <Plus className="h-4 w-4" /> Add a question
              </button>
            )}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Who's invited</p>
              <p className="text-xs text-muted-foreground">{count == null ? '…' : `${count} people`}</p>
            </div>
            <p className="text-xs text-foreground">{describeAudience(f.audience, f.team || null)}</p>
            <p className="text-xs text-muted-foreground">Within a group, any ticked option counts. When you tick in more than one group, people must match all of them. A group with nothing ticked doesn't narrow the list.</p>
            {EVENT_GROUPS.filter((g) => !(f.team && g.key === 'team')).map((g) => {
              const options = audienceOptions(g.key, view.groups[g.key] ?? []);
              if (!options.length) return null;
              return (
                <div key={g.key}>
                  <p className="text-xs font-medium text-foreground mb-1">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map(({ value: o, label: text }) => {
                      const on = f.audience[g.key]?.includes(o) ?? false;
                      return (
                        <button
                          key={o}
                          onClick={() => toggle(g.key, o)}
                          aria-pressed={on}
                          className={`text-xs px-2 py-1 rounded-full border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {problem && (
            <p role="alert" className="text-xs text-destructive whitespace-pre-line">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button className={secondary} onClick={onClose}>
              Cancel
            </button>
            <button className={primary} disabled={save.isPending || !f.title.trim() || !f.startsAt || endBeforeStart || lateDeadline || (f.paymentMode === 'payme_fps' && !f.paymentDetails.trim())} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : event ? 'Save' : 'Save draft'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── One event ────────────────────────────────────────────────────────────

function EventDetailSheet({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (e: ManagedEvent) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['eventResponses', id], queryFn: () => getEventResponses(id) });
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [answering, setAnswering] = useState<{ personId: string; name: string; initial: Draft } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['eventResponses', id] });
    void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
  };
  const status = useMutation({
    mutationFn: (s: 'draft' | 'published' | 'cancelled') => setEventStatus(id, s),
    onSuccess: (_r, s) => {
      toast.success(s === 'published' ? 'Published: share the link on WhatsApp' : s === 'cancelled' ? 'Event cancelled' : 'Back to draft');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: () => deleteEvent(id),
    onSuccess: () => {
      toast.success('Draft deleted');
      void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const waive = useMutation({
    mutationFn: ({ personId, waived }: { personId: string; waived: boolean }) => waiveCharge(id, personId, waived),
    onSuccess: (_r, v) => {
      toast.success(v.waived ? 'Let off the charge' : 'Charged again');
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['eventCharges', id] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const [qr, setQr] = useState(false);
  const answer = useMutation({
    mutationFn: ({ personId, d }: { personId: string; d: Draft }) =>
      respondToEvent(id, { personId, status: d.status!, guests: d.guests, canHelp: d.canHelp, answers: d.answers, notes: d.notes, asManager: true }),
    onSuccess: () => {
      toast.success('Answer saved');
      setAnswering(null);
      setAdding(false);
      setSearch('');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const people = useQuery({
    queryKey: ['eventPeople', id, search.trim()],
    queryFn: () => searchEventPeople(id, search.trim()),
    enabled: adding && search.trim().length >= 2,
  });

  const data = q.data;
  const e = data?.event;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="p-4 sm:max-w-xl sm:mx-auto">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{e?.title ?? 'Event'}</SheetTitle>
        </SheetHeader>
        {!e ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-foreground space-y-1">
              <p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  {EVENT_TYPE_LABEL[e.type]}
                  {e.team ? ` · ${e.team}` : ' · Club-wide'}
                </span>
              </p>
              <p>{eventWhen(e)}</p>
              {e.location && <p className="text-muted-foreground">{e.location}</p>}
              {priceLines(e).length > 0 && <p className="text-muted-foreground">{priceLines(e).join(' · ')}</p>}
              <p className="text-xs text-muted-foreground">{countsLine(e)}</p>
              <p className="text-xs text-muted-foreground">Invited: {describeAudience(e.audience, e.team)}</p>
              {e.includesMe === false && e.status !== 'cancelled' && (
                <p className="text-xs text-amber-700">You're not in this invite list, so it won't show on your player page. Edit who's invited, or use “Answer for someone” below.</p>
              )}
            </div>

            <FileUpload
              kind="document"
              label="Poster"
              hint="A picture: JPEG, PNG or WebP"
              hasFile={!!e.posterUrl}
              onUploaded={refresh}
              upload={(dataUrl) => uploadPoster(id, dataUrl)}
            />
            {e.posterUrl && <PosterImage url={e.posterUrl} title={e.title} className="max-h-64" />}

            <div className="flex flex-wrap gap-2">
              <button className={secondary} onClick={() => onEdit(e)}>
                Edit
              </button>
              {e.status === 'draft' && (
                <button className={primary} disabled={status.isPending} onClick={() => status.mutate('published')}>
                  Publish
                </button>
              )}
              {e.status === 'published' && (
                <button className={secondary} onClick={() => copy(eventLink(id), 'Link')}>
                  <Copy className="h-4 w-4 inline mr-1" /> Copy link for WhatsApp
                </button>
              )}
              {e.status === 'published' && (
                <button className={secondary} onClick={() => setQr(true)}>
                  <QrCode className="h-4 w-4 inline mr-1" /> Check-in QR code
                </button>
              )}
              {e.status === 'cancelled' && (
                <button className={secondary} disabled={status.isPending} onClick={() => status.mutate('published')}>
                  Reopen
                </button>
              )}
              {e.status === 'published' && (
                <button className={`${secondary} text-destructive`} onClick={() => setConfirm('cancel')}>
                  Cancel event
                </button>
              )}
              {e.status === 'published' && data.responses.length === 0 && (
                <button className={secondary} disabled={status.isPending} onClick={() => status.mutate('draft')}>
                  Back to draft
                </button>
              )}
              {e.status === 'draft' && (
                <button className={`${secondary} text-destructive`} onClick={() => setConfirm('delete')}>
                  Delete draft
                </button>
              )}
            </div>

            {e.status === 'published' && registerOpen(e) && <RegisterSection event={e} responses={data.responses} />}
            {qr && <CheckInQrSheet event={e} onClose={() => setQr(false)} />}

            {e.status !== 'draft' && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Answers ({data.responses.length})</h3>
                  {data.responses.some((r) => r.status !== 'not_going') && (
                    <button className="text-xs text-primary inline-flex items-center gap-1" onClick={() => saveCsv(`${e.title.replace(/[^\w ]+/g, '').trim() || 'event'} answers.csv`, answersCsv(e, data.responses))}>
                      <Download className="h-3.5 w-3.5" /> Download answers
                    </button>
                  )}
                </div>
                {data.responses.length === 0 && <p className="text-sm text-muted-foreground">Nobody yet.</p>}
                <ul className="divide-y divide-border">
                  {data.responses.map((r) =>
                    answering?.personId === r.personId ? (
                      <li key={r.personId} className="py-2 space-y-2">
                        <p className="text-sm font-medium text-foreground">{r.name}</p>
                        <ResponseEditor relaxed event={e} initial={answering.initial} saving={answer.isPending} onSave={(d) => answer.mutate({ personId: r.personId, d })} onCancel={() => setAnswering(null)} />
                      </li>
                    ) : (
                      <li key={r.personId} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground flex-1 min-w-0 truncate">{r.name}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusChip[r.status]}`}>{answerLine(r)}</span>
                          <button className="text-xs text-primary" onClick={() => setAnswering({ personId: r.personId, name: r.name, initial: draftOf(r) })}>
                            Change
                          </button>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                          {r.signedUpBy && <p>Signed up by {r.signedUpBy.name}</p>}
                          {r.status !== 'not_going' &&
                            r.guests.map((g, i) => (
                              <p key={i}>
                                + {g.name} ({g.age}){g.dietary ? ` · ${g.dietary}` : ''}
                              </p>
                            ))}
                          {r.status !== 'not_going' &&
                            e.questions.map((q) => (r.answers[q.key] ? <p key={q.key}>{q.label}: {r.answers[q.key]}</p> : null))}
                          {r.canHelp && <p>Can help</p>}
                          {billed(e.paymentMode) && r.status === 'going' && (
                            <p>
                              {r.waived ? 'Let off the charge · ' : ''}
                              <button className="text-primary" disabled={waive.isPending} onClick={() => waive.mutate({ personId: r.personId, waived: !r.waived })}>
                                {r.waived ? 'Charge again' : 'Let off the charge'}
                              </button>
                            </p>
                          )}
                          {r.notes && <p>“{r.notes}”</p>}
                        </div>
                      </li>
                    ),
                  )}
                </ul>
                {answering && !data.responses.some((r) => r.personId === answering.personId) ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Answer for {answering.name}</p>
                    <ResponseEditor relaxed event={e} initial={answering.initial} saving={answer.isPending} onSave={(d) => answer.mutate({ personId: answering.personId, d })} onCancel={() => setAnswering(null)} />
                  </div>
                ) : !adding ? (
                  <button className="inline-flex items-center gap-1.5 text-sm text-primary" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> Answer for someone
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input autoFocus className={`${fieldInput} pl-8`} placeholder="Search by name" value={search} onChange={(ev) => setSearch(ev.target.value)} aria-label="Search by name" />
                    </div>
                    <ul className="divide-y divide-border">
                      {people.data?.people
                        .filter((p) => !p.answer)
                        .map((p) => (
                          <li key={p.personId} className="py-2 flex items-center gap-2">
                            <span className="text-sm text-foreground flex-1 truncate">{p.name}</span>
                            <button className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground" onClick={() => setAnswering({ personId: p.personId, name: p.name, initial: draftOf(null, 'going') })}>
                              Answer
                            </button>
                          </li>
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">On their behalf: they pay for themselves.</p>
                  </div>
                )}
              </section>
            )}

            {billed(e.paymentMode) && e.status !== 'draft' && <PaymentsSection event={e} />}

            {data.notAnswered.length > 0 && (
              <section className="space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Not answered yet ({data.notAnswered.length})</h3>
                  <button className="text-xs text-primary inline-flex items-center gap-1" onClick={() => copy(data.notAnswered.map((p) => p.name).join('\n'), 'Names')}>
                    <Copy className="h-3.5 w-3.5" /> Copy names
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{data.notAnswered.map((p) => p.name).join(', ')}</p>
              </section>
            )}
          </div>
        )}
        {confirm === 'cancel' && (
          <ConfirmDialog
            title="Cancel this event?"
            message="Everyone sees it as cancelled, and it comes out of their calendars. You can reopen it later."
            confirmLabel="Cancel event"
            destructive
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              status.mutate('cancelled');
              setConfirm(null);
            }}
          />
        )}
        {confirm === 'delete' && (
          <ConfirmDialog
            title="Delete this draft?"
            message="The draft and its poster are removed for good."
            confirmLabel="Delete"
            destructive
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              remove.mutate();
              setConfirm(null);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Team social secretaries ──────────────────────────────────────────────

function SocialSecretaries({ view }: { view: ManageView }) {
  const queryClient = useQueryClient();
  const [team, setTeam] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ personId: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['findPeople', search.trim()], queryFn: () => findPeople(search.trim()), enabled: !!team && search.trim().length >= 2 });
  const save = useMutation({
    mutationFn: () => setSocialSecretaries(team!, picked.map((p) => p.personId)),
    onSuccess: () => {
      toast.success('Social secretaries saved');
      setTeam(null);
      void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <h2 className="text-base font-semibold text-foreground">Team social secretaries</h2>
      <ul className="divide-y divide-border">
        {view.socialSecretaries.map((t) => (
          <li key={t.teamId} className="py-2">
            {team === t.team ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{t.team}</p>
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.personId} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-foreground">
                      {p.name}
                      <button aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((x) => x.personId !== p.personId))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <input className={fieldInput} placeholder="Search by name to add" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by name" />
                <ul>
                  {found.data?.people
                    .filter((p) => !picked.some((x) => x.personId === p.personId))
                    .map((p) => (
                      <li key={p.personId}>
                        <button className="w-full text-left text-sm py-1.5 hover:bg-muted rounded px-1" onClick={() => { setPicked([...picked, { personId: p.personId, name: p.name }]); setSearch(''); }}>
                          {p.name} <span className="text-xs text-muted-foreground">{p.team ?? ''}</span>
                        </button>
                      </li>
                    ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <button className={secondary} onClick={() => setTeam(null)}>
                    Cancel
                  </button>
                  <button className={primary} disabled={save.isPending} onClick={() => save.mutate()}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground w-28 shrink-0">{t.team}</span>
                <span className="text-sm text-muted-foreground flex-1 min-w-0 truncate">{t.people.map((p) => p.name).join(', ') || 'None yet'}</span>
                <button className="text-xs text-primary" onClick={() => { setTeam(t.team); setPicked(t.people); setSearch(''); }}>
                  Change
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────

function EventRow({ e, onOpen }: { e: ManagedEvent; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="w-full text-left py-2 flex items-center gap-3 hover:bg-muted/50 rounded-md">
        <div className="h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {e.posterUrl ? <img src={e.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <PartyPopper className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{e.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {eventWhen(e)}
            {e.team ? ` · ${e.team}` : ''}
          </p>
          {e.status !== 'draft' && <p className="text-xs text-muted-foreground truncate">{countsLine(e)}</p>}
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded ${STATUS_BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
      </button>
    </li>
  );
}

/**
 * Special events, for the social secretaries and Section Captains: add an
 * event as a draft, add its poster, publish it and share the link; then
 * see who's coming, who's bringing guests, and who hasn't answered.
 */
export default function ManageEventsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['manageEvents'], queryFn: getManageView, retry: false });
  const [form, setForm] = useState<{ event: ManagedEvent | null } | null>(null);
  const openId = params.get('event');
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set('event', id);
        else p.delete('event');
        return p;
      },
      { replace: !id },
    );

  const body = () => {
    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">{q.error ? errorText(q.error) : 'Events are kept by the social secretaries and Section Captains.'}</p>;
    const view = q.data;
    const now = Date.now();
    const upcoming = view.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) >= now);
    const past = view.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) < now).reverse();
    return (
      <>
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Coming up</h2>
            <button className={primary} onClick={() => setForm({ event: null })}>
              <Plus className="h-4 w-4 inline mr-1" /> New event
            </button>
          </div>
          {upcoming.length ? (
            <ul className="divide-y divide-border">
              {upcoming.map((e) => (
                <EventRow key={e.id} e={e} onOpen={() => setOpen(e.id)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          )}
        </section>
        {past.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-base font-semibold text-foreground">Past two months</h2>
            <ul className="divide-y divide-border">
              {past.map((e) => (
                <EventRow key={e.id} e={e} onOpen={() => setOpen(e.id)} />
              ))}
            </ul>
          </section>
        )}
        {view.club && <SocialSecretaries view={view} />}
        {form && (
          <EventForm
            view={view}
            event={form.event}
            onClose={() => setForm(null)}
            onSaved={(id) => {
              setForm(null);
              void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
              void queryClient.invalidateQueries({ queryKey: ['eventResponses', id] });
              void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
              setOpen(id);
            }}
          />
        )}
        {openId && !form && <EventDetailSheet id={openId} onClose={() => setOpen(null)} onEdit={(e) => setForm({ event: e })} />}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Events" guide="events" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
