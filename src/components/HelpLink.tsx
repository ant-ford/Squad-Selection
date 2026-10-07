import type { ProfileData } from '@/api/getMyProfile';

/**
 * The guides, published from the eddy-site repository to eddy.global: the
 * players', coaches', Kit Convenor's and social secretaries', and the
 * officers' (Men's Convenor, Section Captains, Membership Officer, Umpire
 * Coordinator). Linked rather than copied into the app, so that repository
 * stays their one source. Help in the header's profile menu opens the
 * screen's guide (AppHeader `guide`).
 */
export const GUIDE_URLS = {
  player: 'https://eddy.global/guides/players/',
  coach: 'https://eddy.global/guides/coaches/',
  kit: 'https://eddy.global/guides/kit/',
  events: 'https://eddy.global/guides/events/',
  convenor: 'https://eddy.global/guides/convenor/',
  captains: 'https://eddy.global/guides/captains/',
  membership: 'https://eddy.global/guides/membership/',
  umpiring: 'https://eddy.global/guides/umpiring/',
} as const;

export type Guide = keyof typeof GUIDE_URLS;

/**
 * For the screens several offices open (People, a person's page, Data
 * checks): the guide for the viewer's own office. Someone holding more than
 * one gets the Section Captains' guide first, then the Men's Convenor's.
 */
export function officerGuide(profile: Pick<ProfileData, 'officerRoles'> | undefined, fallback: Guide): Guide {
  const offices = new Set(profile?.officerRoles.map((r) => r.office));
  if (offices.has('sectionCaptain')) return 'captains';
  if (offices.has('hockeyConvenor')) return 'convenor';
  if (offices.has('membershipOfficer')) return 'membership';
  return fallback;
}
