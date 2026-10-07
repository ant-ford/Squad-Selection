/**
 * The rules behind useSheetParam (src/lib/useSheetParam.ts), kept free of
 * React so they can be tested on their own.
 *
 * A sheet that lives in the URL (?fixture=<id>, ?set=<id>, ?history=1, …)
 * is opened with a new history entry, so the phone's Back closes it. Closing
 * it from the sheet goes back over that entry, or, when there is none to go
 * back over (a shared link, a fresh tab), drops the parameter in place.
 * Either way the screen stays, and Back never reopens a closed sheet.
 */

/**
 * History state on an entry pushed over the same screen: the pathname
 * underneath. Going back from such an entry stays on the screen.
 */
export const SHEET_OVER = 'sheetOver';

export interface SheetLocation {
  pathname: string;
  search: string;
  state: unknown;
}

export type SheetOpenPlan = { search: string; replace: boolean; state: unknown } | null;
export type SheetClosePlan = { kind: 'none' } | { kind: 'back' } | { kind: 'replace'; search: string; state: unknown };

const withQuestionMark = (params: URLSearchParams) => {
  const s = params.toString();
  return s ? `?${s}` : '';
};

/** The search string with `name` set to `value`; every other parameter kept. */
export function searchWith(search: string, name: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set(name, value);
  return withQuestionMark(params);
}

/** The search string without `name`; every other parameter kept. */
export function searchWithout(search: string, name: string): string {
  const params = new URLSearchParams(search);
  params.delete(name);
  return withQuestionMark(params);
}

/** `state` with the "pushed over this screen" mark added (other keys kept). */
export function markedState(state: unknown, pathname: string): Record<string, unknown> {
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  return { ...base, [SHEET_OVER]: pathname };
}

/** Whether going back from this entry stays on the same screen. */
export function backStaysOnScreen(state: unknown, pathname: string): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[SHEET_OVER] === pathname;
}

/**
 * Opening: a new entry, marked, when the sheet is closed; when it's already
 * open on another value (the next player), the value is swapped in place.
 */
export function sheetOpenPlan(at: SheetLocation, name: string, value: string): SheetOpenPlan {
  const current = new URLSearchParams(at.search).get(name);
  if (current === value) return null;
  const search = searchWith(at.search, name, value);
  if (current !== null) return { search, replace: true, state: at.state };
  return { search, replace: false, state: markedState(at.state, at.pathname) };
}

/**
 * Closing from the sheet (X, backdrop, Escape, a save): back over the entry
 * the opening pushed, or the parameter dropped in place when this entry
 * wasn't pushed over the screen.
 */
export function sheetClosePlan(at: SheetLocation, name: string): SheetClosePlan {
  if (!new URLSearchParams(at.search).has(name)) return { kind: 'none' };
  if (backStaysOnScreen(at.state, at.pathname)) return { kind: 'back' };
  return { kind: 'replace', search: searchWithout(at.search, name), state: at.state };
}

/**
 * History state for an in-app link to a sheet on the screen it's shown on
 * (the My Tasks line's /?event=<id>), so closing that sheet goes back too.
 */
export function sheetLinkState(to: string, pathname: string): Record<string, unknown> | undefined {
  const target = new URL(to, 'https://eddy.invalid');
  return target.pathname === pathname && target.search ? markedState(undefined, pathname) : undefined;
}

// A dirty sheet stops Back to ask first (Sheet in ui/sheet.tsx). The Back a
// sheet's own close makes is let through: it's already been asked about.
let closeAllowed = false;

/** Called just before a sheet's own close goes back. */
export function allowSheetClose(): void {
  closeAllowed = true;
}

/** Whether this Back is a sheet's own close (and uses up the allowance). */
export function takeSheetClose(): boolean {
  const allowed = closeAllowed;
  closeAllowed = false;
  return allowed;
}
