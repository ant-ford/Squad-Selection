// Crashes the app hits go to the Worker's error_log (POST /api/client-error,
// worker/src/systemHealth.ts), so they show on /system. Fire-and-forget:
// a report never shows anything, never retries and never signs anyone out
// (it skips apiClient on purpose). Signed-in only, each distinct error once
// per page load, at most MAX_PER_LOAD in all. The Worker rate-limits too.

import { supabase } from './supabase';
import { isChunkLoadError } from './staleDeploy';
import { browserInfo } from './browserInfo';

declare const __EDDY_BUILD__: string | undefined;
const BUILD = typeof __EDDY_BUILD__ === 'string' ? __EDDY_BUILD__ : 'dev';

const MAX_PER_LOAD = 5;
const sent = new Set<string>();

/**
 * What a report says about the error. Anything that isn't an Error or a
 * string is named by its type only: a rejected value can be a request body
 * or an API answer with people's details in it (security review, 7 Oct 2026).
 */
export function describeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  if (typeof error === 'string') return { message: error, stack: '' };
  if (error === null || error === undefined) return { message: String(error), stack: '' };
  const type = typeof error === 'object' ? (Object.getPrototypeOf(error)?.constructor?.name ?? 'Object') : typeof error;
  return { message: `Non-Error ${type}`, stack: '' };
}

export function reportClientError(kind: 'route' | 'error' | 'rejection', error: unknown, includeChunkError = false): void {
  try {
    // A stale deploy reloads itself (staleDeploy.ts); a failed API call is the Worker's to log.
    if ((!includeChunkError && isChunkLoadError(error)) || (error instanceof Error && error.name === 'ApiError')) return;
    const { message, stack } = describeError(error);
    const key = `${kind}|${message}`;
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 500),
      route: window.location.pathname,
      stack: stack.split('\n').slice(0, 8).join('\n').slice(0, 1500),
      build: BUILD,
      browser: browserInfo(navigator.userAgent),
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

/** All recovery listeners share this kind, so an unrecovered import is logged once. */
export function reportUnrecoveredScreenLoad(error: unknown): void {
  reportClientError('route', error, true);
}

/** Uncaught errors and unhandled promise rejections, from startup (main.tsx). */
export function installClientErrorReporting(): void {
  window.addEventListener('error', (event) => reportClientError('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportClientError('rejection', event.reason));
}
