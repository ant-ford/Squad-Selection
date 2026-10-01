import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import ProfileFields from '@/components/profile/ProfileFields';
import FileUpload from '@/components/profile/FileUpload';
import KitSizesSection from '@/components/profile/KitSizesSection';
import SeasonPlanSection from '@/components/SeasonPlanSection';
import VolunteeringSection from '@/components/VolunteeringSection';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { confirmDetails, saveDetailsSection, saveKitSizes } from '@/api/details';
import { submitSeasonPlan } from '@/api/seasonPlan';
import { saveVolunteering } from '@/api/volunteering';
import { audienceOf, checkValue, fieldsFor, sectionProblem, type Audience, type MyDetails, type ProfileValues, type SectionSpec } from '@shared/profile';
import { EMPTY_SEASON_PLAN, seasonPlanMissing, type SeasonPlanAnswers } from '@shared/seasonPlan';
import { volunteeringMissing, type VolunteeringAnswers } from '@shared/volunteering';
import type { KitSizes } from '@shared/kit';

/**
 * The step screens shared by My details (the member details update) and the
 * applicant page: each is one section with Back and its own save.
 */

export const primary = 'h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50';
export const secondary = 'h-10 px-4 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted disabled:opacity-50';

export const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Not saved: the connection or the server failed. Please try again.');

/** One screen: its content, then Back and the step's own save. */
export function StepShell({
  title,
  step,
  total,
  children,
  onBack,
  onNext,
  nextLabel = 'Save and next',
  busy,
  problem,
}: {
  title: string;
  step: number;
  total: number;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  busy?: boolean;
  problem?: string | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Step {step} of {total}
        </p>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {children}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-2 justify-between">
        {onBack ? (
          <button className={secondary} onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button className={primary} onClick={onNext} disabled={busy}>
          {busy ? 'Saving…' : nextLabel}
        </button>
      </div>
    </section>
  );
}

export interface StepProps {
  details: MyDetails;
  step: number;
  total: number;
  onBack?: () => void;
  onDone: () => void;
}

export function MembershipStep({ details, ...nav }: StepProps) {
  const m = details.membership;
  const rows: [string, string | null][] = [
    ['Membership no.', m.membershipNo],
    ['Member type', m.memberType],
    ['Category', m.categoryType],
    ['Player or coach', m.playerCoach.join(', ') || null],
    ['Joined', m.joinDate ? safeFormat(m.joinDate, 'd MMM yyyy') : null],
    ['Commitment ends', m.commitmentEndDate ? safeFormat(m.commitmentEndDate, 'd MMM yyyy') : null],
  ];
  return (
    <StepShell title="Your membership" {...nav} onNext={nav.onDone} nextLabel="Next">
      <dl className="grid grid-cols-2 gap-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="text-sm text-foreground">{v || '–'}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">These are kept by the Membership Officer. If anything's wrong, let them know.</p>
    </StepShell>
  );
}

export function SectionStep({ section, details, ...nav }: StepProps & { section: SectionSpec }) {
  const queryClient = useQueryClient();
  // Everything the section could ask, so a choice that shows more questions keeps their saved answers.
  const [values, setValues] = useState<ProfileValues>(() => Object.fromEntries(section.fields.map((f) => [f.key, details.values[f.key] ?? null])));
  // On the application step the questions follow the type of application chosen.
  const who: Audience = section.key === 'application' ? audienceOf('Applicant', values.applicantType as string | null) : details.audience;
  const allFields = fieldsFor(section, who);
  // Not playing this season: the rest of the hockey questions don't apply.
  const fields = section.key === 'hockey' && values.active === false ? allFields.filter((f) => f.key === 'active') : allFields;
  const [problem, setProblem] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState(details.photoUrl);
  const [hkid, setHkid] = useState(details.hasHkidCopy);
  const save = useMutation({
    mutationFn: () => saveDetailsSection(section.key, Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? null]))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myDetails'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  // Saying they won't be active makes them inactive at once (owner,
  // 2026-10-01), so it asks first.
  const [confirmInactive, setConfirmInactive] = useState(false);
  const next = () => {
    const bad = fields.map((f) => checkValue(f, values[f.key], who)).find(Boolean) ?? sectionProblem(section.key, values);
    setProblem(bad ?? null);
    if (bad) return;
    if (section.key === 'hockey' && values.active === false && details.values.active !== false) setConfirmInactive(true);
    else save.mutate();
  };
  return (
    <StepShell title={section.title} {...nav} onNext={next} busy={save.isPending} problem={problem}>
      {confirmInactive && (
        <ConfirmDialog
          title="Not playing this season?"
          message="You'll be marked as not active straight away: you won't be picked for squads or shown in the team lists until you're made active again."
          confirmLabel="Yes, not this season"
          onCancel={() => setConfirmInactive(false)}
          onConfirm={() => {
            setConfirmInactive(false);
            save.mutate();
          }}
        />
      )}
      {section.intro && <p className="text-xs text-muted-foreground">{section.intro}</p>}
      {section.key === 'personal' && (
        <div className="grid gap-3">
          <FileUpload
            kind="photo"
            label="Photo"
            hint="Passport-style: head and shoulders, plain background, taken in the last two years."
            currentUrl={photoUrl}
            hasFile={!!photoUrl}
            onUploaded={(url) => setPhotoUrl(url)}
          />
          <FileUpload kind="hkid" label="Copy of your HKID" hasFile={hkid} onUploaded={() => setHkid(true)} />
        </div>
      )}
      {section.key === 'contact' && (
        <p className="text-xs text-muted-foreground">
          You sign in with <span className="text-foreground">{details.email ?? 'no email'}</span>. To change it, ask the Membership Officer.
        </p>
      )}
      <ProfileFields fields={fields} values={values} onChange={setValues} who={who} />
    </StepShell>
  );
}

export function KitStep({ details, ...nav }: StepProps) {
  const kit = details.kit!;
  const [sizes, setSizes] = useState<KitSizes>(kit.sizes);
  const [problem, setProblem] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => saveKitSizes(sizes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myDetails'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad = !sizes.shirt || !sizes.shorts || !sizes.socks ? 'Give your shirt, shorts and socks sizes.' : null;
    setProblem(bad);
    if (!bad) save.mutate();
  };
  return (
    <StepShell title="Kit sizes" {...nav} onNext={next} busy={save.isPending} problem={problem}>
      <KitSizesSection kit={kit} value={sizes} onChange={setSizes} />
    </StepShell>
  );
}

export function SeasonPlanStep({ details, initial, ...nav }: StepProps & { initial?: SeasonPlanAnswers | null }) {
  const [answers, setAnswers] = useState<SeasonPlanAnswers>(initial ?? EMPTY_SEASON_PLAN);
  const [problem, setProblem] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => submitSeasonPlan(answers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mySeasonPlan'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad = seasonPlanMissing(answers);
    setProblem(bad);
    if (!bad) save.mutate();
  };
  return (
    <StepShell title="Season plan" {...nav} onNext={next} busy={save.isPending} problem={problem}>
      <SeasonPlanSection season={details.season} value={answers} onChange={setAnswers} />
    </StepShell>
  );
}

export function VolunteeringStep({ initial, ...nav }: Omit<StepProps, 'details'> & { initial: VolunteeringAnswers }) {
  const [answers, setAnswers] = useState<VolunteeringAnswers>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => saveVolunteering(answers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myVolunteering'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad = volunteeringMissing(answers);
    setProblem(bad);
    if (!bad) save.mutate();
  };
  return (
    <StepShell title="Volunteering" {...nav} onNext={next} busy={save.isPending} problem={problem}>
      <VolunteeringSection value={answers} onChange={setAnswers} />
    </StepShell>
  );
}

export function DoneStep({ details, onFinished, ...nav }: StepProps & { onFinished: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = useMutation({ mutationFn: confirmDetails, onSuccess: onFinished, onError: (err) => setProblem(errorText(err)) });
  return (
    <StepShell title="All done?" {...nav} onNext={() => confirm.mutate()} nextLabel="Confirm my details" busy={confirm.isPending} problem={problem}>
      <p className="text-sm text-foreground flex gap-2 items-start">
        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        Everything is saved. Confirm to say your details are up to date for {details.season.replace('-', '–')}.
      </p>
      <p className="text-xs text-muted-foreground">You can come back and change them any time.</p>
    </StepShell>
  );
}

