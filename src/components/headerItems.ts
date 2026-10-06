import {
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  Flag,
  HeartHandshake,
  IdCard,
  ListChecks,
  Mail,
  PartyPopper,
  Shirt,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';

/** One line of a header menu: a screen to open, a page elsewhere (new tab), or something to do. */
export interface MenuEntry {
  label: string;
  icon: LucideIcon;
  to?: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

type MenuProfile = Partial<Pick<ProfileData, 'sections' | 'seasonPlans' | 'volunteers' | 'events' | 'isCoach' | 'umpiring' | 'quizzes'>>;

/** The officers' screens a person may open, in a fixed order, from what the Worker says. */
export function officerItems(p: MenuProfile): MenuEntry[] {
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

/** Screens a person opens often that used to be header buttons: the coaches' ranking and the umpiring duties. */
export function viewItems(p: MenuProfile): MenuEntry[] {
  return [
    ...(p.isCoach ? [{ to: '/coach/ranking', label: 'Ranking', icon: ListChecks }] : []),
    ...(p.umpiring ? [{ to: '/umpiring', label: 'Umpire view', icon: Flag }] : []),
  ];
}

/** Screens that aren't an office: the club stats and the quizzes. */
export function everyoneItems(p?: MenuProfile): MenuEntry[] {
  return [
    { to: '/stats', label: 'Stats', icon: Trophy },
    ...(p?.quizzes ? [{ to: '/quizzes', label: 'Hockey Rules quizzes', icon: BookOpenCheck }] : []),
  ];
}

/**
 * The burger's groups, top to bottom: the screen's own actions, the views
 * (ranking, umpiring), the screens for everyone, then the officers' screens.
 * Inviting someone is added by the menu itself.
 */
export function mainMenuGroups(p: MenuProfile | undefined, page: MenuEntry[] = []): MenuEntry[][] {
  return [page, viewItems(p ?? {}), everyoneItems(p), officerItems(p ?? {})].filter((g) => g.length > 0);
}

/** An icon-only header button: a 40 px square. */
export const headerIconClass =
  'h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
