import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import { getMyProfile, ProfileData } from '@/api/getMyProfile';
import { Skeleton } from '@/components/ui/skeleton';
import AppHeader from '@/components/AppHeader';

export default function CoachLayout() {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getMyProfile().then(data => {
      setProfile(data);
      setProfileLoading(false);
    }).catch(() => setProfileLoading(false));
  }, [user]);

  if (isLoading || !user) {
    return <LoadingSkeleton />;
  }
  if (profileLoading) {
    return <LoadingSkeleton />;
  }
  console.log("PROFILE", profile);
  if (!profile?.isCoach) {
    return <NotCoach />;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader profile={profile} />
      <Outlet context={{ profile }} />
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
