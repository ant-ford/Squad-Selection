import { Outlet, useNavigate } from 'react-router-dom';
import { useMyProfile } from '@/lib/queries';
import { Skeleton } from '@/components/ui/skeleton';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';

export default function CoachLayout() {
  // AuthGate already guarantees a signed-in user before this route renders.
  const { data: profile, isLoading: profileLoading } = useMyProfile();

  if (profileLoading || !profile) {
    return <LoadingSkeleton />;
  }

  if (!profile.isCoach) {
    return <NotCoach />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader profile={profile} />
      <main className="flex-1">
        <Outlet context={{ profile }} />
      </main>
      <AppFooter />
    </div>
  );
}

function NotCoach() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center space-y-3">
        <p className="text-lg font-semibold text-foreground">Coach Access Required</p>
        <p className="text-sm text-muted-foreground">You don't have coach permissions.</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-primary underline"
        >
          Go to Player Dashboard
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}