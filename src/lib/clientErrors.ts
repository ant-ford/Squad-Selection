// Crashes the app hits go to the Worker's error_log (POST /api/client-error,
// worker/src/systemHealth.ts), so they show on /system. Fire-and-forget:
// a report never shows anything, never retries and never signs anyone out
// (it skips apiClient on purpose). Signed-in only, each distinct error once
// per page load, at most MAX_PER_LOAD in all. The Worker rate-limits too.

import { supabase } from './supabase';
import { isChunkLoadError } from './staleDeploy';

const MAX_PER_LOAD = 5;
const sent = new Set<string>();

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  if (typeof error === 'string') return { message: error, stack: '' };
  try {
    return { message: JSON.stringify(error)?.slice(0, 300) ?? String(error), stack: '' };
  } catch {
    return { message: String(error), stack: '' };
  }
}

export function reportClientError(kind: 'route' | 'error' | 'rejection', error: unknown): void {
  try {
    // A stale deploy reloads itself (staleDeploy.ts); a failed API call is the Worker's to log.
    if (isChunkLoadError(error) || (error instanceof Error && error.name === 'ApiError')) return;
    const { message, stack } = describe(error);
    const key = `${kind}|${message}`;
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 500),
      route: window.location.pathname,
      stack: stack.split('\n').slice(0, 8).join('\n').slice(0, 1500),
    });
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) return;
        return fetch(`${import.meta.env.VITE_API_URL}/api/client-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body,
          keepalive: true,
        });
      })
      .catch(() => {});
  } catch {
    // Reporting must never be the next crash.
  }
}

/** Uncaught errors and unhandled promise rejections, from startup (main.tsx). */
export function installClientErrorReporting(): void {
  window.addEventListener('error', (event) => reportClientError('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportClientError('rejection', event.reason));
}
