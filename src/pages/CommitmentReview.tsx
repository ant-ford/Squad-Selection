import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import SignBlock from '@/components/SignBlock';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { inputClass } from '@/components/ui/input';
import { errorMessage } from '@/lib/errorMessages';
import { formGaps } from '@/lib/formGaps';
import { useFormGaps } from '@/lib/useFormGaps';
import { ApiError } from '@/lib/apiClient';
import { differs } from '@/lib/drafts';
import { useDraft } from '@/lib/useDraft';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { DRAFT_KEPT_MESSAGE } from '@/lib/unsavedChanges';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import { getReview, submitMemberReport, submitOfficerReview, submitSponsorReview } from '@/api/reviews';
import {
  belowAttendance,
  GAMES_UMPIRED,
  gamesUmpiredChoice,
  PRACTICES,
  RECOMMENDED_REDUCTIONS,
  SOCIAL_FUNCTIONS,
  recordedSocialFunctions,
  type MemberReport,
  type OfficerReview,
  type ReviewView,
  type SponsorReview,
} from '@shared/commitmentReview';

const area = `${inputClass} h-auto min-h-[84px] py-2`;
const shortArea = `${inputClass} h-auto py-2 resize-none`;

const day = (d: string | null | undefined) => safeFormat(d, LONG_DATE);

function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** Ideas for the member's free-text answers (owner request, 2026-09-30). */
const HINTS = {
  otherContributions: 'Team role (captain, vice-captain, social secretary), coaching, helping at club events, kit admin',
  sectionService: 'Team or committee role, coaching, umpiring, organising socials or tours',
  hkfcService: 'HKFC club committees, contributions to other sections, club-wide events, volunteering',
};

function Answer({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground whitespace-pre-wrap">{value || '—'}</p>
    </div>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Shown above a reviewer's form when some answers start from an AI suggestion. */
function DraftNote({ drafts }: { drafts: Record<string, string> }) {
  if (Object.keys(drafts).length === 0) return null;
  return (
    <p className="text-xs rounded-md bg-muted/60 text-muted-foreground px-2 py-1.5">
      Some answers start from a suggested draft. Check and edit them before you sign: what you submit is your review.
    </p>
  );
}

/** What's missing, or why the submission failed: by the button (a toast is easy to miss). */
function SubmitNote({ missing, error }: { missing: string; error: unknown }) {
  if (!missing && !error) return null;
  return (
    <p role="alert" className="text-xs font-medium text-danger-soft-foreground">
      {missing || errorMessage(error, 'submit', { kept: true })}
    </p>
  );
}

// ── Member ──────────────────────────────────────────────────────────────

function MemberForm({ review, onDone }: { review: ReviewView; onDone: (msg: string) => void }) {
  const options = review.options ?? { sponsors: [], officers: [], usualSponsor: null };
  const start: MemberReport = {
    // From the duties Eddy recorded; they can change it.
    gamesUmpired: gamesUmpiredChoice(review.gamesUmpiredInEddy),
    practices: '',
    // Ticked from the events Eddy recorded them at; they can change it.
    socialFunctions: recordedSocialFunctions(review.eventsAttended),
    otherContributions: '',
    sectionService: '',
    hkfcService: '',
    lowParticipationReason: '',
    sponsor: options.usualSponsor ?? '',
    officer: review.officer.office ?? (options.officers.length === 1 ? options.officers[0].id : ''),
  };
  const [form, setForm, clearDraft] = useDraft<MemberReport>(`review-draft:${review.id}:member`, start);
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof MemberReport>(k: K, v: MemberReport[K]) => setForm({ ...form, [k]: v });
  const toggleSocial = (s: string) =>
    set('socialFunctions', form.socialFunctions.includes(s) ? form.socialFunctions.filter((x) => x !== s) : [...form.socialFunctions, s]);
  // Asked only when match attendance is under the commitment's 70%.
  const askReason = belowAttendance(review.attendance.matchesPlayed, review.attendance.matchesTeamPlayed);
  const submit = useMutation({
    mutationFn: () => submitMemberReport(review.id, { ...form, lowParticipationReason: askReason ? form.lowParticipationReason : '' }),
    onSuccess: () => {
      clearDraft();
      const sponsor = options.sponsors.find((s) => s.id === form.sponsor)?.name;
      onDone(`Sent to ${sponsor ?? 'your sponsor'} for their review`);
    },
  });
  const gaps = useFormGaps(
    formGaps([
      [!form.gamesUmpired, { id: 'cr-games', label: 'Games umpired' }],
      [!form.practices, { id: 'cr-practices', label: 'Practices' }],
      [!form.sponsor, { id: 'cr-sponsor', label: 'Sponsor' }],
    ]),
  );
  const leave = useUnsavedChanges(!submit.isSuccess && differs(form, start), DRAFT_KEPT_MESSAGE);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Games umpired" id="cr-games" required>
          <select className={inputClass} value={form.gamesUmpired} onChange={(e) => set('gamesUmpired', e.target.value)}>
            <option value="">Choose…</option>
            {GAMES_UMPIRED.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Practices" id="cr-practices" required>
          <select className={inputClass} value={form.practices} onChange={(e) => set('practices', e.target.value)}>
            <option value="">Choose…</option>
            {PRACTICES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="text-xs text-muted-foreground mb-1">Social functions</legend>
        <div className="flex flex-wrap gap-1.5">
          {SOCIAL_FUNCTIONS.map((s) => {
            const on = form.socialFunctions.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSocial(s)}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
              >
                {s}
              </button>
            );
          })}
        </div>
        {recordedSocialFunctions(review.eventsAttended).length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Ticked from the events Eddy recorded you at. Add any it missed.</p>
        )}
      </fieldset>
      <Field label="Other contributions" hint={HINTS.otherContributions}>
        <textarea className={area} value={form.otherContributions} onChange={(e) => set('otherContributions', e.target.value)} />
      </Field>
      <Field label="Potential for Section service and involvement" hint={HINTS.sectionService}>
        <textarea className={area} value={form.sectionService} onChange={(e) => set('sectionService', e.target.value)} />
      </Field>
      <Field label="Potential for HKFC service and involvement" hint={HINTS.hkfcService}>
        <textarea className={area} value={form.hkfcService} onChange={(e) => set('hkfcService', e.target.value)} />
      </Field>
      {askReason && (
        <Field label="Reason for low participation">
          <textarea className={area} value={form.lowParticipationReason} onChange={(e) => set('lowParticipationReason', e.target.value)} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sponsor" id="cr-sponsor" required>
          <select className={inputClass} value={form.sponsor} onChange={(e) => set('sponsor', e.target.value)}>
            <option value="">Choose…</option>
            {options.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Membership Officer">
          <select className={inputClass} value={form.officer ?? ''} onChange={(e) => set('officer', e.target.value)}>
            <option value="">Choose…</option>
            {options.officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      </div>
      {leave.prompt}
      <SubmitNote missing={gaps.summary} error={submit.error} />
      <ActionButton fullWidth loading={submit.isPending} onClick={() => gaps.check() && setConfirming(true)}>
        Submit Player Statement
      </ActionButton>
      {confirming && (
        <ConfirmDialog
          title="Submit your Player Statement?"
          message="It goes to your sponsor for their review. You can't change it after this."
          confirmLabel="Submit"
          onConfirm={() => {
            setConfirming(false);
            submit.mutate();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function MemberReportView({ review }: { review: ReviewView }) {
  const r = review.report;
  if (!r) return <Waiting>Waiting for {review.member.name.split(' ')[0] || 'the member'} to complete it.</Waiting>;
  return (
    <div className="divide-y divide-border">
      <div className="grid grid-cols-2 gap-3">
        <Answer label="Games umpired" value={r.gamesUmpired} />
        <Answer label="Practices" value={r.practices} />
      </div>
      <Answer label="Social functions" value={r.socialFunctions.join(', ') || 'None'} />
      <Answer label="Other contributions" value={r.otherContributions} />
      <Answer label="Potential for Section service and involvement" value={r.sectionService} />
      <Answer label="Potential for HKFC service and involvement" value={r.hkfcService} />
      {r.lowParticipationReason && <Answer label="Reason for low participation" value={r.lowParticipationReason} />}
    </div>
  );
}

// ── Signing ─────────────────────────────────────────────────────────────

// ── Sponsor ─────────────────────────────────────────────────────────────

function SponsorForm({ review, onDone }: { review: ReviewView; onDone: (msg: string) => void }) {
  const ai = review.drafts ?? {};
  const start = {
    sectionService: ai.sectionService ?? '',
    hkfcService: ai.hkfcService ?? '',
    recommendation: ai.recommendation ?? '',
  };
  const [form, setForm, clearDraft] = useDraft(`review-draft:${review.id}:sponsor`, start);
  const [sig, setSig] = useState<string | null | 'saved'>(review.savedSignatureUrl ? 'saved' : null);
  const [confirming, setConfirming] = useState(false);
  const submit = useMutation({
    mutationFn: () => {
      const body: SponsorReview = { ...form, ...(sig && sig !== 'saved' ? { signature: sig } : {}) };
      return submitSponsorReview(review.id, body);
    },
    onSuccess: () => {
      clearDraft();
      onDone('Sent to the Membership Officer');
    },
  });
  const gaps = useFormGaps(
    formGaps([
      [!form.sectionService.trim(), { id: 'cr-s-section', label: 'Potential for Section service' }],
      [!form.hkfcService.trim(), { id: 'cr-s-hkfc', label: 'Potential for HKFC service' }],
      [!form.recommendation.trim(), { id: 'cr-s-recommendation', label: 'Recommendation' }],
      [!sig, { id: 'cr-signature', label: 'Your signature' }],
    ]),
  );
  const leave = useUnsavedChanges(!submit.isSuccess && (differs(form, start) || (!!sig && sig !== 'saved')), DRAFT_KEPT_MESSAGE);

  return (
    <div className="space-y-3">
      <DraftNote drafts={ai} />
      <Field label="Potential for Section service and involvement" id="cr-s-section" required>
        <textarea className={area} value={form.sectionService} onChange={(e) => setForm({ ...form, sectionService: e.target.value })} />
      </Field>
      <Field label="Potential for HKFC service and involvement" id="cr-s-hkfc" required>
        <textarea className={area} value={form.hkfcService} onChange={(e) => setForm({ ...form, hkfcService: e.target.value })} />
      </Field>
      <Field label="Recommendation" id="cr-s-recommendation" required>
        <textarea className={area} value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} />
      </Field>
      <div id="cr-signature" tabIndex={-1} className="focus:outline-none">
        <SignBlock savedUrl={review.savedSignatureUrl} onChange={setSig} />
      </div>
      {leave.prompt}
      <SubmitNote missing={gaps.summary} error={submit.error} />
      <ActionButton fullWidth loading={submit.isPending} onClick={() => gaps.check() && setConfirming(true)}>
        Sign and submit
      </ActionButton>
      {confirming && (
        <ConfirmDialog
          title="Submit your review?"
          message="It goes to the Membership Officer, who completes the review."
          confirmLabel="Submit"
          onConfirm={() => {
            setConfirming(false);
            submit.mutate();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function SponsorReviewView({ review }: { review: ReviewView }) {
  const r = review.sponsorReview;
  if (!r) return <Waiting>Waiting for {review.sponsor.name ?? 'the sponsor'}.</Waiting>;
  return (
    <div className="divide-y divide-border">
      <Answer label="Potential for Section service and involvement" value={r.sectionService} />
      <Answer label="Potential for HKFC service and involvement" value={r.hkfcService} />
      <Answer label="Recommendation" value={r.recommendation} />
      {r.signatureUrl && (
        <div className="py-1.5">
          <p className="text-xs text-muted-foreground">Signed</p>
          <img src={r.signatureUrl} alt="Sponsor's signature" className="h-16 rounded bg-white object-contain" />
        </div>
      )}
    </div>
  );
}

// ── Membership Officer ──────────────────────────────────────────────────

function OfficerForm({ review, onDone }: { review: ReviewView; onDone: (msg: string) => void }) {
  const ai = review.drafts ?? {};
  const start = {
    playersAvailable: typeof review.teamActivePlayers === 'number' ? String(review.teamActivePlayers) : '',
    optimumPlayers: '',
    isPlayerNeeded: ai.isPlayerNeeded ?? '',
    otherComments: ai.otherComments ?? '',
    otherInformation: ai.otherInformation ?? '',
    recommendedReduction: '',
  };
  const [form, setForm, clearDraft] = useDraft(`review-draft:${review.id}:officer`, start);
  const [sig, setSig] = useState<string | null | 'saved'>(review.savedSignatureUrl ? 'saved' : null);
  const [confirming, setConfirming] = useState(false);
  const submit = useMutation({
    mutationFn: () => {
      const body: OfficerReview = { ...form, ...(sig && sig !== 'saved' ? { signature: sig } : {}) };
      return submitOfficerReview(review.id, body);
    },
    onSuccess: () => {
      clearDraft();
      onDone('Review complete');
    },
  });
  const n = (v: string) => /^\d{1,3}$/.test(v);
  const gaps = useFormGaps(
    formGaps([
      [!n(form.playersAvailable), { id: 'cr-o-available', label: 'Players available' }],
      [!n(form.optimumPlayers), { id: 'cr-o-optimum', label: 'Optimum number of players' }],
      [!form.isPlayerNeeded.trim(), { id: 'cr-o-needed', label: 'Is the player needed?' }],
      [!form.recommendedReduction, { id: 'cr-o-reduction', label: 'Recommended commitment reduction' }],
      [!sig, { id: 'cr-signature', label: 'Your signature' }],
    ]),
  );
  const leave = useUnsavedChanges(!submit.isSuccess && (differs(form, start) || (!!sig && sig !== 'saved')), DRAFT_KEPT_MESSAGE);

  return (
    <div className="space-y-3">
      <DraftNote drafts={ai} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="cr-o-available"
          required
          label={`Players available${review.member.team ? ` for ${review.member.team}` : ''}`}
          hint={typeof review.teamActivePlayers === 'number' ? `${review.teamActivePlayers} active players with ${review.member.team} as their Selected Team` : undefined}
        >
          <input className={inputClass} inputMode="numeric" value={form.playersAvailable} onChange={(e) => setForm({ ...form, playersAvailable: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Optimum number of players" id="cr-o-optimum" required>
          <input className={inputClass} inputMode="numeric" value={form.optimumPlayers} onChange={(e) => setForm({ ...form, optimumPlayers: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <Field label="Is the player needed?" id="cr-o-needed" required>
        <textarea rows={2} className={shortArea} value={form.isPlayerNeeded} onChange={(e) => setForm({ ...form, isPlayerNeeded: e.target.value })} />
      </Field>
      <Field label="Other comments">
        <textarea className={area} value={form.otherComments} onChange={(e) => setForm({ ...form, otherComments: e.target.value })} />
      </Field>
      <Field label="Other relevant information about the candidate">
        <textarea className={area} value={form.otherInformation} onChange={(e) => setForm({ ...form, otherInformation: e.target.value })} />
      </Field>
      <Field label="Recommended commitment reduction" id="cr-o-reduction" required>
        <select className={inputClass} value={form.recommendedReduction} onChange={(e) => setForm({ ...form, recommendedReduction: e.target.value })}>
          <option value="">Choose…</option>
          {RECOMMENDED_REDUCTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <div id="cr-signature" tabIndex={-1} className="focus:outline-none">
        <SignBlock savedUrl={review.savedSignatureUrl} onChange={setSig} />
      </div>
      {leave.prompt}
      <SubmitNote missing={gaps.summary} error={submit.error} />
      <ActionButton fullWidth loading={submit.isPending} onClick={() => gaps.check() && setConfirming(true)}>
        Sign and complete review
      </ActionButton>
      {confirming && (
        <ConfirmDialog
          title="Complete this review?"
          message="The review is marked Complete."
          confirmLabel="Complete"
          onConfirm={() => {
            setConfirming(false);
            submit.mutate();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function OfficerReviewView({ review }: { review: ReviewView }) {
  const r = review.officerReview;
  if (!r) return <Waiting>Waiting for {review.officer.name ?? 'the Membership Officer'}.</Waiting>;
  return (
    <div className="divide-y divide-border">
      <div className="grid grid-cols-2 gap-3">
        <Answer label="Players available" value={r.playersAvailable} />
        <Answer label="Optimum number" value={r.optimumPlayers} />
      </div>
      <Answer label="Is the player needed?" value={r.isPlayerNeeded} />
      <Answer label="Other comments" value={r.otherComments} />
      <Answer label="Other relevant information" value={r.otherInformation} />
      <Answer label="Recommended commitment reduction" value={r.recommendedReduction} />
      {r.signatureUrl && (
        <div className="py-1.5">
          <p className="text-xs text-muted-foreground">Signed</p>
          <img src={r.signatureUrl} alt="Membership Officer's signature" className="h-16 rounded bg-white object-contain" />
        </div>
      )}
      {review.statementPdfUrl !== undefined && (
        <p className="py-2 text-sm">
          {review.statementPdfUrl ? (
            <a href={review.statementPdfUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Signed Player Statement (PDF)
            </a>
          ) : (
            <span className="text-muted-foreground">The signed Player Statement PDF is being made. Reload in a minute to see it.</span>
          )}
        </p>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function CommitmentReview() {
  const { reviewId = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: review, isLoading, error, refetch } = useQuery({
    queryKey: ['review', reviewId],
    queryFn: () => getReview(reviewId),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ['review', reviewId] });
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    void queryClient.invalidateQueries({ queryKey: ['statementBoard'] });
  };

  const roles = review?.roles ?? [];
  const seesSponsor = roles.some((r) => r !== 'member');
  const seesOfficer = roles.includes('officer') || roles.includes('viewer');

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Player statement" back="/" />

      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !review ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">
              {error instanceof ApiError && error.status < 500 ? error.message : 'Could not load this review.'}
            </p>
            {!(error instanceof ApiError && error.status < 500) && (
              <button onClick={() => refetch()} className="text-sm text-primary underline">Try again</button>
            )}
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-border bg-card p-4">
              <p className="text-base font-semibold text-foreground">{review.member.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[review.member.yearNo ? `Year ${review.member.yearNo}` : null, `${day(review.member.periodStart)} – ${day(review.member.periodEnd)}`,
                  review.member.team, review.member.position, review.member.membershipNo ? `No. ${review.member.membershipNo}` : null]
                  .filter(Boolean).join(' · ')}
              </p>
              <p className="text-xs mt-2 inline-block px-2 py-0.5 rounded bg-muted text-foreground">{review.stage}</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[
                  ['Played', review.attendance.matchesPlayed],
                  ['Team played', review.attendance.matchesTeamPlayed],
                  ['Unavailable', review.attendance.matchesNotAvailable],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg bg-muted/50 py-2">
                    <p className="text-lg font-semibold text-foreground">{value ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              {review.attendance.teamsPlayed.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">Teams played: {review.attendance.teamsPlayed.join(', ')}</p>
              )}
              {!!review.gamesUmpiredInEddy && (
                <p className="text-xs text-muted-foreground mt-1">Games umpired (recorded in Eddy): {review.gamesUmpiredInEddy}</p>
              )}
              {!!review.eventsAttended?.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  Events attended (recorded in Eddy): {review.eventsAttended.map((e) => `${e.title} (${safeFormat(e.startsAt, 'd MMM')})`).join(', ')}
                </p>
              )}
            </section>

            <Card title="Player Statement" note={review.report?.submittedAt ? `Submitted ${day(review.report.submittedAt)}` : undefined}>
              {review.canDo === 'member' ? <MemberForm review={review} onDone={done} /> : <MemberReportView review={review} />}
            </Card>

            {seesSponsor && (
              <Card title={`Sponsor's review${review.sponsor.name ? ` (${review.sponsor.name})` : ''}`}
                note={review.sponsorReview?.submittedAt ? `Submitted ${day(review.sponsorReview.submittedAt)}` : undefined}>
                {review.canDo === 'sponsor' ? <SponsorForm review={review} onDone={done} /> : <SponsorReviewView review={review} />}
              </Card>
            )}

            {seesOfficer && (
              <Card title={`Membership Officer's review${review.officer.name ? ` (${review.officer.name})` : ''}`}
                note={review.officerReview?.submittedAt ? `Submitted ${day(review.officerReview.submittedAt)}` : undefined}>
                {review.canDo === 'officer' ? <OfficerForm review={review} onDone={done} /> : <OfficerReviewView review={review} />}
              </Card>
            )}
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
