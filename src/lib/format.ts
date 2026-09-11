/** Playing position abbreviations, used wherever a position needs to fit a chip or narrow column. */
export const POS_SHORT: Record<string, string> = {
  Goalkeeper: 'GK',
  Defender: 'DEF',
  Midfielder: 'MID',
  Forward: 'FWD',
  'Flexible/Varies': 'FLEX',
};

/** Up to two initials from a display name, uppercased. '?' when the name is blank. */
export function initials(name: string): string {
  return (name.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?').toUpperCase();
}

/**
 * Wording for the "Available" choice on a fixture.
 *
 * Before the squad is picked, a player is stating availability, so the
 * button says exactly that. Once they have been selected it is no longer a
 * statement of intent - they are in the side - and "Going" is what they
 * would say themselves.
 *
 * Only the wording changes. The value written is "Available" either way,
 * because that is what the availability model stores; selection is the
 * coach's decision and lives elsewhere.
 */
export function availableLabel(isSelected: boolean): string {
  return isSelected ? 'Going' : 'Available';
}
