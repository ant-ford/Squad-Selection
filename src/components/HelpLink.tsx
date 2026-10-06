/**
 * The player, coach, Kit Convenor and social secretary guides, published from the eddy-site repository to
 * eddy.global. Linked rather than copied into the app, so that repository
 * stays their one source. Help in the header's profile menu opens the
 * screen's guide (AppHeader `guide`).
 */
export const GUIDE_URLS = {
  player: 'https://eddy.global/guides/players/',
  coach: 'https://eddy.global/guides/coaches/',
  kit: 'https://eddy.global/guides/kit/',
  events: 'https://eddy.global/guides/events/',
} as const;
