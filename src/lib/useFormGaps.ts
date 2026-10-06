import { useState } from 'react';
import { focusGap, gapSummary, type Gap } from '@/lib/formGaps';

/**
 * The submit button stays enabled. `check()` on tap: with gaps it shows the
 * list (`summary`, for next to the button), jumps to the first gap and
 * returns false; with none it returns true. Once shown, the list follows
 * the form, shrinking as the gaps are filled.
 */
export function useFormGaps(gaps: Gap[]) {
  const [tapped, setTapped] = useState(false);
  const check = () => {
    setTapped(true);
    if (gaps.length === 0) return true;
    focusGap(gaps[0]);
    return false;
  };
  const shown = tapped ? gaps : [];
  return { check, summary: gapSummary(shown), missing: (id: string) => shown.some((g) => g.id === id) };
}
