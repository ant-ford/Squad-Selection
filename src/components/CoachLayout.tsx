import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMyProfile } from '@/lib/queries';
import { Skeleton } from '@/components/ui/skeleton';
import AppHeader from '@/components/AppHeader';
import { coachScreen } from '@/lib/header';
import { coachDashboardPath } from '@/lib/scrollMemory';

export default function CoachLayout() {
  // AuthGate already guarantees a signed-in user before this route renders.
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const { pathname } = useLocation();
  const screen = coachScreen(pathname);
  const header = <AppHeader title={screen.title} back={screen.child ? coachDashboardPath() : undefined} />;

  if (profileLoading || !profile) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <LoadingSkeleton />
      </div>
    );
  }

  if (!profile.isCoach) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <NotCoach />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {header}
      {/* No footer on coach screens: they are working screens, and the
          squad and ranking save bars sit at the bottom. */}
      <main className="flex-1">
        <Outlet context={{ profile }} />
      </main>
    </div>
  );
}

function NotCoach() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center p-6 pt-16">
      <div className="text-center space-y-3">
        <p className="text-lg font-semibold text-foreground">Coach access required</p>
        <p className="text-sm text-muted-foreground">You don't have coach permissions.</p>
        <button onClick={() => navigate('/')} className="min-h-10 px-3 text-sm text-primary underline">
          Player view
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
