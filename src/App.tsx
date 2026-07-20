import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/lib/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

const Login = lazy(() => import('./pages/Login'));
const CoachLayout = lazy(() => import('./components/CoachLayout'));
const FixtureList = lazy(() => import('./pages/FixtureList'));
const SquadSelection = lazy(() => import('./pages/SquadSelection'));
const PlayerDashboard = lazy(() => import('./pages/PlayerDashboard'));

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

function AuthGate() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingSkeleton />;
  if (!user) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <Login />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: '/', element: <PlayerDashboard /> },
      {
        path: '/coach',
        element: <CoachLayout />,
        children: [
          { index: true, element: <FixtureList /> },
          { path: 'match/:matchId', element: <SquadSelection /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}