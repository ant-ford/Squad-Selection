import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import SignBlock from '@/components/SignBlock';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { getSigningView, getSponsorDrafts, remakeApplicationPdf, sendApplication, signApplication } from '@/api/signing';
import { JOINER_POSITIONS, JOINER_TEAMS } from '@shared/joiners';
import { ROLE_LABEL, SIGN_ROLES, SPONSOR_LEVELS, TURN_BY_STAGE, sponsorProblem, type SignRole, type SigningView, type SponsorAnswers } from '@shared/signing';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground whitespace-pre-line">{value || '–'}</dd>
    </div>
  );
}

/**
 * A new HKFC member's application for its sponsor, Chairman and Membership
 * Officer to sign, in that order (replacing Fillout forms 4 and 5). The
 * sponsor adds their assessment, starting from AI drafts. Once signed (or,
 * for an existing HKFC member, once submitted), the Membership Officer
 * checks the PDF here and sends it on.
 */
export default function SignApplicationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const view = useQuery({ queryKey: ['signing', id], queryFn: () => getSigningView(id) });

  const body = () => {
    if (view.isLoading) return <Skeleton className="h-96 w-full" />;
    if (view.error || !view.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{errorText(view.error)}</p>
          <button onClick={() => void view.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    return <Application v={view.data} />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Membership application">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}

function Application({ v }: { v: SigningView }) {
  const a = v.applicant;
  const turn = TURN_BY_STAGE[v.stage ?? ''];
  // Theirs to sign now; a later signer sees whose turn it is.
  const mine = turn && v.myRoles.includes(turn) ? turn : null;
  const waiting = !mine && turn ? v.myRoles.find((r) => !v.signatures[r].signedAt) : undefined;
  const existing = v.applicationType !== 'New HKFC Member';
  return (
    <>
      <section className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 rounded-full bg-muted overflow-hidden">
          {v.photoUrl && <img src={v.photoUrl} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{v.name}</h1>
          <p className="text-xs text-muted-foreground">
            {v.applicationType}
            {v.categoryType ? ` · ${v.categoryType}` : ''} · submitted {safeFormat(v.submittedAt, 'd MMM yyyy')}
          </p>
          <p className="text-xs text-muted-foreground">{v.stage}</p>
        </div>
      </section>

      <Block title="Their application">
        <dl className="grid sm:grid-cols-2 gap-3">
          <Fact label="Position" value={a.playingPosition} />
          <Fact label="Level they think they play at" value={a.playingLevel.join(', ')} />
          <Fact label="HKHA registering team" value={a.registeredTeam} />
          <Fact label="Team at the start of the season" value={a.selectedTeamSos} />
        </dl>
        <dl className="space-y-3">
          <Fact label="Sports background and involvement" value={a.sportsBackground} />
          <Fact label="Personal and family interests" value={a.personalInterest} />
          {a.trials.length > 0 && (
            <Fact
              label="Trials"
              value={a.trials
                .map((t) => [t.date ? safeFormat(t.date, 'd MMM yyyy') : 'Undated', t.types.join(', '), t.highestDivision].filter(Boolean).join(' · '))
                .join('\n')}
            />
          )}
          {a.participationDetails && <Fact label="How the trials went" value={a.participationDetails} />}
          {a.clubs.length > 0 && <Fact label="Private clubs" value={a.clubs.map((c) => `${c.club}${c.sinceYear ? ` (since ${c.sinceYear})` : ''}`).join('\n')} />}
        </dl>
      </Block>

      {v.sponsorAssessment && (
        <Block title="The sponsor's support">
          <dl className="space-y-3">
            <Fact label="Sports background and achievements" value={v.sponsorAssessment.sportsBackground} />
            <Fact label="Training, coaching and playing" value={v.sponsorAssessment.trainingComments} />
            <Fact label="Can play at" value={v.sponsorAssessment.level} />
          </dl>
        </Block>
      )}

      {!existing && <Block title="Signatures">
        <ul className="space-y-2">
          {SIGN_ROLES.map((r) => {
            const s = v.signatures[r];
            return (
              <li key={r} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    {ROLE_LABEL[r]}
                    {s.name ? `: ${s.name}` : ''}
                  </p>
                  <p className={`text-xs flex items-center gap-1 ${s.signedAt ? 'text-primary' : 'text-muted-foreground'}`}>
                    {s.signedAt ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Signed {safeFormat(s.signedAt, 'd MMM yyyy')}
                      </>
                    ) : (
                      'Not signed yet'
                    )}
                  </p>
                </div>
                {s.signatureUrl && <img src={s.signatureUrl} alt={`${ROLE_LABEL[r]}'s signature`} className="h-10 rounded bg-white object-contain" />}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          The sponsor signs first, then the Chairman, then the Membership Officer, who checks the application and sends it to the Club's membership office.
        </p>
        {waiting && (
          <p className="text-xs text-foreground rounded-md border border-border bg-muted/40 p-2">
            You can sign as {ROLE_LABEL[waiting]} once the {turn === 'sponsor' ? 'sponsor' : ROLE_LABEL[turn!]} has signed. You'll get an email when it's your turn.
          </p>
        )}
      </Block>}

      {v.sending && <SendBlock v={v} sending={v.sending} />}
      {mine === 'sponsor' && <SponsorSign v={v} />}
      {(mine === 'chair' || mine === 'officer') && <OfficerSign v={v} role={mine} />}
    </>
  );
}

/** The PDF to check, and (for a Membership Officer) the buttons to make it again and send it on. */
function SendBlock({ v, sending }: { v: SigningView; sending: NonNullable<SigningView['sending']> }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const done = (view: SigningView) => {
    queryClient.setQueryData(['signing', v.id], view);
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    void queryClient.invalidateQueries({ queryKey: ['membershipBoard'] });
  };
  const remake = useMutation({
    mutationFn: () => remakeApplicationPdf(v.id),
    onSuccess: (view) => {
      toast.success('PDF made again');
      done(view);
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const send = useMutation({
    mutationFn: () => sendApplication(v.id, !!sending.sentAt),
    onSuccess: (view) => {
      toast.success(`Sent to ${sending.recipient}`);
      setConfirming(false);
      done(view);
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const what = sending.document === 'levy' ? 'Section Membership (levy) form' : 'application';
  const busy = remake.isPending || send.isPending;
  return (
    <Block title={sending.document === 'levy' ? 'Levy form for the front desk' : 'Application for the Club'}>
      {sending.pdfUrl ? (
        <a href={sending.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
          Open the {what} (PDF)
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">The PDF is being made. Reload in a minute to see it.</p>
      )}
      {sending.sentAt ? (
        <p className="text-xs flex items-center gap-1 text-primary">
          <Check className="h-3.5 w-3.5" /> Sent to {sending.recipient} ({sending.sentTo}) on {safeFormat(sending.sentAt, 'd MMM yyyy')}
          {sending.sentBy ? ` by ${sending.sentBy}` : ''}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {sending.canSend
            ? `Check every page, then send it to ${sending.recipient} (${sending.to ?? 'no address set'}). It goes in your name, with a copy to you.`
            : `A Membership Officer checks it and sends it to ${sending.recipient}.`}
          {sending.canSend && sending.document === 'levy' ? ' Sending it accepts them as a member of the section.' : ''}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      {sending.canSend && (
        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-border">
          <button
            className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              setProblem(null);
              remake.mutate();
            }}
          >
            {remake.isPending ? 'Making it…' : 'Make the PDF again'}
          </button>
          {confirming ? (
            <>
              <button className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className={primary}
                disabled={busy}
                onClick={() => {
                  setProblem(null);
                  send.mutate();
                }}
              >
                {send.isPending ? 'Sending…' : `Yes, send it${sending.sentAt ? ' again' : ''}`}
              </button>
            </>
          ) : (
            <button className={primary} disabled={busy || !sending.pdfUrl || !sending.to} onClick={() => setConfirming(true)}>
              {sending.sentAt ? 'Send again' : `Send to ${sending.recipient}`}
            </button>
          )}
        </div>
      )}
    </Block>
  );
}

function useSign(v: SigningView, role: SignRole) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sig, answers }: { sig: string | 'saved'; answers?: SponsorAnswers }) => signApplication(v.id, role, sig === 'saved' ? undefined : sig, answers),
    onSuccess: () => {
      toast.success('Signed');
      void queryClient.invalidateQueries({ queryKey: ['signing', v.id] });
      void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
      void queryClient.invalidateQueries({ queryKey: ['membershipBoard'] });
    },
  });
}

function SponsorSign({ v }: { v: SigningView }) {
  const [answers, setAnswers] = useState<SponsorAnswers>({
    playingPosition: v.applicant.playingPosition ?? '',
    team: v.applicant.selectedTeamSos ?? v.applicant.registeredTeam ?? '',
    sportsBackground: v.drafts.sportsBackground ?? '',
    trainingComments: v.drafts.trainingComments ?? '',
    level: '',
  });
  const [sig, setSig] = useState<string | null | 'saved'>(v.savedSignatureUrl ? 'saved' : null);
  const [problem, setProblem] = useState<string | null>(null);
  const sign = useSign(v, 'sponsor');
  // The AI drafts, made the first time the sponsor opens it; boxes they've typed in are left alone.
  const drafts = useQuery({
    queryKey: ['sponsorDrafts', v.id],
    queryFn: () => getSponsorDrafts(v.id),
    enabled: !v.drafts.sportsBackground && !v.drafts.trainingComments,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!drafts.data) return;
    setAnswers((a) => ({
      ...a,
      sportsBackground: a.sportsBackground || drafts.data.sportsBackground || '',
      trainingComments: a.trainingComments || drafts.data.trainingComments || '',
    }));
  }, [drafts.data]);
  const set = (k: keyof SponsorAnswers) => (value: string) => setAnswers((a) => ({ ...a, [k]: value }));
  const submit = () => {
    const bad = sponsorProblem(answers) ?? (!sig ? 'Sign the application.' : null);
    setProblem(bad);
    if (!bad) sign.mutate({ sig: sig!, answers }, { onError: (err) => setProblem(errorText(err)) });
  };
  return (
    <Block title="Your support as sponsor">
      <p className="text-xs text-muted-foreground">
        {drafts.isFetching ? 'Drafting suggestions…' : 'The two statements start from AI drafts based on their application. Check and change them before you sign.'}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="Playing position" value={answers.playingPosition} options={JOINER_POSITIONS} onChange={set('playingPosition')} />
        <Select label="Team they'd play in" value={answers.team} options={JOINER_TEAMS} onChange={set('team')} />
      </div>
      <Area label="Sports background and achievements of the applicant" value={answers.sportsBackground} onChange={set('sportsBackground')} />
      <Area label="Comments on their training, coaching or playing" value={answers.trainingComments} onChange={set('trainingComments')} />
      <Select
        label="In my opinion, the applicant presently has the ability to play or coach at this level, and to represent the Club for the required commitment period"
        value={answers.level}
        options={SPONSOR_LEVELS}
        onChange={set('level')}
      />
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Your signature</p>
        <SignBlock savedUrl={v.savedSignatureUrl} onChange={setSig} />
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end pt-4 border-t border-border">
        <button className={primary} onClick={submit} disabled={sign.isPending}>
          {sign.isPending ? 'Signing…' : 'Sign as sponsor'}
        </button>
      </div>
    </Block>
  );
}

function OfficerSign({ v, role }: { v: SigningView; role: 'chair' | 'officer' }) {
  const [sig, setSig] = useState<string | null | 'saved'>(v.savedSignatureUrl ? 'saved' : null);
  const [problem, setProblem] = useState<string | null>(null);
  const sign = useSign(v, role);
  const submit = () => {
    if (!sig) return setProblem('Sign the application.');
    setProblem(null);
    sign.mutate({ sig }, { onError: (err) => setProblem(errorText(err)) });
  };
  return (
    <Block title={`Sign as ${ROLE_LABEL[role]}`}>
      <SignBlock savedUrl={v.savedSignatureUrl} onChange={setSig} />
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end pt-4 border-t border-border">
        <button className={primary} onClick={submit} disabled={sign.isPending}>
          {sign.isPending ? 'Signing…' : `Sign as ${ROLE_LABEL[role]}`}
        </button>
      </div>
    </Block>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        <span className="text-destructive"> *</span>
      </span>
      <select className={fieldInput} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        <span className="text-destructive"> *</span>
      </span>
      <textarea rows={3} className={`${fieldInput} h-auto py-1.5`} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
