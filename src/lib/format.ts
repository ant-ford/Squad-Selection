export { POS_SHORT } from '@shared/positions';

/**
 * Team name with the club prefix dropped: "HKFC C" reads as "C".
 *
 * Every team in the app is an HKFC team, so in a chip or a warning the prefix
 * is four characters that never distinguish anything - and repeated once per
 * team, it was what made a multi-team warning too long to scan. Only for
 * display; the full name is what the API and the eligibility rules speak.
 */
export function shortTeam(team: string): string {
  return team.replace(/\bHKFC\s+/g, '');
}

/** Up to two initials from a display name, uppercased. '?' when the name is blank. */
export function initials(name: string): string {
  return (name.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?').toUpperCase();
}
