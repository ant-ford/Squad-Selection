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
