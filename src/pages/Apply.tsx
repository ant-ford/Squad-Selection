import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
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
import { PROFILE_SECTIONS, sectionFor, type SectionKey } from '@shared/profile';

type StepKey = SectionKey | 'clubs' | 'trials' | 'family' | 'plan' | 'kit' | 'volunteering' | 'agree';

/** Stages after the applicant's own step: their application is in. */
const SUBMITTED_STAGES = ['3. Club Application (Signed)', '4. Sponsor (Signed)', '5. Chairman (Signed)', '6. Membership Officer (Signed)', 'Accepted'];

/**
 * The new joiner form (replacing Fillout form 3), one section per screen,
 * each saved as they go, ending with the agreements and signatures. The
 * questions follow the Fillout form's rules for existing and new HKFC
 * members.
 */
export default function ApplyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const details = useQuery({ queryKey: ['myDetails'], queryFn: getMyDetails });
  const view = useQuery({ queryKey: ['apply'], queryFn: getApply });
  const plan = useQuery({ queryKey: ['mySeasonPlan'], queryFn: getMySeasonPlan, enabled: details.isSuccess });
  const volunteering = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering, enabled: details.isSuccess });

  const steps = useMemo<{ key: StepKey; title: string }[]>(() => {
    const d = details.data;
    if (!d) return [];
    const who = d.audience;
    const asked = (key: SectionKey) => sectionFor(PROFILE_SECTIONS.find((s) => s.key === key)!, who);
    const newMember = who === 'new';
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

  const loading = details.isLoading || view.isLoading || (details.isSuccess && (plan.isLoading || volunteering.isLoading));
  const failed = details.error || view.error || plan.error || volunteering.error;

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
            Thanks. You submitted it on {safeFormat(view.data.submittedAt, 'd MMM yyyy')}. Your sponsor, the Section Chair and the Membership Officer sign next, and the
            Membership Officer will let you know.
          </p>
          <button className="text-sm text-primary underline" onClick={() => navigate('/')}>
            Back to the app
          </button>
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
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="New joiner application">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Thank you for applying to join HKFC Hockey. Each screen saves as you go, so you can stop and come back. Questions? Contact the Membership Officer at
          mensmembership@hkfchockey.com.
        </p>
        {body()}
      </main>
      <AppFooter />
    </div>
  );
}
