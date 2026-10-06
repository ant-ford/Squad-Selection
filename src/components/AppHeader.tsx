import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, IdCard } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/queries';
import { coachDashboardPath } from '@/lib/scrollMemory';
import { backTarget, canSwitchView, currentView, documentTitle } from '@/lib/header';
import { MainMenu, ProfileMenu } from '@/components/HeaderMenus';
import { headerIconClass, type MenuEntry } from '@/components/headerItems';
import type { GUIDE_URLS } from '@/components/HelpLink';

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
 * title … Player/Coach switch · profile menu. Pages pass only what is
 * theirs; the menus and the switch come from the signed-in person's profile.
 * At most four buttons on a phone (lib/header.ts phoneControls).
 */
export default function AppHeader({ title, back, menuItems, profileItems = [], guide }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { data: profile } = useMyProfile();
  const applicant = !!profile?.applicant;
  const view = currentView(location.pathname);
  const canSwitch = canSwitchView(profile);

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
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Player view"
        >
          <img src="/assets/logo-plain.svg" alt="Eddy" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
        </Link>
        <h1 className="flex-1 min-w-0 text-base sm:text-lg font-semibold text-foreground truncate">{title}</h1>
        {canSwitch && (
          <div
            role="group"
            aria-label="Player or coach view"
            className={`${back ? 'hidden sm:flex' : 'flex'} shrink-0 items-center rounded-md bg-muted p-0.5`}
          >
            <SwitchButton label="Player view" short="Player" active={view === 'player'} onClick={() => navigate('/')} />
            <SwitchButton label="Coach view" short="Coach" active={view === 'coach'} onClick={() => navigate(coachDashboardPath())} />
          </div>
        )}
        <ProfileMenu
          guide={guide ?? (view === 'coach' || location.pathname.startsWith('/coach') ? 'coach' : 'player')}
          onLogout={() => void signOut()}
          entries={applicant ? profileItems : [{ to: '/my-details', label: 'My details', icon: IdCard }, ...profileItems]}
        />
      </div>
    </header>
  );
}

function SwitchButton({ label, short, active, onClick }: { label: string; short: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`h-9 min-w-[3.25rem] px-2.5 rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
