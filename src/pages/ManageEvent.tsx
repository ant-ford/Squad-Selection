import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Download, Plus, QrCode, Search, X } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import FileUpload from '@/components/profile/FileUpload';
import { errorText } from '@/components/profile/steps';
import { ActionButton } from '@/components/ui/action-button';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Input, inputClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/tabs';
import { ResponseEditor, answerLine, draftOf, statusChip, type Draft } from '@/components/events/EventSheet';
import { EVENT_STATUS_LABEL, countsLine, eventStatusTone, eventWhen, fromLocalInput, priceLines, toLocalInput } from '@/components/events/eventText';
import PaymentsSection from '@/components/events/PaymentsSection';
import { saveCsv } from '@/lib/saveCsv';
import PosterImage from '@/components/events/PosterImage';
import RegisterSection from '@/components/events/RegisterSection';
import CheckInQrSheet from '@/components/events/CheckInQrSheet';
import { differs } from '@/lib/drafts';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { errorMessage } from '@/lib/errorMessages';
import { formGaps } from '@/lib/formGaps';
import { useFormGaps } from '@/lib/useFormGaps';
import {
  countAudience,
  deleteEvent,
  getEventResponses,
  getManageView,
  respondToEvent,
  saveEvent,
  searchEventPeople,
  setEventStatus,
  uploadPoster,
  waiveCharge,
} from '@/api/events';
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

type ResponsesView = Awaited<ReturnType<typeof getEventResponses>>;

const eventLink = (id: string) => `${window.location.origin}/?event=${id}`;
const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));

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

const inputOf = (f: Form, id: string | null): EventInput => ({
  ...(id ? { id } : {}),
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
});

/** A datetime-local value an hour later (read and written on the Hong Kong clock). */
const plusHour = (v: string) => toLocalInput(new Date(Date.parse(fromLocalInput(v)!) + 3_600_000).toISOString());

const priceOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

const checkbox = 'h-4 w-4 accent-[hsl(var(--primary))]';

/** The event's fields. Controlled: the page holds the values, so switching tabs keeps them. */
function EventFields({ view, f, set }: { view: ManageView; f: Form; set: (patch: Partial<Form>) => void }) {
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
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Type">
          <select className={inputClass} value={f.type} onChange={(e) => set({ type: e.target.value as Form['type'] })}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Team">
          <select className={inputClass} value={f.team} onChange={(e) => set({ team: e.target.value })}>
            {view.club && <option value="">Club-wide</option>}
            {view.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {f.type === 'social_function' && (
        <Field label="Counts for commitments as">
          <select className={inputClass} value={f.socialFunction} onChange={(e) => set({ socialFunction: e.target.value })}>
            <option value="">None of these</option>
            {SOCIAL_FUNCTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Title" id="event-title" required>
        <Input name="title" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Christmas Party" />
      </Field>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Starts" id="event-starts" required>
          <Input type="datetime-local" value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
        </Field>
        <Field label="Ends" id="event-ends" error={endBeforeStart ? "It can't end before it starts." : undefined}>
          <Input type="datetime-local" value={f.endsAt} min={f.startsAt || undefined} onFocus={defaultEnd} onChange={(e) => set({ endsAt: e.target.value })} />
        </Field>
        <Field label="Answer by" id="event-answer-by" error={lateDeadline ? 'Must be before the event ends.' : undefined}>
          <Input type="datetime-local" value={f.respondBy} max={f.startsAt || undefined} onChange={(e) => set({ respondBy: e.target.value })} />
        </Field>
      </div>
      <Field label="Location">
        <Input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. HKFC Members' Bar" />
      </Field>
      <Field label="Details">
        <textarea
          className={`${inputClass} h-24 py-2`}
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Dress code, what's included, what to bring"
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Payment">
          <select className={inputClass} value={f.paymentMode} onChange={(e) => set({ paymentMode: e.target.value as PaymentMode })}>
            {PAYMENT_MODES_OFFERED.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        {(paid || selfFunded) && (
          <Field label={selfFunded ? 'Estimated cost each (HK$, optional)' : 'Member price (HK$)'}>
            <Input type="number" min={0} inputMode="decimal" value={f.memberPrice} onChange={(e) => set({ memberPrice: e.target.value })} />
          </Field>
        )}
      </div>
      {f.paymentMode === 'payme_fps' && (
        <Field
          label="PayMe link or FPS ID to pay to"
          id="event-pay-to"
          hint="Everyone invited sees this. Each payer uploads a screenshot of their payment, which Eddy reads for you to confirm."
          required
        >
          <Input value={f.paymentDetails} onChange={(e) => set({ paymentDetails: e.target.value })} placeholder="e.g. https://payme.hsbc/yourname, or FPS ID 1234567" />
        </Field>
      )}
      {f.paymentMode === 'account' && <p className="text-xs text-muted-foreground">After answers close, download the list (name, membership no., amount) for the treasurer.</p>}
      <label className="flex items-center gap-2 min-h-10 text-sm text-foreground">
        <input type="checkbox" className={checkbox} checked={f.guestsAllowed} onChange={(e) => set({ guestsAllowed: e.target.checked })} />
        Members can bring guests
      </label>
      {f.guestsAllowed && (
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Guests each">
            <Input type="number" min={1} max={10} value={f.maxGuests} onChange={(e) => set({ maxGuests: e.target.value })} />
          </Field>
          {paid && (
            <>
              <Field label="Adult guest (HK$)">
                <Input type="number" min={0} inputMode="decimal" value={f.guestAdultPrice} placeholder="Member price" onChange={(e) => set({ guestAdultPrice: e.target.value })} />
              </Field>
              <Field label="Child guest (HK$)">
                <Input type="number" min={0} inputMode="decimal" value={f.guestChildPrice} placeholder="Adult guest price" onChange={(e) => set({ guestChildPrice: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      )}
      <Field label="Link">
        <Input type="url" inputMode="url" value={f.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} placeholder="e.g. the event's WhatsApp group link" />
      </Field>
      <Field label="Help needed">
        <Input value={f.helpNeeded} onChange={(e) => set({ helpNeeded: e.target.value })} placeholder="e.g. 3 for the BBQ and setting up" />
      </Field>

      <fieldset className="rounded-lg border border-border p-3 space-y-2">
        <legend className="px-1 text-sm font-semibold text-foreground">Ask people for</legend>
        <div className="flex items-center gap-2">
          <label className="flex-1 min-w-0 flex items-start gap-2 min-h-10 text-sm text-foreground">
            <input type="checkbox" className={`${checkbox} mt-0.5`} checked={f.dietary} onChange={(e) => set({ dietary: e.target.checked, dietaryRequired: e.target.checked && f.dietaryRequired })} />
            <span>
              Dietary requirements
              {f.guestsAllowed && <span className="block text-xs text-muted-foreground">Theirs and their guests'</span>}
            </span>
          </label>
          {f.dietary && (
            <label className="flex items-center gap-1.5 min-h-10 text-xs text-foreground shrink-0">
              <input type="checkbox" className={checkbox} checked={f.dietaryRequired} onChange={(e) => set({ dietaryRequired: e.target.checked })} />
              Required
            </label>
          )}
        </div>
        {f.ownQuestions.map((q, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={q.label}
              placeholder="Your question, e.g. T-shirt size"
              onChange={(e) => set({ ownQuestions: f.ownQuestions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              aria-label={`Question ${i + 1}`}
            />
            <label className="flex items-center gap-1.5 min-h-10 text-xs text-foreground shrink-0">
              <input type="checkbox" className={checkbox} checked={q.required} onChange={(e) => set({ ownQuestions: f.ownQuestions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
              Required
            </label>
            <ActionButton
              variant="ghost"
              iconOnly
              icon={<X />}
              aria-label={`Remove question ${i + 1}`}
              onClick={() => set({ ownQuestions: f.ownQuestions.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        {f.ownQuestions.length < MAX_OWN_QUESTIONS && (
          <ActionButton variant="ghost" icon={<Plus />} className="text-primary" onClick={() => set({ ownQuestions: [...f.ownQuestions, { label: '', required: false }] })}>
            Add a question
          </ActionButton>
        )}
      </fieldset>

      <fieldset className="rounded-lg border border-border p-3 space-y-2">
        <legend className="px-1 text-sm font-semibold text-foreground">Who's invited</legend>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-foreground">{describeAudience(f.audience, f.team || null)}</p>
          <p className="text-xs text-muted-foreground shrink-0">{count == null ? '…' : `${count} people`}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Within a group, any ticked option counts. When you tick in more than one group, people must match all of them. A group with nothing ticked doesn't narrow the list.
        </p>
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
                      type="button"
                      onClick={() => toggle(g.key, o)}
                      aria-pressed={on}
                      className={`min-h-10 text-xs px-3 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}

// ── The tabs of a saved event ────────────────────────────────────────────

/** Status buttons and the poster: the top of the Details tab. */
function StatusAndPoster({ e, data, onDeleted }: { e: ManagedEvent; data: ResponsesView; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const id = e.id;
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [qr, setQr] = useState(false);
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
      onDeleted();
    },
    onError: (err) => toast.error(errorText(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {e.status === 'draft' && (
          <ActionButton loading={status.isPending} onClick={() => status.mutate('published')}>
            Publish
          </ActionButton>
        )}
        {e.status === 'published' && (
          <ActionButton variant="outline" icon={<Copy />} onClick={() => copy(eventLink(id), 'Link')}>
            Copy link for WhatsApp
          </ActionButton>
        )}
        {e.status === 'published' && (
          <ActionButton variant="outline" icon={<QrCode />} onClick={() => setQr(true)}>
            Check-in QR code
          </ActionButton>
        )}
        {e.status === 'cancelled' && (
          <ActionButton variant="outline" disabled={status.isPending} onClick={() => status.mutate('published')}>
            Reopen
          </ActionButton>
        )}
        {e.status === 'published' && data.responses.length === 0 && (
          <ActionButton variant="outline" disabled={status.isPending} onClick={() => status.mutate('draft')}>
            Back to draft
          </ActionButton>
        )}
        {e.status === 'published' && (
          <ActionButton variant="outline" className="text-danger-soft-foreground" onClick={() => setConfirm('cancel')}>
            Cancel event
          </ActionButton>
        )}
        {e.status === 'draft' && (
          <ActionButton variant="outline" className="text-danger-soft-foreground" onClick={() => setConfirm('delete')}>
            Delete draft
          </ActionButton>
        )}
      </div>
      {e.includesMe === false && e.status !== 'cancelled' && (
        <p className="text-xs rounded-md bg-warning-soft text-warning-soft-foreground px-3 py-2">
          You're not in this invite list, so it won't show on your player page. Edit who's invited, or use “Answer for someone” under Answers.
        </p>
      )}
      <FileUpload kind="document" label="Poster" hint="A picture: JPEG, PNG or WebP" hasFile={!!e.posterUrl} onUploaded={refresh} upload={(dataUrl) => uploadPoster(id, dataUrl)} />
      {e.posterUrl && <PosterImage url={e.posterUrl} title={e.title} className="max-h-64" />}
      {qr && <CheckInQrSheet event={e} onClose={() => setQr(false)} />}
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
    </div>
  );
}

/** Who's answered, answering for someone, and who hasn't answered. */
function AnswersPanel({ e, data }: { e: ManagedEvent; data: ResponsesView }) {
  const queryClient = useQueryClient();
  const id = e.id;
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [answering, setAnswering] = useState<{ personId: string; name: string; initial: Draft } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['eventResponses', id] });
    void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
  };
  const waive = useMutation({
    mutationFn: ({ personId, waived }: { personId: string; waived: boolean }) => waiveCharge(id, personId, waived),
    onSuccess: (_r, v) => {
      toast.success(v.waived ? 'Let off the charge' : 'Charged again');
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['eventCharges', id] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
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

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-end gap-2">
          <h2 className="sr-only">Answers ({data.responses.length})</h2>
          {data.responses.some((r) => r.status !== 'not_going') && (
            <ActionButton
              variant="ghost"
              icon={<Download />}
              className="text-primary"
              onClick={() => saveCsv(`${e.title.replace(/[^\w ]+/g, '').trim() || 'event'} answers.csv`, answersCsv(e, data.responses))}
            >
              Download
            </ActionButton>
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
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusChip[r.status]}`}>{answerLine(r)}</span>
                  <ActionButton variant="ghost" className="text-primary" onClick={() => setAnswering({ personId: r.personId, name: r.name, initial: draftOf(r) })}>
                    Change
                  </ActionButton>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                  {r.signedUpBy && <p>Signed up by {r.signedUpBy.name}</p>}
                  {r.status !== 'not_going' &&
                    r.guests.map((g, i) => (
                      <p key={i}>
                        + {g.name} ({g.age}){g.dietary ? ` · ${g.dietary}` : ''}
                      </p>
                    ))}
                  {r.status !== 'not_going' && e.questions.map((q) => (r.answers[q.key] ? <p key={q.key}>{q.label}: {r.answers[q.key]}</p> : null))}
                  {r.canHelp && <p>Can help</p>}
                  {billed(e.paymentMode) && r.status === 'going' && (
                    <p>
                      {r.waived ? 'Let off the charge · ' : ''}
                      <button className="text-primary min-h-10" disabled={waive.isPending} onClick={() => waive.mutate({ personId: r.personId, waived: !r.waived })}>
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
          <ActionButton variant="ghost" icon={<Plus />} className="text-primary" onClick={() => setAdding(true)}>
            Answer for someone
          </ActionButton>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input autoFocus className="pl-9" placeholder="Search by name" value={search} onChange={(ev) => setSearch(ev.target.value)} aria-label="Search by name" />
            </div>
            <ul className="divide-y divide-border">
              {people.data?.people
                .filter((p) => !p.answer)
                .map((p) => (
                  <li key={p.personId} className="py-2 flex items-center gap-2">
                    <span className="text-sm text-foreground flex-1 truncate">{p.name}</span>
                    <ActionButton onClick={() => setAnswering({ personId: p.personId, name: p.name, initial: draftOf(null, 'going') })}>Answer</ActionButton>
                  </li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">On their behalf: they pay for themselves.</p>
          </div>
        )}
      </section>

      {data.notAnswered.length > 0 && (
        <section className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Not answered yet ({data.notAnswered.length})</h2>
            <ActionButton variant="ghost" icon={<Copy />} className="text-primary" onClick={() => copy(data.notAnswered.map((p) => p.name).join('\n'), 'Names')}>
              Copy names
            </ActionButton>
          </div>
          <p className="text-xs text-muted-foreground">{data.notAnswered.map((p) => p.name).join(', ')}</p>
        </section>
      )}
    </div>
  );
}

type TabKey = 'details' | 'answers' | 'payments' | 'register';

/**
 * One event: its details (editable), then for a saved event the answers,
 * payments and the register as tabs. A page rather than a sheet, so a tap
 * outside can't throw away an edit; leaving with unsaved changes asks first.
 */
function EventEditor({ view, data }: { view: ManageView; data: ResponsesView | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const e = data?.event ?? null;
  const [baseline, setBaseline] = useState<Form>(() => formOf(e, view));
  const [f, setF] = useState<Form>(baseline);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = differs(f, baseline);
  const leave = useUnsavedChanges(dirty);

  const save = useMutation({
    mutationFn: () => saveEvent(inputOf(f, e?.id ?? null)),
    onSuccess: (r) => {
      toast.success(e ? 'Event saved' : 'Draft saved: add a poster, then publish it');
      setBaseline(f);
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
      void queryClient.invalidateQueries({ queryKey: ['eventResponses', r.id] });
      void queryClient.invalidateQueries({ queryKey: ['myEvents'] });
      if (!e) {
        leave.allowNavigation();
        navigate(`/events/manage/${r.id}`, { replace: true });
      }
    },
    onError: (err) => setProblem(errorMessage(err, 'save')),
  });
  const endBeforeStart = !!f.startsAt && !!f.endsAt && f.endsAt < f.startsAt;
  const lateDeadline = !!f.respondBy && !!f.startsAt && f.respondBy > (f.endsAt || f.startsAt);
  const gaps = useFormGaps(
    formGaps([
      [!f.title.trim(), { id: 'event-title', label: 'Title' }],
      [!f.startsAt, { id: 'event-starts', label: 'Starts' }],
      [endBeforeStart, { id: 'event-ends', label: 'An end after the start' }],
      [lateDeadline, { id: 'event-answer-by', label: 'An answer-by date before it ends' }],
      [f.paymentMode === 'payme_fps' && !f.paymentDetails.trim(), { id: 'event-pay-to', label: 'PayMe link or FPS ID' }],
    ]),
  );

  // Only the tabs that apply: answers once it's out, payments for a paid one, the register while it's open.
  const tabs: TabItem<TabKey>[] = e
    ? [
        { value: 'details', label: 'Details' },
        ...(e.status !== 'draft' ? [{ value: 'answers' as const, label: `Answers (${data!.responses.length})` }] : []),
        ...(e.status !== 'draft' && billed(e.paymentMode) ? [{ value: 'payments' as const, label: 'Payments' }] : []),
        ...(e.status === 'published' && registerOpen(e) ? [{ value: 'register' as const, label: 'Register' }] : []),
      ]
    : [];
  const asked = params.get('tab') as TabKey | null;
  const tab: TabKey = tabs.some((t) => t.value === asked) ? asked! : 'details';
  const setTab = (t: TabKey) =>
    setParams(
      (p) => {
        if (t === 'details') p.delete('tab');
        else p.set('tab', t);
        return p;
      },
      { replace: true },
    );

  const details = (
    <div className="space-y-4">
      {e && data && (
        <StatusAndPoster
          e={e}
          data={data}
          onDeleted={() => {
            leave.allowNavigation();
            navigate('/events/manage', { replace: true });
          }}
        />
      )}
      <EventFields view={view} f={f} set={set} />
      {(gaps.summary || problem) && (
        <p role="alert" className="text-xs font-medium text-danger-soft-foreground whitespace-pre-line">
          {gaps.summary || problem}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        {e && dirty && (
          <ActionButton variant="outline" onClick={() => setF(baseline)} disabled={save.isPending}>
            Undo changes
          </ActionButton>
        )}
        <ActionButton loading={save.isPending} disabled={!!e && !dirty} onClick={() => gaps.check() && save.mutate()}>
          {e ? 'Save' : 'Save draft'}
        </ActionButton>
      </div>
    </div>
  );

  return (
    <>
      {leave.prompt}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <h2 className="flex-1 min-w-0 text-lg font-semibold text-foreground">{e ? e.title : 'New event'}</h2>
            {e && <StatusChip tone={eventStatusTone(e.status)}>{EVENT_STATUS_LABEL[e.status]}</StatusChip>}
          </div>
          {e && (
            <>
              <p className="text-sm text-foreground">{eventWhen(e)}</p>
              <p className="text-xs text-muted-foreground">
                {EVENT_TYPE_LABEL[e.type]}
                {e.team ? ` · ${e.team}` : ' · Club-wide'}
                {e.location ? ` · ${e.location}` : ''}
              </p>
              {priceLines(e).length > 0 && <p className="text-xs text-muted-foreground">{priceLines(e).join(' · ')}</p>}
              {e.status !== 'draft' && <p className="text-xs text-muted-foreground">{countsLine(e)}</p>}
            </>
          )}
        </div>
        {tabs.length > 1 && <Tabs id="event" label="Event" items={tabs} value={tab} onChange={setTab} />}
        {tabs.length > 1 ? (
          <TabPanel tabsId="event" value={tab}>
            {tab === 'details' && details}
            {tab === 'answers' && e && data && <AnswersPanel e={e} data={data} />}
            {tab === 'payments' && e && <PaymentsSection event={e} />}
            {tab === 'register' && e && data && <RegisterSection event={e} responses={data.responses} />}
          </TabPanel>
        ) : (
          details
        )}
      </section>
    </>
  );
}

/** /events/manage/new and /events/manage/:id (the social secretaries and Section Captains). */
export default function ManageEventPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const view = useQuery({ queryKey: ['manageEvents'], queryFn: getManageView, retry: false });
  const detail = useQuery({ queryKey: ['eventResponses', id], queryFn: () => getEventResponses(id), enabled: !isNew });

  const body = () => {
    if (view.isLoading || (!isNew && detail.isLoading)) return <Skeleton className="h-96 w-full" />;
    const failed = view.error ?? (isNew ? null : detail.error);
    if (failed || !view.data || (!isNew && !detail.data)) {
      return (
        <ErrorState
          title="Could not load this event"
          message={failed ? errorText(failed) : undefined}
          onRetry={() => void Promise.all([view.refetch(), isNew ? null : detail.refetch()])}
        />
      );
    }
    return <EventEditor key={id} view={view.data} data={isNew ? null : detail.data!} />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title={isNew ? "New event" : "Event"} back="/events/manage" guide="events" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
