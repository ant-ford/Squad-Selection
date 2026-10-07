import { Suspense, lazy, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, IdCard } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useMyProfile, usePushConfig } from '@/lib/queries';
import { useSheetParam } from '@/lib/useSheetParam';
import { coachDashboardPath } from '@/lib/scrollMemory';
import { backTarget, currentView, documentTitle, phoneTitleRoom, switchViews, type View } from '@/lib/header';
import { MainMenu, ProfileMenu } from '@/components/HeaderMenus';
import { headerIconClass, type MenuEntry } from '@/components/headerItems';
import type { GUIDE_URLS } from '@/components/HelpLink';

// Loaded when opened (Web Push, src/lib/push.ts).
const NotificationsSheet = lazy(() => import('@/components/NotificationsSheet'));

export interface AppHeaderProps {
  /** The screen's name: shown in the bar on every width, the page's h1 and the tab title ("Kit · Eddy"). */
  title: string;
  /** A child screen's parent. Shows the back arrow: back in history when the visit came from
   * another Eddy screen, otherwise to this path. */
  back?: string;
  /** The screen's own actions, at the top of the burger (e.g. Membership's CSV download). */
  menuItems?: MenuEntry[];
  /** The screen's own entries in the profile menu, after My details. */
  profileItems?: MenuEntry[];
  /** Which guide Help opens. Defaults to the coach guide in the coach area, the player guide elsewhere. */
  guide?: keyof typeof GUIDE_URLS;
}

/**
 * The one header on every signed-in screen: [back] burger · logo (home) ·
 * title … Player/Coach/Umpire switch · profile menu. Pages pass only what is
 * theirs; the menus and the switch come from the signed-in person's profile.
 * At most four buttons on a phone (lib/header.ts phoneControls), and beside
 * the switch the title or the logo, not both (phoneTitleRoom).
 */
export default function AppHeader({ title, back, menuItems, profileItems = [], guide }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { data: profile } = useMyProfile();
  const applicant = !!profile?.applicant;
  const view = currentView(location.pathname);
  const views = switchViews(profile);
  const canSwitch = views.length > 1;
  // On a phone the switch leaves room for the title or the logo, not both.
  const phone = phoneTitleRoom({ back: !!back, canSwitch, view });
  // Notifications: only once the Worker says it sends them.
  const { data: push } = usePushConfig(!!profile && !applicant && typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
  // ?notifications=1, so Back closes the sheet.
  const pushSheet = useSheetParam('notifications');
  const pushItems = push?.enabled && !applicant ? [{ label: 'Notifications', icon: Bell, onSelect: () => pushSheet.open() }] : [];

  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);

  const goBack = () => {
    if (!back) return;
    const to = backTarget(location.key, back);
    if (to === -1) navigate(-1);
    else navigate(to);
  };

  const signOut = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-2 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1 sm:gap-2">
        {back && (
          <button onClick={goBack} className={headerIconClass} aria-label="Back" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {!applicant && <MainMenu profile={profile} page={menuItems} />}
        <Link
          to="/"
          className={`h-10 w-10 shrink-0 ${phone.logo ? 'flex' : 'hidden sm:flex'} items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          title="Player view"
        >
          <img src="/assets/logo-plain.svg" alt="Eddy" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
        </Link>
        <h1
          title={title}
          className={`flex-1 min-w-0 text-base sm:text-lg font-semibold text-foreground truncate ${
            phone.title ? '' : 'max-sm:text-transparent max-sm:select-none'
          }`}
        >
          {title}
        </h1>
        {canSwitch && (
          <div
            role="group"
            aria-label="Switch view"
            className={`${back ? 'hidden sm:flex' : 'flex'} shrink-0 items-center rounded-md bg-muted p-0.5`}
          >
            {views.map((v) => (
              <SwitchButton
                key={v}
                label={VIEW_LABEL[v]}
                short={VIEW_SHORT[v]}
                active={view === v}
                onClick={() => navigate(v === 'player' ? '/' : v === 'coach' ? coachDashboardPath() : '/umpiring')}
              />
            ))}
          </div>
        )}
        <ProfileMenu
          guide={guide ?? (view === 'coach' || location.pathname.startsWith('/coach') ? 'coach' : 'player')}
          onLogout={() => void signOut()}
          entries={applicant ? profileItems : [{ to: '/my-details', label: 'My details', icon: IdCard }, ...profileItems, ...pushItems]}
        />
      </div>
      {pushSheet.value && push?.enabled && push.publicKey && (
        <Suspense fallback={null}>
          <NotificationsSheet publicKey={push.publicKey} onClose={pushSheet.close} />
        </Suspense>
      )}
    </header>
  );
}

const VIEW_LABEL: Record<View, string> = { player: 'Player view', coach: 'Coach view', umpire: 'Umpire view' };
const VIEW_SHORT: Record<View, string> = { player: 'Player', coach: 'Coach', umpire: 'Umpire' };

function SwitchButton({ label, short, active, onClick }: { label: string; short: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`h-9 min-w-11 sm:min-w-[3.25rem] px-1.5 sm:px-2.5 rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
