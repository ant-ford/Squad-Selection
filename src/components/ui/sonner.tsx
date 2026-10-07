import { useEffect, useState } from 'react';
import { onToastQueued, toasterReady } from '@/lib/toast';

type SonnerModule = typeof import('sonner');

/** Longest wait for an idle moment before sonner is fetched anyway. */
const IDLE_TIMEOUT_MS = 3000;

/**
 * Sonner's Toaster, loaded after start-up rather than with the app: toasts
 * only follow something the person did. It loads when the browser is first
 * idle, or at once if a toast is asked for sooner (lib/toast.ts queues it).
 */
export function Toaster() {
  const [sonner, setSonner] = useState<SonnerModule | null>(null);

  useEffect(() => {
    let done = false;
    const load = () => {
      if (done) return;
      done = true;
      import('sonner').then(setSonner, () => {
        // A failed chunk (offline, stale deploy) is retried at the next toast.
        done = false;
      });
    };
    const unsubscribe = onToastQueued(load);
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const timer = hasIdle
      ? window.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS })
      : window.setTimeout(load, IDLE_TIMEOUT_MS);
    return () => {
      unsubscribe();
      if (hasIdle) window.cancelIdleCallback(timer);
      else window.clearTimeout(timer);
    };
  }, []);

  // Effects run child-first, so sonner's Toaster has mounted and subscribed by
  // the time this hands it the queued toasts.
  useEffect(() => {
    if (sonner) toasterReady(sonner.toast);
  }, [sonner]);

  if (!sonner) return null;
  return <sonner.Toaster richColors position="top-center" />;
}
