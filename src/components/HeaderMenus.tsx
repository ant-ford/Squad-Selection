import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleUserRound, HelpCircle, LogOut, Menu, UserPlus, type LucideIcon } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';
import { GUIDE_URLS } from '@/components/HelpLink';
import { headerIconClass, mainMenuGroups, type MenuEntry } from '@/components/headerItems';

export type { MenuEntry } from '@/components/headerItems';

// Loaded when opened, not with every page that has the menu.
const InviteDialog = lazy(() => import('@/components/InviteDialog'));

/**
 * An icon button that drops down groups of entries, split by rules. Closes on
 * a pick, a tap outside or Escape.
 */
function DropMenu({ label, icon: Icon, groups, align }: { label: string; icon: LucideIcon; groups: MenuEntry[][]; align: 'left' | 'right' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (e: MenuEntry) => {
    setOpen(false);
    if (e.to) navigate(e.to);
    else e.onSelect?.();
  };
  const row = 'w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-muted disabled:opacity-50';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={headerIconClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <Icon className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-1 w-60 rounded-md border border-border bg-card shadow-lg z-50 py-1`}
        >
          {groups
            .filter((g) => g.length > 0)
            .map((g, n) => (
              <div key={n} className={n > 0 ? 'border-t border-border mt-1 pt-1' : ''}>
                {g.map((e) =>
                  e.href ? (
                    <a
                      key={e.label}
                      role="menuitem"
                      href={e.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpen(false)}
                      className={`${row} text-foreground`}
                    >
                      <e.icon className="h-4 w-4" />
                      {e.label}
                    </a>
                  ) : (
                    <button
                      key={e.label}
                      role="menuitem"
                      disabled={e.disabled}
                      onClick={() => pick(e)}
                      aria-current={e.to && location.pathname === e.to ? 'page' : undefined}
                      className={`${row} ${e.to && location.pathname === e.to ? 'text-primary font-medium' : 'text-foreground'}`}
                    >
                      <e.icon className="h-4 w-4" />
                      {e.label}
                    </button>
                  ),
                )}
              </div>
            ))}
        </div>
      )}
    </div>
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
