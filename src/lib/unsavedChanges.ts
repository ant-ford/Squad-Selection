/**
 * The rules behind useUnsavedChanges (src/lib/useUnsavedChanges.tsx), kept
 * free of React so they can be tested on their own.
 */

/** What the leave prompt says unless a screen gives its own words. */
export const UNSAVED_MESSAGE = 'Your changes will be lost.';

/** Said by forms that keep a draft on the device (useDraft). */
export const DRAFT_KEPT_MESSAGE = "What you've typed stays on this device until you save it.";

interface PathOnly {
  pathname: string;
}

/**
 * Whether a navigation should stop and ask first: only while something is
 * unsaved, only when it leaves the page, and not when the screen has said
 * the next navigation is its own (a save that moves on).
 *
 * A change of search params or hash stays on the page (a filter, a tab, the
 * next step of a form that saves as it goes), so it never asks.
 */
export function blocksNavigation({
  dirty,
  allowed = false,
  from,
  to,
}: {
  dirty: boolean;
  /** The screen asked to let the next navigation through. */
  allowed?: boolean;
  from: PathOnly;
  to: PathOnly;
}): boolean {
  if (!dirty || allowed) return false;
  return from.pathname !== to.pathname;
}

/**
 * The browser's own "Leave site?" prompt for a reload, a closed tab or a
 * typed address. Browsers show their own words; the handler only asks.
 */
export function askBeforeUnload(event: Pick<BeforeUnloadEvent, 'preventDefault'> & { returnValue?: unknown }): void {
  event.preventDefault();
  // Older browsers need returnValue set as well as preventDefault.
  event.returnValue = '';
}
