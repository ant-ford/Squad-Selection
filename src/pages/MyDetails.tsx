import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
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
