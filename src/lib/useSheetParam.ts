import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allowSheetClose, sheetClosePlan, sheetOpenPlan, takeSheetClose } from '@/lib/sheetParam';

/**
 * One sheet's open state, kept in a search parameter so the phone's Back
 * (Android Back, the iOS edge swipe) closes the sheet rather than the screen.
 *
 *   const set = useSheetParam('set');
 *   set.value          // the open set's id, or null
 *   set.open(s.id)     // a new history entry: Back closes it
 *   set.close()        // back over that entry, or drops ?set= in place
 *
 * Other parameters on the screen (?team=, ?view=, …) are kept. A shared
 * link with the parameter opens the sheet; closing it then stays on the
 * screen. The rules are in src/lib/sheetParam.ts.
 */
export function useSheetParam(name: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const value = new URLSearchParams(location.search).get(name);

  // Read at the moment of a tap, which can be before the next render.
  const at = useRef(location);
  at.current = location;
  // The entry a close has already left, so a second close can't go back twice.
  const closedFrom = useRef<string | null>(null);

  // A close's Back that no dirty sheet was there to let through.
  useEffect(() => {
    takeSheetClose();
  }, [location.key]);

  const open = useCallback(
    (next: string = '1') => {
      const l = at.current;
      const plan = sheetOpenPlan(l, name, next);
      if (!plan) return;
      navigate({ pathname: l.pathname, search: plan.search, hash: l.hash }, { replace: plan.replace, state: plan.state, preventScrollReset: true });
    },
    [name, navigate],
  );

  const close = useCallback(() => {
    const l = at.current;
    if (closedFrom.current === l.key) return;
    const plan = sheetClosePlan(l, name);
    if (plan.kind === 'none') return;
    closedFrom.current = l.key;
    if (plan.kind === 'back') {
      allowSheetClose();
      navigate(-1);
    } else {
      navigate({ pathname: l.pathname, search: plan.search, hash: l.hash }, { replace: true, state: plan.state, preventScrollReset: true });
    }
  }, [name, navigate]);

  return { value, open, close };
}
