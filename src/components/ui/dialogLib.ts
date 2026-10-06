import { createContext, useEffect, useState } from 'react';

/**
 * Radix Dialog, loaded on first use rather than with the first page: the
 * player page holds several sheets but opens none until someone taps. It is
 * fetched as soon as the browser is idle, so the first sheet still opens at
 * once.
 */
export type DialogLib = typeof import('@radix-ui/react-dialog');

let lib: DialogLib | null = null;
let loading: Promise<DialogLib> | null = null;

export function loadDialogLib(): Promise<DialogLib> {
  loading ??= import('@radix-ui/react-dialog').then(
    (m) => (lib = m),
    (err) => {
      loading = null; // a later open tries again
      throw err;
    },
  );
  return loading;
}

/** The library once it has loaded (null before); `wanted` starts the load. */
export function useDialogLib(wanted: boolean): DialogLib | null {
  const [, loaded] = useState(0);
  useEffect(() => {
    if (wanted && !lib) loadDialogLib().then(() => loaded((n) => n + 1), () => {});
  }, [wanted]);
  return lib;
}

/** Hands the loaded library from Sheet to SheetContent and SheetTitle. */
export const DialogLibContext = createContext<DialogLib | null>(null);

if (typeof window !== 'undefined') {
  const whenIdle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  whenIdle(() => void loadDialogLib().catch(() => {}));
}
