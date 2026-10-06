import { hkDateKey } from '@shared/hkDateKey';
import { seasonStartYear } from '@shared/season';

/**
 * The season (July to June) as it stands in Hong Kong, e.g. "2026–27".
 * Worked out from the HK date, not the phone's, so a player abroad on the
 * night of 30 June sees the same season as the club.
 */
export function hkSeasonLabel(now: Date = new Date()): string {
  const start = seasonStartYear(hkDateKey(now.toISOString()));
  return `${start}–${String(start + 1).slice(2)}`;
}
