import { Suspense, lazy, useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, useRouteError, Navigate } from 'react-router-dom';
import { usePrefetchQuery, useQuery } from '@tanstack/react-query';
import { myFixturesQuery, myTasksQuery, useMyProfile } from '@/lib/queries';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider, useAuth } from '@/lib/auth';
import { isChunkLoadError } from '@/lib/staleDeploy';
import { recoverScreenLoad } from '@/lib/chunkRecovery';
import { reportClientError, reportUnrecoveredScreenLoad } from '@/lib/clientErrors';
import { getAccessDenied, subscribeAccessDenied } from '@/lib/accessDenied';
import PlayerDashboard from './pages/PlayerDashboard';
import AppLoading from '@/components/AppLoading';
import StartupLoadingGate, { StartupLoadingProvider } from '@/components/StartupLoadingGate';
import { ErrorState } from '@/components/ui/error-state';

// Only signed-out people see Login, and only someone without access sees
// AccessNotActive, so a signed-in player never downloads either.
const Login = lazy(() => import('./pages/Login'));
const AccessNotActive = lazy(() => import('@/components/AccessNotActive'));

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
  if (!user) return <Suspense fallback={<AppLoading />}><Login /></Suspense>;
  if (accessDenied && pendingJoin()) return <Navigate to="/join" replace />;
  if (accessDenied) return <Suspense fallback={<AppLoading />}><AccessNotActive message={accessDenied} /></Suspense>;
  return <Outlet />;
}

/** The player page, or for an applicant (or someone registering to join) their application. */
function Home() {
  // The player page's own reads go out with the profile, not after it. The
  // dashboard's fixtures observer is the one that stays enabled: this one only
  // watches for the data, so it never refetches a variant that's off screen.
  usePrefetchQuery(myFixturesQuery(true));
  usePrefetchQuery(myTasksQuery);
  const fixtures = useQuery({ ...myFixturesQuery(true), enabled: false });
  const fixturesIn = fixtures.data !== undefined;
  const { data, isLoading } = useMyProfile();
  if (data?.applicant) return <Navigate to="/apply" replace />;
  // A fast profile response mustn't replace the ball with empty fixture tiles.
  // Cached fixtures still open immediately; failed reads reach the retry screen.
  if ((isLoading && !fixturesIn) || fixtures.isPending) return <AppLoading />;
  // Don't mount another fixtures observer on an initial error: its automatic
  // refetch would replace the retry controls with the loader all over again.
  if (fixtures.isError && !fixturesIn) return <ErrorState variant="page" title="Could not load your fixtures" message="Check your connection and try again." onRetry={() => fixtures.refetch()} retrying={fixtures.isFetching} />;
  return <PlayerDashboard />;
}

/**
 * A screen loaded on its first visit, so Player view doesn't carry it. The
 * loading screen stays visible while its chunk downloads; a chunk that fails to load
 * reaches RouteError, which recovers from a stale deploy.
 */
function lazyPage(load: () => Promise<{ default: ComponentType }>, startup = true) {
  const Page = lazy(load);
  return (
    <Suspense fallback={<AppLoading />}>
      {startup ? <StartupLoadingGate><Page /></StartupLoadingGate> : <Page />}
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
    if (isChunkLoadError(error)) void recoverScreenLoad(error, reportUnrecoveredScreenLoad);
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
      { path: '/', element: <StartupLoadingGate><Home /></StartupLoadingGate> },
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
        // The leaf screen completes startup; a layout's profile can arrive before its child's reads start.
        element: lazyPage(() => import('./components/CoachLayout'), false),
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

export default function App() {
  return (
    <AuthProvider>
      <StartupLoadingProvider>
        <RouterProvider router={router} />
      </StartupLoadingProvider>
      <Toaster />
    </AuthProvider>
  );
}
