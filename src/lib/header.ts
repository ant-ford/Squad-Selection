// Pure rules behind the one header (components/AppHeader.tsx), kept apart so
// tests can check them without a DOM.

/** Where a child screen's back arrow goes: back in history when this visit
 * came from another Eddy screen, otherwise to its parent screen. React
 * Router gives the first entry of a visit the key "default". */
export function backTarget(locationKey: string | undefined, parent: string): -1 | string {
  return locationKey && locationKey !== 'default' ? -1 : parent;
}

export type View = 'player' | 'coach' | 'umpire';

type SwitchProfile = { isCoach?: boolean; isSectionCaptain?: boolean; applicant?: boolean; umpiring?: unknown } | null | undefined;

/**
 * The views the Player / Coach / Umpire switch offers this person, in order.
 * Player is everyone's; Coach for those who can open the coach screens;
 * Umpire for the club's umpires and the Umpire Coordinator (profile.umpiring,
 * the same flag that used to show Umpire view in the menu). Applicants get none.
 */
export function switchViews(p: SwitchProfile): View[] {
  if (!p || p.applicant) return [];
  return [
    'player',
    ...(p.isCoach || p.isSectionCaptain ? (['coach'] as const) : []),
    ...(p.umpiring ? (['umpire'] as const) : []),
  ];
}

/** The switch shows when there is something to switch between. */
export function canSwitchView(p: SwitchProfile): boolean {
  return switchViews(p).length > 1;
}

/** Which view the current screen belongs to, if any. */
export function currentView(pathname: string): View | null {
  if (pathname === '/') return 'player';
  if (pathname === '/coach' || pathname.startsWith('/coach/')) return 'coach';
  if (pathname === '/umpiring' || pathname.startsWith('/umpiring/')) return 'umpire';
  return null;
}

export type HeaderControl = 'back' | 'menu' | 'switch' | 'profile';

/**
 * The header's controls on a phone, left to right. At most four: the
 * switch is one segmented control, and on a child screen the back arrow
 * takes its place (the switch returns from the sm breakpoint up, and the
 * logo still goes home).
 */
export function phoneControls({ back, canSwitch, applicant }: { back: boolean; canSwitch: boolean; applicant?: boolean }): HeaderControl[] {
  const out: HeaderControl[] = [];
  if (back) out.push('back');
  if (!applicant) out.push('menu');
  if (canSwitch && !back) out.push('switch');
  out.push('profile');
  return out;
}

/**
 * What else shows beside the switch on a phone, where the bar is too narrow
 * for the logo, the title and the switch together. On the switch's own
 * screens the switch names the view, so the title gives way (still the h1).
 * On any other screen the logo gives way (the switch's Player button goes
 * home too), so the title keeps its room. Without the switch, both show.
 */
export function phoneTitleRoom({ back, canSwitch, view }: { back: boolean; canSwitch: boolean; view: View | null }): { title: boolean; logo: boolean } {
  if (!phoneControls({ back, canSwitch }).includes('switch')) return { title: true, logo: true };
  return view ? { title: false, logo: true } : { title: true, logo: false };
}

/** The coach area's screens share one layout (CoachLayout), so their header comes from the path. */
export function coachScreen(pathname: string): { title: string; child: boolean } {
  if (pathname.startsWith('/coach/match/')) return { title: 'Squad selection', child: true };
  if (pathname.startsWith('/coach/ranking')) return { title: 'Ranking', child: false };
  if (pathname.startsWith('/coach/availability')) return { title: 'Team availability', child: false };
  return { title: 'Coach view', child: false };
}

/** The browser tab's title for a screen. */
export function documentTitle(title: string): string {
  return title ? `${title} · Eddy` : 'Eddy';
}
