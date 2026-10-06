// Pure rules behind the one header (components/AppHeader.tsx), kept apart so
// tests can check them without a DOM.

/** Where a child screen's back arrow goes: back in history when this visit
 * came from another Eddy screen, otherwise to its parent screen. React
 * Router gives the first entry of a visit the key "default". */
export function backTarget(locationKey: string | undefined, parent: string): -1 | string {
  return locationKey && locationKey !== 'default' ? -1 : parent;
}

/** The Player view / Coach view switch: only for people who can open the coach screens. */
export function canSwitchView(p?: { isCoach?: boolean; isSectionCaptain?: boolean; applicant?: boolean } | null): boolean {
  return !!p && !p.applicant && (!!p.isCoach || !!p.isSectionCaptain);
}

/** Which side of the switch the current screen belongs to, if either. */
export function currentView(pathname: string): 'player' | 'coach' | null {
  if (pathname === '/') return 'player';
  if (pathname === '/coach' || pathname.startsWith('/coach/')) return 'coach';
  return null;
}

export type HeaderControl = 'back' | 'menu' | 'player' | 'coach' | 'profile';

/**
 * The header's buttons on a phone, left to right. At most four: on a child
 * screen the back arrow takes the switch's place (the switch returns from
 * the sm breakpoint up, and the logo still goes home).
 */
export function phoneControls({ back, canSwitch, applicant }: { back: boolean; canSwitch: boolean; applicant?: boolean }): HeaderControl[] {
  const out: HeaderControl[] = [];
  if (back) out.push('back');
  if (!applicant) out.push('menu');
  if (canSwitch && !back) out.push('player', 'coach');
  out.push('profile');
  return out;
}

/** The coach area's screens share one layout (CoachLayout), so their header comes from the path. */
export function coachScreen(pathname: string): { title: string; child: boolean } {
  if (pathname.startsWith('/coach/match/')) return { title: 'Squad selection', child: true };
  if (pathname.startsWith('/coach/ranking')) return { title: 'Ranking', child: false };
  return { title: 'Coach view', child: false };
}

/** The browser tab's title for a screen. */
export function documentTitle(title: string): string {
  return title ? `${title} · Eddy` : 'Eddy';
}
