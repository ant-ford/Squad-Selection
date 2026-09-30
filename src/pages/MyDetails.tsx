import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import ProfileFields from '@/components/profile/ProfileFields';
import FileUpload from '@/components/profile/FileUpload';
import KitSizesSection from '@/components/profile/KitSizesSection';
import SeasonPlanSection from '@/components/SeasonPlanSection';
import VolunteeringSection from '@/components/VolunteeringSection';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { confirmDetails, getMyDetails, saveDetailsSection, saveKitSizes } from '@/api/details';
import { getMySeasonPlan, submitSeasonPlan } from '@/api/seasonPlan';
import { getMyVolunteering, saveVolunteering } from '@/api/volunteering';
import { PROFILE_SECTIONS, checkValue, fieldsFor, type MyDetails, type ProfileValues, type SectionSpec } from '@shared/profile';
import { EMPTY_SEASON_PLAN, seasonPlanMissing, type SeasonPlanAnswers } from '@shared/seasonPlan';
import { volunteeringMissing, type VolunteeringAnswers } from '@shared/volunteering';
import type { KitSizes } from '@shared/kit';

const primary = 'h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50';
const secondary = 'h-10 px-4 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted disabled:opacity-50';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Not saved: the connection or the server failed. Please try again.');

/** One screen: its content, then Back and the step's own save. */
function StepShell({
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

interface StepProps {
  details: MyDetails;
  step: number;
  total: number;
  onBack?: () => void;
  onDone: () => void;
}

function MembershipStep({ details, ...nav }: StepProps) {
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

function SectionStep({ section, details, ...nav }: StepProps & { section: SectionSpec }) {
  const queryClient = useQueryClient();
  const fields = fieldsFor(section, details.applicant);
  const [values, setValues] = useState<ProfileValues>(() => Object.fromEntries(fields.map((f) => [f.key, details.values[f.key] ?? null])));
  const [problem, setProblem] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState(details.photoUrl);
  const [hkid, setHkid] = useState(details.hasHkidCopy);
  const save = useMutation({
    mutationFn: () => saveDetailsSection(section.key, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myDetails'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad = fields.map((f) => checkValue(f, values[f.key])).find(Boolean);
    setProblem(bad ?? null);
    if (!bad) save.mutate();
  };
  return (
    <StepShell title={section.title} {...nav} onNext={next} busy={save.isPending} problem={problem}>
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
      <ProfileFields fields={fields} values={values} onChange={setValues} />
    </StepShell>
  );
}

function KitStep({ details, ...nav }: StepProps) {
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

function SeasonPlanStep({ details, ...nav }: StepProps) {
  const [answers, setAnswers] = useState<SeasonPlanAnswers>(EMPTY_SEASON_PLAN);
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

function VolunteeringStep({ initial, ...nav }: Omit<StepProps, 'details'> & { initial: VolunteeringAnswers }) {
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

function DoneStep({ details, onFinished, ...nav }: StepProps & { onFinished: () => void }) {
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

type StepKey = 'membership' | SectionSpec['key'] | 'kit' | 'plan' | 'volunteering' | 'done';

/**
 * The member details update, one section per screen (owner, 2026-10-01):
 * membership (read-only), personal, emergency contact, contact, work, parent
 * or guardian for under-18s, kit sizes, the season plan if not given yet this
 * season, volunteering, then confirm. Each screen saves as they go.
 */
export default function MyDetailsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const details = useQuery({ queryKey: ['myDetails'], queryFn: getMyDetails });
  const plan = useQuery({ queryKey: ['mySeasonPlan'], queryFn: getMySeasonPlan, enabled: details.isSuccess });
  const volunteering = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering, enabled: details.isSuccess });
  // The season plan is asked once a season: kept out of the steps once given.
  const [askPlan, setAskPlan] = useState<boolean | null>(null);
  if (askPlan === null && plan.isSuccess) setAskPlan(!plan.data.plan?.availabilityLevel);

  const steps = useMemo<{ key: StepKey; title: string }[]>(() => {
    const d = details.data;
    if (!d) return [];
    return [
      ...(d.applicant ? [] : [{ key: 'membership' as const, title: 'Membership' }]),
      ...PROFILE_SECTIONS.filter((s) => !s.underEighteenOnly || d.underEighteen).map((s) => ({ key: s.key, title: s.title })),
      ...(d.kit ? [{ key: 'kit' as const, title: 'Kit sizes' }] : []),
      ...(askPlan ? [{ key: 'plan' as const, title: 'Season plan' }] : []),
      { key: 'volunteering' as const, title: 'Volunteering' },
      { key: 'done' as const, title: 'Confirm' },
    ];
  }, [details.data, askPlan]);

  const index = Math.max(0, steps.findIndex((s) => s.key === params.get('step')));
  const go = (i: number) => {
    const next = new URLSearchParams(params);
    next.set('step', steps[i].key);
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  const finished = () => {
    toast.success('Thanks, your details are up to date');
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    void queryClient.invalidateQueries({ queryKey: ['myDetails'] });
    navigate('/');
  };

  const loading = details.isLoading || (details.isSuccess && (plan.isLoading || volunteering.isLoading || askPlan === null));
  const failed = details.error || plan.error || volunteering.error;

  const body = () => {
    if (loading) return <Skeleton className="h-96 w-full" />;
    if (failed || !details.data || !volunteering.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{failed instanceof ApiError && failed.status < 500 ? failed.message : 'Could not load your details.'}</p>
          <button onClick={() => void details.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    const step = steps[index];
    const props: StepProps = {
      details: details.data,
      step: index + 1,
      total: steps.length,
      onBack: index > 0 ? () => go(index - 1) : undefined,
      onDone: () => go(Math.min(index + 1, steps.length - 1)),
    };
    const section = PROFILE_SECTIONS.find((s) => s.key === step.key);
    return (
      <>
        {details.data.checkedAt && (
          <p className="text-xs text-muted-foreground">Last confirmed {safeFormat(details.data.checkedAt, 'd MMM yyyy')}.</p>
        )}
        <ol className="flex flex-wrap gap-1" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button
                onClick={() => go(i)}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${i === index ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        {step.key === 'membership' && <MembershipStep {...props} />}
        {section && <SectionStep key={section.key} section={section} {...props} />}
        {step.key === 'kit' && <KitStep {...props} />}
        {step.key === 'plan' && <SeasonPlanStep {...props} />}
        {step.key === 'volunteering' && <VolunteeringStep {...props} initial={volunteering.data} />}
        {step.key === 'done' && <DoneStep {...props} onFinished={finished} />}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="My details">
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
