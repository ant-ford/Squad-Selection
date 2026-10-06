import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { getMyDetails } from '@/api/details';
import { getApply } from '@/api/apply';
import { getMySeasonPlan } from '@/api/seasonPlan';
import { getMyVolunteering } from '@/api/volunteering';
import { KitStep, SeasonPlanStep, SectionStep, VolunteeringStep, type StepProps } from '@/components/profile/steps';
import { AgreeStep, ClubsStep, FamilyStep, TrialsStep } from '@/components/apply/applySteps';
import { RegisterStep, TrialDatesStep } from '@/components/apply/trialSteps';
import { getMyTrial } from '@/api/trials';
import { PROFILE_SECTIONS, sectionFor, type SectionKey } from '@shared/profile';
import { SUBMITTED_STAGES } from '@shared/membershipStages';

type StepKey = SectionKey | 'clubs' | 'trials' | 'family' | 'plan' | 'kit' | 'volunteering' | 'agree' | 'trialDates' | 'register';

/** Stages after the applicant's own step: their application is in. */

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
/**
 * Leaves the application for the player page. The profile is fetched once per
 * visit (staleTime Infinity), so a copy from while they were still applying
 * would send Home straight back here: drop it first.
 */
function ToPlayerPage() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queryClient.removeQueries({ queryKey: ['myProfile'] });
    setReady(true);
  }, [queryClient]);
  return ready ? <Navigate to="/" replace /> : <Skeleton className="h-96 w-full" />;
}

export default function ApplyPage() {
  const queryClient = useQueryClient();
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
    // Sent already (in Eddy, or through Fillout before the switch-over): nothing
    // to fill in, so it's the player page (App.tsx Home), e.g. an Active
    // player whose club registration is still going through. A fresh
    // submission is confirmed by the toast in finished().
    if (SUBMITTED_STAGES.includes(view.data.stage ?? '')) return <ToPlayerPage />;
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
      {/* Applicants' home is this page (App.tsx Home): the header leaves out the burger and the switch for them. */}
      <AppHeader title={trialist ? 'Register to join' : 'New joiner application'} />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {body()}
      </main>
      <AppFooter />
    </div>
  );
}
