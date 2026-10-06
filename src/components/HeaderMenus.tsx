import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpenCheck,
  CalendarClock,
  CircleUserRound,
  ClipboardList,
  HeartHandshake,
  HelpCircle,
  IdCard,
  LogOut,
  Mail,
  Menu,
  PartyPopper,
  Shirt,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';
import { headerIconClass } from '@/components/AppHeader';
import { GUIDE_URLS } from '@/components/HelpLink';
import InviteDialog from '@/components/InviteDialog';

/** One line of a header menu: a screen to open, a page elsewhere (new tab), or something to do. */
export interface MenuEntry {
  label: string;
  icon: LucideIcon;
  to?: string;
  href?: string;
  onSelect?: () => void;
}

/** The officers' screens a person may open, in a fixed order, from what the Worker says. */
export function officerItems(p: {
  sections?: string[];
  seasonPlans?: boolean;
  volunteers?: boolean;
  events?: boolean;
}): MenuEntry[] {
  const s = p.sections ?? [];
  const all: (MenuEntry | false | undefined)[] = [
    s.includes('membership') && { to: '/membership', label: 'Membership', icon: Users },
    s.includes('chairman') && { to: '/chairman', label: 'Email lists', icon: Mail },
    (s.includes('planning') || p.seasonPlans) && { to: '/season-plans', label: 'Season plans', icon: ClipboardList },
    p.volunteers && { to: '/volunteers', label: 'Volunteers', icon: HeartHandshake },
    s.includes('trials') && { to: '/trial-sessions', label: 'Trial sessions', icon: CalendarClock },
    p.events && { to: '/events/manage', label: 'Events', icon: PartyPopper },
    s.includes('kit') && { to: '/kit', label: 'Kit', icon: Shirt },
    s.includes('registration') && { to: '/registration', label: 'HKHA registration', icon: IdCard },
  ];
  return all.filter((i): i is MenuEntry => !!i);
}

/** Screens that aren't an office: the club stats and the quizzes. Umpiring has its own header button (UmpireViewButton). */
function everyoneItems(p?: ProfileData): MenuEntry[] {
  return [
    { to: '/stats', label: 'Stats', icon: Trophy },
    ...(p?.quizzes ? [{ to: '/quizzes', label: 'Hockey Rules quizzes', icon: BookOpenCheck }] : []),
  ];
}

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
  const row = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted';

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
                      onClick={() => pick(e)}
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
 * The burger at the top left: the screens for everyone (stats, the
 * quizzes), then the officers' screens a person may open, then
 * inviting someone to join.
 */
export function MainMenu({ officer, profile }: { officer: MenuEntry[]; profile?: ProfileData }) {
  const [showInvite, setShowInvite] = useState(false);
  const invite = profile?.inviteLink ? `${window.location.origin}/join${new URL(profile.inviteLink).search}` : null;
  const groups = [
    everyoneItems(profile),
    officer,
    invite ? [{ label: 'Invite someone to join', icon: UserPlus, onSelect: () => setShowInvite(true) }] : [],
  ];
  return (
    <>
      <DropMenu label="Menu" icon={Menu} groups={groups} align="left" />
      {showInvite && invite && <InviteDialog link={invite} onClose={() => setShowInvite(false)} />}
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
