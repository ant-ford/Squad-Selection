import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { StepProgress } from '@/components/ui/step-progress';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { getMyDetails } from '@/api/details';
import { getMySeasonPlan } from '@/api/seasonPlan';
import { getMyVolunteering } from '@/api/volunteering';
import { PROFILE_SECTIONS, type SectionSpec } from '@shared/profile';
import {
  DoneStep,
  KitStep,
  MembershipStep,
  SeasonPlanStep,
  SectionStep,
  VolunteeringStep,
  type StepProps,
} from '@/components/profile/steps';
import DeleteProfile from '@/components/profile/DeleteProfile';

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
    const section = (key: SectionSpec['key'], short: string) => ({ key, title: short });
    const playing = d.applicant || d.values.active !== false;
    return [
      ...(d.applicant ? [] : [{ key: 'membership' as const, title: 'Membership' }]),
      section('personal', 'Personal'),
      section('emergency', 'Emergency contact'),
      section('contact', 'Contact'),
      section('work', 'Work'),
      ...(d.underEighteen ? [section('guardian', 'Parent or guardian')] : []),
      section('hockey', 'Hockey'),
      ...(askPlan && playing ? [{ key: 'plan' as const, title: 'Season plan' }] : []),
      ...(d.kit && playing ? [{ key: 'kit' as const, title: 'Kit sizes' }] : []),
      { key: 'volunteering' as const, title: 'Volunteering' },
      ...(d.applicant ? [section('billing', 'Bank and billing')] : []),
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
        <ErrorState
          title="Could not load your details"
          message={failed instanceof ApiError && failed.status < 500 ? failed.message : undefined}
          onRetry={() => void details.refetch()}
        />
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
        <StepProgress step={index + 1} total={steps.length} title={step.title} />
        {step.key === 'membership' && <MembershipStep {...props} />}
        {section && <SectionStep key={section.key} section={section} {...props} />}
        {step.key === 'kit' && <KitStep {...props} />}
        {step.key === 'plan' && <SeasonPlanStep {...props} />}
        {step.key === 'volunteering' && <VolunteeringStep {...props} initial={volunteering.data} />}
        {step.key === 'done' && <DoneStep {...props} onFinished={finished} />}
        {step.key === 'membership' && <DeleteProfile />}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="My details" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
