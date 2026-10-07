import { Suspense, lazy, useState } from 'react';
import { CircleUserRound, HelpCircle, LogOut, Menu, UserPlus, type LucideIcon } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';
import { GUIDE_URLS } from '@/components/HelpLink';
import { headerIconClass, mainMenuGroups, type MenuEntry } from '@/components/headerItems';

export type { MenuEntry } from '@/components/headerItems';

// Loaded when opened, not with every page that has the menu.
const InviteDialog = lazy(() => import('@/components/InviteDialog'));

export type DropMenuProps = { label: string; icon: LucideIcon; groups: MenuEntry[][]; align: 'left' | 'right' };

// The menus' code (Radix and its positioning) loads just after the page, in
// its own file, so it isn't part of the first download. Until then the
// button is drawn as it will look.
const LazyDropMenu = lazy(() => import('@/components/HeaderDropMenu'));

function DropMenu(props: DropMenuProps) {
  const { label, icon: Icon } = props;
  return (
    <Suspense
      fallback={
        <button type="button" className={headerIconClass} aria-haspopup="menu" aria-label={label} title={label}>
          <Icon className="h-5 w-5" />
        </button>
      }
    >
      <LazyDropMenu {...props} />
    </Suspense>
  );
}

/**
 * The burger at the top left: the screen's own actions, the views (ranking,
 * umpiring), the screens for everyone, the officers' screens a person may
 * open, then inviting someone to join.
 */
export function MainMenu({ profile, page }: { profile?: ProfileData; page?: MenuEntry[] }) {
  const [showInvite, setShowInvite] = useState(false);
  const invite = profile?.inviteLink ? `${window.location.origin}/join${new URL(profile.inviteLink).search}` : null;
  const groups = [
    ...mainMenuGroups(profile, page),
    invite ? [{ label: 'Invite someone to join', icon: UserPlus, onSelect: () => setShowInvite(true) }] : [],
  ];
  return (
    <>
      <DropMenu label="Menu" icon={Menu} groups={groups} align="left" />
      {showInvite && invite && (
        <Suspense fallback={null}>
          <InviteDialog link={invite} onClose={() => setShowInvite(false)} />
        </Suspense>
      )}
    </>
  );
}

/** The person button at the top right: their own things, then the guide, then log out. */
export function ProfileMenu({ entries, guide, onLogout }: { entries: MenuEntry[]; guide: keyof typeof GUIDE_URLS; onLogout: () => void }) {
  return (
    <DropMenu
      label="My account"
      icon={CircleUserRound}
      align="right"
      groups={[entries, [{ label: 'Help', icon: HelpCircle, href: GUIDE_URLS[guide] }], [{ label: 'Log out', icon: LogOut, onSelect: onLogout }]]}
    />
  );
}
