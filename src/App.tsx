import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/lib/useAuth';
import Login from './pages/Login';
import CoachLayout from './components/CoachLayout';
import FixtureList from './pages/FixtureList';
import SquadSelection from './pages/SquadSelection';
import PlayerDashboard from './pages/PlayerDashboard';

function AuthGate() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <AppLoading />;
  if (!user) return <Login />;
  return <Outlet />;
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

function AppLoading() {
  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center bg-background overflow-hidden">
      {/* Ambient club-blue glow */}
      <div
        aria-hidden
        className="absolute -top-48 left-1/2 -translate-x-1/2 h-[520px] w-[820px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.12), transparent 70%)' }}
      />

      {/* Faint pitch markings: border, halfway line, 23m lines, striking circles, penalty spots */}
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full text-primary opacity-[0.05]"
        viewBox="0 0 914 550"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      >
        <rect x="4" y="4" width="906" height="542" />
        <line x1="457" y1="4" x2="457" y2="546" />
        <line x1="229" y1="4" x2="229" y2="546" />
        <line x1="685" y1="4" x2="685" y2="546" />
        <path d="M 4 129 A 146 146 0 0 1 4 421" />
        <path d="M 910 129 A 146 146 0 0 0 910 421" />
        <circle cx="150" cy="275" r="4" fill="currentColor" stroke="none" />
        <circle cx="764" cy="275" r="4" fill="currentColor" stroke="none" />
      </svg>

      {/* Bouncing hockey ball with dimple texture */}
      <div className="relative flex flex-col items-center">
        <div
          className="h-11 w-11 rounded-full animate-[ball-hop_0.9s_cubic-bezier(0.35,0,0.65,1)_infinite] motion-reduce:animate-none"
          style={{
            backgroundImage:
              'radial-gradient(hsl(var(--foreground) / 0.08) 1.2px, transparent 1.7px), radial-gradient(circle at 32% 28%, #ffffff 0%, #f4f4f5 48%, #cfcfd4 100%)',
            backgroundSize: '9px 9px, 100% 100%',
            boxShadow: 'inset -4px -5px 8px hsl(var(--foreground) / 0.14)',
          }}
        />
        <div className="mt-4 h-2 w-11 rounded-[100%] bg-primary/25 blur-[1px] animate-[ball-shadow_0.9s_cubic-bezier(0.35,0,0.65,1)_infinite] motion-reduce:animate-none" />
      </div>

      {/* Wordmark */}
      <div className="relative mt-10 text-center">
        <p className="font-mono text-3xl font-bold tracking-[0.4em] pl-[0.4em] text-foreground animate-[fade-up_0.6s_ease-out_both]">
          HKFC
        </p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground animate-[fade-up_0.6s_ease-out_both] [animation-delay:120ms]">
          Squad Selection
        </p>
        <p className="mt-6 font-mono text-[10px] tracking-widest text-muted-foreground/70 animate-[fade-up_0.6s_ease-out_both] [animation-delay:240ms]">
          warming up…
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}