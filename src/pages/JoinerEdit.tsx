import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Mail } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import PhoneInput from '@/components/profile/PhoneInput';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { differs } from '@/lib/drafts';
import { useDraft } from '@/lib/useDraft';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { DRAFT_KEPT_MESSAGE } from '@/lib/unsavedChanges';
import { createJoiner, getJoiner, getJoinerOptions, inviteJoiner, requestJoinerStep, updateJoiner } from '@/api/joiners';
import { declineRegistration, invitePracticeTrial } from '@/api/trials';
import {
  APPLICATION_TYPES,
  CATEGORY_TYPES,
  EMPTY_JOINER,
  JOINER_GENDERS,
  JOINER_POSITIONS,
  JOINER_TEAMS,
  PLAYER_COACH,
  joinerProblem,
  type JoinerForm,
  type JoinerOptions,
  type JoinerStepKey,
  type JoinerStepState,
  type JoinerView,
  type OfficeChoice,
} from '@shared/joiners';

/** Stages after the applicant has submitted: the invitation can't be sent again. */
const PAST_INVITATION = ['3. Club Application (Signed)', '4. Sponsor (Signed)', '5. Chairman (Signed)', '6. Membership Officer (Signed)', 'Accepted'];

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </div>
  );
}

function Pick({ value, options, onChange, placeholder = 'Choose…' }: { value: string; options: readonly string[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select className={fieldInput} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function OfficePick({ value, options, onChange, placeholder = 'Choose…' }: { value: string; options: OfficeChoice[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select className={fieldInput} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
          {o.designation ? ` (${o.designation})` : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Propose a new joiner, or change one (Fillout forms 1 and 2), and send the
 * Section Captain's three emails: the invitation, the kit request and the
 * HKHA registration request.
 */
export default function JoinerEditPage() {
  const { id } = useParams();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  // The planning section is the Section Captains office, on the Supabase backend only.
  const allowed = profile?.sections?.includes('planning') ?? false;
  const options = useQuery({ queryKey: ['joinerOptions'], queryFn: getJoinerOptions, enabled: allowed });
  const view = useQuery({ queryKey: ['joiner', id], queryFn: () => getJoiner(id!), enabled: allowed && !!id });

  const body = () => {
    if (profileLoading || options.isLoading || view.isLoading) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-sm text-muted-foreground">Proposing new joiners is for Section Captains.</p>;
    if (options.error || view.error || !options.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{errorText(options.error ?? view.error)}</p>
          <button onClick={() => void Promise.all([options.refetch(), view.refetch()])} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    return <Editor key={id ?? 'new'} view={view.data ?? null} options={options.data} />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title={id ? 'New joiner' : 'Propose a new joiner'} back="/membership" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}

function Editor({ view, options }: { view: JoinerView | null; options: JoinerOptions }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // What's saved; the form is "changed" while it differs from this.
  const [baseline, setBaseline] = useState<JoinerForm>(view?.form ?? EMPTY_JOINER);
  // Kept on this device until saved, so a dropped connection or a reload loses nothing.
  const [form, setForm, clearDraft] = useDraft<JoinerForm>(user ? `draft:joiner:${user.id}:${view?.id ?? 'new'}` : null, baseline);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof JoinerForm>(k: K) => (v: JoinerForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const leave = useUnsavedChanges(differs(form, baseline), DRAFT_KEPT_MESSAGE);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['joiner'] });
    void queryClient.invalidateQueries({ queryKey: ['membershipBoard'] });
  };

  const save = useMutation({
    mutationFn: (invite: boolean) => (view ? updateJoiner(view.id, form).then(() => ({ id: view.id, invited: false })) : createJoiner(form, invite)),
    onSuccess: (r) => {
      clearDraft();
      setBaseline(form);
      refresh();
      toast.success(r.invited ? 'Saved, and the invitation has gone' : 'Saved');
      setProblem(null);
      if (!view) {
        leave.allowNavigation();
        navigate(`/joiners/${r.id}`, { replace: true });
      }
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const submit = (invite: boolean) => {
    const bad = joinerProblem(form);
    setProblem(bad);
    if (!bad) save.mutate(invite);
  };

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="text-base font-semibold text-foreground">{view ? form.preferredName || 'New joiner' : 'Propose a new joiner'}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Type of application" required>
            <Pick value={form.applicantType} options={APPLICATION_TYPES} onChange={set('applicantType')} />
          </Field>
          <Field label="Application category" required>
            <Pick value={form.categoryType} options={CATEGORY_TYPES} onChange={set('categoryType')} />
          </Field>
          <Field label="Email" required>
            <input className={fieldInput} type="email" autoComplete="off" value={form.email} onChange={(e) => set('email')(e.target.value)} />
          </Field>
          <Field label="Preferred name" required>
            <input className={fieldInput} value={form.preferredName} onChange={(e) => set('preferredName')(e.target.value)} />
          </Field>
          <Field label="Gender" required>
            <Pick value={form.gender} options={JOINER_GENDERS} onChange={set('gender')} />
          </Field>
          <Field label="Mobile no.">
            <PhoneInput value={form.mobileNo || null} onChange={set('mobileNo')} />
          </Field>
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-xs font-medium text-foreground">
              Player or coach<span className="text-destructive"> *</span>
            </legend>
            <div className="flex gap-4">
              {PLAYER_COACH.map((o) => (
                <label key={o} className="flex gap-2 items-center text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={form.playerCoach.includes(o)}
                    onChange={(e) => set('playerCoach')(e.target.checked ? [...form.playerCoach, o] : form.playerCoach.filter((x) => x !== o))}
                  />
                  {o}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Playing position" required>
            <Pick value={form.playingPosition} options={JOINER_POSITIONS} onChange={set('playingPosition')} />
          </Field>
          <Field label="HKHA registering team" required>
            <Pick value={form.registeredTeam} options={JOINER_TEAMS} onChange={set('registeredTeam')} />
          </Field>
          <Field label="Team at the start of the season">
            <Pick value={form.selectedTeamSos} options={JOINER_TEAMS} onChange={set('selectedTeamSos')} placeholder="Not yet" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border">
          <Field label="Application sponsor" required>
            <OfficePick value={form.sponsorId} options={options.sponsors} onChange={set('sponsorId')} />
          </Field>
          <Field label="Membership Officer" required>
            <OfficePick value={form.officerId} options={options.officers} onChange={set('officerId')} />
          </Field>
          <Field label="Chairman" required>
            <OfficePick value={form.chairId} options={options.chairs} onChange={set('chairId')} />
          </Field>
        </div>
        {leave.prompt}
        {problem && (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-border">
          {view ? (
            <button className={primary} onClick={() => submit(false)} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <>
              <button className={secondary} onClick={() => submit(false)} disabled={save.isPending}>
                Save without sending
              </button>
              <button className={primary} onClick={() => submit(true)} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save and send invitation'}
              </button>
            </>
          )}
        </div>
      </section>
      {view?.trial && <TrialPanel view={view} options={options} onChanged={refresh} />}
      {view && <Actions view={view} options={options} onChanged={refresh} />}
    </>
  );
}

const when = (iso: string) => safeFormat(iso, 'd MMM yyyy, HH:mm');

/**
 * Someone who registered to join through a member's link: their trial
 * choices, and the captain's options: a practice trial (players for the
 * Premier League or Division 1, perhaps umpires), or not this time. To
 * propose them as a new joiner, fill in the form above and send the
 * invitation below.
 */
function TrialPanel({ view, options, onChanged }: { view: JoinerView; options: JoinerOptions; onChanged: () => void }) {
  const t = view.trial!;
  const [team, setTeam] = useState('');
  const [where, setWhere] = useState('');
  const [confirm, setConfirm] = useState<null | 'practice' | 'decline'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();
  const act = useMutation({
    mutationFn: (what: 'practice' | 'decline') => (what === 'practice' ? invitePracticeTrial(view.id, team, where) : declineRegistration(view.id)),
    onSuccess: (_r, what) => {
      onChanged();
      setProblem(null);
      toast.success(what === 'practice' ? 'Practice trial emails sent' : 'Registration closed');
      if (what === 'decline') navigate('/membership');
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const name = view.form.preferredName || 'them';
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-base font-semibold text-foreground">Registered to join</h2>
      <dl className="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Sent</dt>
          <dd className="text-foreground">{t.registeredAt ? when(t.registeredAt) : 'Still filling it in'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Through the link of</dt>
          <dd className="text-foreground">{t.referredBy ?? '–'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Trial sessions they can come to</dt>
          <dd className="text-foreground">{t.sessions.length ? t.sessions.map((s) => `${safeFormat(s.startsAt, 'EEE d MMM, h:mm a')} (${s.place})`).join('; ') : 'None'}</dd>
        </div>
      </dl>
      <div className="space-y-2 pt-3 border-t border-border">
        <p className="text-sm font-medium text-foreground">Practice trial</p>
        <p className="text-xs text-muted-foreground">
          For players who could play for the Premier League or Division 1 teams, or umpires. The Assistant Director of Hockey and the team's coach get their hockey
          CV, and {name} is told when to come.
          {t.practiceInvitedAt ? ` Last sent ${when(t.practiceInvitedAt)}.` : ''}
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <select className={fieldInput} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Team…</option>
            {options.teams.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <input
            className={`${fieldInput} sm:col-span-2`}
            placeholder="When and where, e.g. Tuesday 7 Oct, 8pm, HKFC pitch"
            value={where}
            onChange={(e) => setWhere(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-between">
          <button className={secondary} onClick={() => setConfirm('decline')} disabled={act.isPending}>
            Not this time
          </button>
          <button className={primary} onClick={() => setConfirm('practice')} disabled={act.isPending || !team || !where.trim()}>
            Invite to a practice trial
          </button>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'practice' ? 'Invite them to a practice trial?' : 'Not this time?'}
          message={
            confirm === 'practice'
              ? `The Assistant Director of Hockey and the ${team} coach are emailed ${name}'s hockey CV, and ${name} is told: ${where}`
              : `${name}'s registration is closed (Rejected on the board). No email goes to them: let them know yourself.`
          }
          confirmLabel={confirm === 'practice' ? 'Send' : 'Close it'}
          destructive={confirm === 'decline'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const what = confirm;
            setConfirm(null);
            act.mutate(what);
          }}
        />
      )}
    </section>
  );
}

function stepStatus(s: JoinerStepState | null): string {
  if (!s) return 'Not asked yet.';
  if (s.doneAt) return `Done ${when(s.doneAt)}.`;
  return `Asked ${when(s.startedAt)}${s.waitingOn ? `, waiting on ${s.waitingOn}` : ''}.`;
}

/** The three emails, each with where it stands. */
function Actions({ view, options, onChanged }: { view: JoinerView; options: JoinerOptions; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<null | 'invite' | JoinerStepKey>(null);
  const [kitConvenor, setKitConvenor] = useState(view.form.kitConvenorId || (options.kitConvenors.length === 1 ? options.kitConvenors[0].id : ''));
  const [hockeyConvenor, setHockeyConvenor] = useState(view.form.hockeyConvenorId || (options.hockeyConvenors.length === 1 ? options.hockeyConvenors[0].id : ''));
  const [problem, setProblem] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (what: 'invite' | JoinerStepKey) =>
      what === 'invite' ? inviteJoiner(view.id) : requestJoinerStep(view.id, what, what === 'kit' ? kitConvenor : hockeyConvenor),
    onSuccess: (_r, what) => {
      onChanged();
      setProblem(null);
      toast.success(what === 'invite' ? 'Invitation sent' : what === 'kit' ? 'Kit request sent' : 'Registration request sent');
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const invited = PAST_INVITATION.includes(view.stage ?? '');
  const name = view.form.preferredName || 'them';
  const confirmText: Record<'invite' | JoinerStepKey, [string, string]> = {
    invite: [view.invitedAt ? 'Send the invitation again?' : 'Send the invitation?', `${name} is emailed the link to their application.`],
    kit: ['Ask for kit?', `The Kit Convenor is emailed ${name}'s sizes, copied to ${name} and their sponsor.`],
    registration: ['Ask for HKHA registration?', `The Men's Convenor is emailed ${name}'s details for HKHA, copied to ${name}.`],
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Mail className="h-4 w-4" /> Emails
      </h2>
      <p className="text-xs text-muted-foreground">Stage: {view.stage ?? 'none yet'}. Save any changes above first: the emails use what's saved.</p>

      <Row
        title="1. Invitation to apply"
        status={view.invitedAt ? `Sent ${when(view.invitedAt)}.` : 'Not sent yet.'}
        done={!!view.invitedAt}
        button={invited ? null : view.invitedAt ? 'Send again' : 'Send invitation'}
        busy={act.isPending}
        onClick={() => setConfirm('invite')}
        note={invited ? 'They have submitted their application.' : undefined}
      />
      <Row
        title="2. Kit"
        status={stepStatus(view.kit)}
        done={!!view.kit?.doneAt}
        button={view.kit ? 'Ask again' : 'Ask for kit'}
        busy={act.isPending || !kitConvenor}
        onClick={() => setConfirm('kit')}
      >
        <OfficePick value={kitConvenor} options={options.kitConvenors} onChange={setKitConvenor} placeholder="Kit Convenor…" />
      </Row>
      <Row
        title="3. HKHA registration"
        status={stepStatus(view.registration)}
        done={!!view.registration?.doneAt}
        button={view.registration ? 'Ask again' : 'Ask for registration'}
        busy={act.isPending || !hockeyConvenor}
        onClick={() => setConfirm('registration')}
      >
        <OfficePick value={hockeyConvenor} options={options.hockeyConvenors} onChange={setHockeyConvenor} placeholder="Men's Convenor…" />
      </Row>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirmText[confirm][0]}
          message={confirmText[confirm][1]}
          confirmLabel="Send"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const what = confirm;
            setConfirm(null);
            act.mutate(what);
          }}
        />
      )}
    </section>
  );
}

function Row({
  title,
  status,
  done,
  button,
  busy,
  onClick,
  note,
  children,
}: {
  title: string;
  status: string;
  done: boolean;
  button: string | null;
  busy: boolean;
  onClick: () => void;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2 pt-3 border-t border-border first-of-type:border-t-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className={`text-xs flex items-center gap-1 ${done ? 'text-primary' : 'text-muted-foreground'}`}>
            {done && <Check className="h-3.5 w-3.5" />}
            {status}
          </p>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {button && (
          <button className={secondary} onClick={onClick} disabled={busy}>
            {button}
          </button>
        )}
      </div>
      {children && button && <div className="max-w-xs">{children}</div>}
    </div>
  );
}
