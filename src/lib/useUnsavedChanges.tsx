import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import ConfirmDialog from '@/components/ConfirmDialog';
import { UNSAVED_MESSAGE, askBeforeUnload, blocksNavigation } from '@/lib/unsavedChanges';

/**
 * Asks before leaving a page with unsaved changes.
 *
 *   const leave = useUnsavedChanges(dirty);
 *   ...
 *   {leave.prompt}
 *
 * - Moving to another page in the app (a link, the header, Back) stops and
 *   shows `prompt`: Leave or Stay. Changing the search params (filters, tabs,
 *   the next step) does not ask.
 * - A reload, closing the tab or typing an address gets the browser's own
 *   "Leave site?" prompt.
 * - A save that moves on calls `allowNavigation()` just before it navigates,
 *   since `dirty` is still true until the next render.
 *
 * Needs the data router (createBrowserRouter, App.tsx). The router supports
 * one blocker at a time, so use it once per screen: in the page, or in the
 * one step or form on screen.
 */
export function useUnsavedChanges(dirty: boolean, message: string = UNSAVED_MESSAGE) {
  // Read when a navigation starts, which can be before the next render.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const allowedRef = useRef(false);

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const allowed = allowedRef.current;
    allowedRef.current = false;
    return blocksNavigation({ dirty: dirtyRef.current, allowed, from: currentLocation, to: nextLocation });
  }, []);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!allowedRef.current) askBeforeUnload(e);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Saved (or undone) while the prompt was up: nothing to ask about any more.
  useEffect(() => {
    if (blocker.state === 'blocked' && !dirty) blocker.reset();
  }, [blocker, dirty]);

  const allowNavigation = useCallback(() => {
    allowedRef.current = true;
  }, []);

  const prompt: ReactNode =
    blocker.state === 'blocked' ? (
      <ConfirmDialog
        title="Leave without saving?"
        message={message}
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onConfirm={() => blocker.proceed()}
        onCancel={() => blocker.reset()}
      />
    ) : null;

  return { prompt, allowNavigation };
}
