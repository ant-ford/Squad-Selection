import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, LogOut } from 'lucide-react';
import AppHeader, { headerIconClass } from '@/components/AppHeader';
import { useAuth } from '@/lib/auth';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { getMyDetails } from '@/api/details';
import { getApply } from '@/api/apply';
import { getMySeasonPlan } from '@/api/seasonPlan';
import { getMyVolunteering } from '@/api/volunteering';
import { KitStep, SeasonPlanStep, SectionStep, VolunteeringStep, type StepProps } from '@/components/profile/steps';
import { AgreeStep, ClubsStep, FamilyStep, TrialsStep } from '@/components/apply/applySteps';
import { RegisterStep, TrialDatesStep } from '@/components/apply/trialSteps';
import { getMyTrial } from '@/api/trials';
import { PROFILE_SECTIONS, sectionFor, type SectionKey } from '@shared/profile';

type StepKey = SectionKey | 'clubs' | 'trials' | 'family' | 'plan' | 'kit' | 'volunteering' | 'agree' | 'trialDates' | 'register';

/** Stages after the applicant's own step: their application is in. */
const SUBMITTED_STAGES = ['3. Club Application (Signed)', '4. Sponsor (Signed)', '5. Chairman (Signed)', '6. Membership Officer (Signed)', 'Accepted'];

/**
 * The new joiner form (replacing Fillout form 3), one section per screen,
 * each saved as they go, ending with the agreements and signatures. The
 * questions follow the Fillout form's rules for existing and new HKFC
 * members.
 *
 * Someone registering to join (stage 1, from a member's link) gets the old
 * trial form's questions instead, ending with the trial sessions and Send;
 * if they're invited to apply, the answers carry over.
 */
export default function ApplyPage() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const details = useQuery({ queryKey: ['myDetails'], queryFn: getMyDetails });
  const view = useQuery({ queryKey: ['apply'], queryFn: getApply });
  const plan = useQuery({ queryKey: ['mySeasonPlan'], queryFn: getMySeasonPlan, enabled: details.isSuccess });
  const volunteering = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering, enabled: details.isSuccess });
  const trialist = details.data?.trialist ?? false;
  const trial = useQuery({ queryKey: ['myTrial'], queryFn: getMyTrial, enabled: trialist });

  const steps = useMemo<{ key: StepKey; title: string }[]>(() => {
    const d = details.data;
    if (!d) return [];
    const who = d.audience;
    const asked = (key: SectionKey) => sectionFor(PROFILE_SECTIONS.find((s) => s.key === key)!, who);
    const newMember = who === 'new';
    if (d.trialist) {
      // The old trial form's questions; everyone gives their hockey CV.
      return [
        { key: 'application' as const, title: 'About your application' },
        { key: 'personal' as const, title: 'Personal' },
        ...(d.underEighteen ? [{ key: 'guardian' as const, title: 'Parent or guardian' }] : []),
        { key: 'contact' as const, title: 'Contact' },
        { key: 'emergency' as const, title: 'Emergency contact' },
        { key: 'background' as const, title: 'Hockey CV' },
        { key: 'hockey' as const, title: 'Hockey' },
        { key: 'plan' as const, title: 'Season plan' },
        { key: 'trialDates' as const, title: 'Trials' },
        ...(d.kit ? [{ key: 'kit' as const, title: 'Kit sizes' }] : []),
        { key: 'volunteering' as const, title: 'Volunteering' },
        { key: 'register' as const, title: 'Send' },
      ];
    }
    return [
      { key: 'application' as const, title: 'Application' },
      { key: 'personal' as const, title: 'Personal' },
      { key: 'contact' as const, title: 'Contact' },
      { key: 'emergency' as const, title: 'Emergency contact' },
      { key: 'work' as const, title: 'Work' },
      ...(d.underEighteen ? [{ key: 'guardian' as const, title: 'Parent or guardian' }] : []),
      ...(asked('background') ? [{ key: 'background' as const, title: 'About you' }] : []),
      ...(newMember ? [{ key: 'clubs' as const, title: 'Private clubs' }, { key: 'trials' as const, title: 'Trials' }] : []),
      { key: 'family' as const, title: 'Family' },
      { key: 'hockey' as const, title: 'Hockey' },
      { key: 'plan' as const, title: 'Season plan' },
      ...(d.kit ? [{ key: 'kit' as const, title: 'Kit sizes' }] : []),
      { key: 'volunteering' as const, title: 'Volunteering' },
      ...(asked('billing') ? [{ key: 'billing' as const, title: 'Bank and billing' }] : []),
      { key: 'agree' as const, title: 'Agree and sign' },
    ];
  }, [details.data]);

  const index = Math.max(0, steps.findIndex((s) => s.key === params.get('step')));
  const go = (i: number) => {
    const next = new URLSearchParams(params);
    next.set('step', steps[i].key);
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  const finished = () => {
    toast.success('Application submitted');
    void queryClient.invalidateQueries({ queryKey: ['apply'] });
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
  };

  const loading = details.isLoading || view.isLoading || (details.isSuccess && (plan.isLoading || volunteering.isLoading || (trialist && trial.isLoading)));
  const failed = details.error || view.error || plan.error || volunteering.error || trial.error;

  const body = () => {
    if (loading) return <Skeleton className="h-96 w-full" />;
    if (failed || !details.data || !view.data || !volunteering.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{failed instanceof ApiError && failed.status < 500 ? failed.message : 'Could not load your application.'}</p>
          <button onClick={() => void view.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    if (view.data.submittedAt && SUBMITTED_STAGES.includes(view.data.stage ?? '')) {
      return (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Check className="h-5 w-5 text-primary" /> Application submitted
          </h2>
          <p className="text-sm text-foreground">
            Thanks. You submitted it on {safeFormat(view.data.submittedAt, 'd MMM yyyy')}. Your sponsor, the Chairman and the Membership Officer sign next, and the
            Membership Officer will let you know.
          </p>
        </section>
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
        {section && <SectionStep key={section.key} section={section} {...props} />}
        {step.key === 'clubs' && <ClubsStep {...props} view={view.data} />}
        {step.key === 'trials' && <TrialsStep {...props} view={view.data} />}
        {step.key === 'family' && <FamilyStep {...props} view={view.data} />}
        {step.key === 'plan' && <SeasonPlanStep {...props} initial={plan.data?.plan} />}
        {step.key === 'kit' && <KitStep {...props} />}
        {step.key === 'volunteering' && <VolunteeringStep {...props} initial={volunteering.data} />}
        {step.key === 'agree' && <AgreeStep {...props} view={view.data} onFinished={finished} />}
        {step.key === 'trialDates' && trial.data && <TrialDatesStep {...props} trial={trial.data} />}
        {step.key === 'register' && trial.data && <RegisterStep {...props} trial={trial.data} />}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle={trialist ? 'Register to join' : 'New joiner application'}>
        {/* Applicants' home is this page (App.tsx Home), so no Player View. */}
        <button onClick={() => void logout()} className={headerIconClass} aria-label="Log out" title="Log out">
          <LogOut className="h-4 w-4" />
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {body()}
      </main>
      <AppFooter />
    </div>
  );
}
