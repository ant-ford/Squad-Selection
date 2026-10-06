import { useLayoutEffect, useRef } from 'react';

// Per browser tab (sessionStorage): coming back to a list should land where
// you left it, but a fresh visit tomorrow can start from the top.
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: positions just aren't remembered.
  }
}

/**
 * Remembers how far down the window a page was scrolled and puts it back
 * when the page is opened again - so a coach editing fixtures near the
 * bottom of the list doesn't have to scroll back down after each one.
 *
 * `ready` must stay false while the list is still a skeleton: restoring
 * against a short placeholder would clamp to the top. Scrolls before the
 * restore aren't recorded either, or the clamp from leaving a long page
 * would overwrite the position we're about to put back.
 */
export function useScrollMemory(key: string, ready: boolean) {
  const storageKey = `scroll:${key}`;
  const restored = useRef(false);

  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const y = Number(read(storageKey));
    if (y > 0) window.scrollTo(0, y);
  }, [storageKey, ready]);

  // Layout-effect cleanup runs as the page unmounts, before the browser can
  // fire the scroll event caused by the next page being shorter.
  useLayoutEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (!restored.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => write(storageKey, String(Math.round(window.scrollY))));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [storageKey]);
}

const TEAM_AVAILABILITY_OPEN = 'team-availability-open';

/**
 * The teams opened on Team availability. A fresh visit starts with every
 * team closed; coming back in the same tab keeps the ones left open.
 */
export function openTeamAvailability(): string[] {
  try {
    const teams: unknown = JSON.parse(read(TEAM_AVAILABILITY_OPEN) ?? '[]');
    return Array.isArray(teams) ? teams.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberOpenTeamAvailability(teams: Iterable<string>) {
  write(TEAM_AVAILABILITY_OPEN, JSON.stringify([...teams]));
}

const COACH_DASHBOARD_SEARCH = 'coach-dashboard-search';

/** Called by the fixture list whenever its team tab or past toggle changes. */
export function rememberCoachDashboardSearch(search: string) {
  write(COACH_DASHBOARD_SEARCH, search);
}

/**
 * The coach dashboard with the team tab and past toggle last used, so
 * "Back to Fixtures" returns to the HKFC B list rather than All.
 */
export function coachDashboardPath(): string {
  const search = read(COACH_DASHBOARD_SEARCH);
  return search ? `/coach?${search}` : '/coach';
}
