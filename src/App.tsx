import { Suspense, lazy, useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, useRouteError, Navigate } from 'react-router-dom';
import { usePrefetchQuery, useQuery } from '@tanstack/react-query';
import { myFixturesQuery, myTasksQuery, useMyProfile } from '@/lib/queries';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/lib/auth';
import { isChunkLoadError, recoverFromStaleDeploy } from '@/lib/staleDeploy';
import { reportClientError } from '@/lib/clientErrors';
import Login from './pages/Login';
import AccessNotActive from '@/components/AccessNotActive';
import { getAccessDenied, subscribeAccessDenied } from '@/lib/accessDenied';
import PlayerDashboard from './pages/PlayerDashboard';

/** Someone signing up from a member's link who hasn't been registered yet (pages/Join.tsx). */
function pendingJoin(): boolean {
  try {
    return localStorage.getItem('join:pending') === '1';
  } catch {
    return false;
  }
}

function AuthGate() {
  const { user, isLoading } = useAuth();
  // Authenticated but not authorised. Kept as a screen rather than a
  // sign-out: the session is valid, so making them fetch another code
  // achieves nothing except another round trip through their inbox.
  const accessDenied = useSyncExternalStore(subscribeAccessDenied, getAccessDenied, () => null);
  if (isLoading) return <AppLoading />;
  if (!user) return <Login />;
  if (accessDenied && pendingJoin()) return <Navigate to="/join" replace />;
  if (accessDenied) return <AccessNotActive message={accessDenied} />;
  return <Outlet />;
}

/** The player page, or for an applicant (or someone registering to join) their application. */
function Home() {
  // The player page's own reads go out with the profile, not after it. The
  // dashboard's fixtures observer is the one that stays enabled: this one only
  // watches for the data, so it never refetches a variant that's off screen.
  usePrefetchQuery(myFixturesQuery(true));
  usePrefetchQuery(myTasksQuery);
  const fixturesIn = useQuery({ ...myFixturesQuery(true), enabled: false }).data !== undefined;
  const { data, isLoading } = useMyProfile();
  if (data?.applicant) return <Navigate to="/apply" replace />;
  if (isLoading && !fixturesIn) return <AppLoading />;
  return <PlayerDashboard />;
}

/** Minimal skeleton shown while a lazy route loads. */
function RouteSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      <div className="animate-pulse space-y-3">
        <div className="h-10 w-48 bg-muted rounded" />
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="pt-4 space-y-3">
          <div className="h-24 w-full bg-muted rounded-lg" />
          <div className="h-24 w-full bg-muted rounded-lg" />
          <div className="h-24 w-full bg-muted rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * A screen loaded on its first visit, so Player view doesn't carry it. The
 * route skeleton shows while its chunk downloads; a chunk that fails to load
 * reaches RouteError, which recovers from a stale deploy.
 */
function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <Page />
    </Suspense>
  );
}

function RouteError() {
  const error = useRouteError();
  console.error(error);
  // A lazy route whose chunk 404s (or comes back as the SPA fallback HTML)
  // means this client is running a previous deploy. Recover (reload, then
  // clear the service worker) rather than leaving the skeleton up.
  useEffect(() => {
    if (isChunkLoadError(error)) void recoverFromStaleDeploy();
    else reportClientError('route', error);
  }, [error]);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="text-lg font-semibold text-foreground">Something went wrong</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Reload to try again.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => window.location.reload()}
          className="min-h-10 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Reload
        </button>
        {/* A full load rather than a router navigation: the router that failed may not recover. */}
        <a href="/" className="min-h-10 inline-flex items-center px-4 py-2 rounded-md border border-border text-sm font-medium text-foreground">
          Player view
        </a>
      </div>
    </div>
  );
}

// Sign-in and Player view load with the app; every other screen loads on its
// first visit (lazyPage).
const router = createBrowserRouter([
  // Open to anyone with a member's link: it signs them up (pages/Join.tsx).
  {
    path: '/join',
    errorElement: <RouteError />,
    element: lazyPage(() => import('./pages/Join')),
  },
  {
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/chairman', element: lazyPage(() => import('./pages/EmailLists')) },
      { path: '/stats', element: lazyPage(() => import('./pages/ClubStats')) },
      { path: '/membership', element: lazyPage(() => import('./pages/MembershipBoard')) },
      { path: '/joiners/new', element: lazyPage(() => import('./pages/JoinerEdit')) },
      { path: '/joiners/:id', element: lazyPage(() => import('./pages/JoinerEdit')) },
      { path: '/quizzes', element: lazyPage(() => import('./pages/Quizzes')) },
      { path: '/quizzes/:key', element: lazyPage(() => import('./pages/QuizTake')) },
      { path: '/checkin/:id', element: lazyPage(() => import('./pages/CheckIn')) },
      { path: '/events/manage', element: lazyPage(() => import('./pages/ManageEvents')) },
      // One event, as a page: /events/manage/new or /events/manage/:id.
      { path: '/events/manage/:id', element: lazyPage(() => import('./pages/ManageEvent')) },
      { path: '/trial-sessions', element: lazyPage(() => import('./pages/TrialSessions')) },
      { path: '/sign-application/:id', element: lazyPage(() => import('./pages/SignApplication')) },
      { path: '/club-docs/:name', element: lazyPage(() => import('./pages/ClubDoc')) },
      { path: '/reactivate/:id', element: lazyPage(() => import('./pages/Reactivate')) },
      { path: '/joiner-task/:id', element: lazyPage(() => import('./pages/JoinerTask')) },
      // The new joiner (applicant) form.
      { path: '/apply', element: lazyPage(() => import('./pages/Apply')) },
      // The member details update (one section per screen).
      { path: '/my-details', element: lazyPage(() => import('./pages/MyDetails')) },
      // Volunteering: the player's own, and the Volunteers view (officers, coaches, captains).
      { path: '/volunteering', element: lazyPage(() => import('./pages/MyVolunteering')) },
      { path: '/volunteers', element: lazyPage(() => import('./pages/Volunteers')) },
      { path: '/system', element: lazyPage(() => import('./pages/System')) },
      { path: '/umpiring', element: lazyPage(() => import('./pages/Umpiring')) },
      // Season plans by team (Section Captains; coaches for their own teams).
      { path: '/season-plans', element: lazyPage(() => import('./pages/SeasonPlans')) },
      // Kit: orders, handing out and spares (Kit Convenor, Section Captains).
      { path: '/kit', element: lazyPage(() => import('./pages/Kit')) },
      // HKHA registration details (the Hockey Convenor only).
      { path: '/registration', element: lazyPage(() => import('./pages/Registration')) },
      { path: '/people', element: lazyPage(() => import('./pages/People')) },
      { path: '/people/:id', element: lazyPage(() => import('./pages/PersonAdmin')) },
      { path: '/suspensions', element: lazyPage(() => import('./pages/Suspensions')) },
      { path: '/club', element: lazyPage(() => import('./pages/Club')) },
      { path: '/data-checks', element: lazyPage(() => import('./pages/DataChecks')) },
      // This season's waivers & declarations.
      { path: '/waivers', element: lazyPage(() => import('./pages/Waivers')) },
      // A commitment review: the member, their sponsor or a Membership Officer.
      { path: '/review/:reviewId', element: lazyPage(() => import('./pages/CommitmentReview')) },
      // Coach view: fixtures, squad, ranking and team availability.
      {
        path: '/coach',
        element: lazyPage(() => import('./components/CoachLayout')),
        children: [
          { index: true, element: lazyPage(() => import('./pages/CoachDashboard')) },
          {
            // The dashboard (index route above) already IS the fixture
            // list - this only exists so an old bookmark/link lands
            // somewhere real instead of a 404.
            path: 'fixtures',
            element: <Navigate to="/coach" replace />,
          },
          { path: 'match/:matchId', element: lazyPage(() => import('./pages/SquadSelection')) },
          { path: 'ranking', element: lazyPage(() => import('./pages/PlayerRanking')) },
          { path: 'availability', element: lazyPage(() => import('./pages/TeamAvailability')) },
        ],
      },
      // An address Eddy doesn't have (an old link, a typo) lands on the player page.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

// index.html shows a static copy of this screen until the bundle runs. When
// it did, carry on from it instead of fading the text in a second time.
const textIn = document.getElementById('boot-loader') ? '' : 'animate-[fade-up_0.6s_ease-out_both]';

function AppLoading() {
  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center bg-background overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-48 left-1/2 -translate-x-1/2 h-[520px] w-[820px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary-tint) / 0.12), transparent 70%)' }}
      />
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
        <div className="mt-4 h-2 w-11 rounded-[100%] bg-primary-tint/25 blur-[1px] animate-[ball-shadow_0.9s_cubic-bezier(0.35,0,0.65,1)_infinite] motion-reduce:animate-none" />
        <div className="relative mt-10 text-center">
          <p className={`font-mono text-3xl font-bold tracking-[0.4em] pl-[0.4em] text-foreground ${textIn}`}>Eddy</p>
          <p className={`mt-2 text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground ${textIn} [animation-delay:120ms]`}>HKFC men's hockey</p>
          <p className={`mt-6 font-mono text-xs tracking-widest text-muted-foreground ${textIn} [animation-delay:240ms]`}>warming up…</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  );
}