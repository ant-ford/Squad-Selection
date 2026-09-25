// Every network call the frontend makes for app data goes through here.
// The browser never talks to Airtable directly and never sees an Airtable
// token — it only ever calls this Worker.

import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { signOut } from './auth';
import { setAccessDenied } from './accessDenied';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  // Fails loudly at startup rather than producing confusing "Failed to
  // fetch" errors scattered across the app.
  throw new Error(
    'Missing VITE_API_URL environment variable. Set it to your deployed ' +
      'Worker URL, e.g. https://api.eddy.global'
  );
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: { error?: string; message?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    // 401 UNAUTHORIZED. By the time a response gets here, authorisedFetch has
    // already refreshed the session and retried, and has signed out if the
    // session really is over - see there. Nothing more to do but report it.
    if (response.status === 401) {
      throw new ApiError(
        data?.message || 'Session expired. Please log in again.',
        401,
        data?.error,
      );
    }

    if (response.status === 403) {
      // 403 APPLICATION_ACCESS_DENIED: authenticated, but not on the list -
      // an unknown email, or a People record that is not Active and carries
      // no coach link and no Active officer row.
      //
      // Deliberately does NOT sign out. Authentication succeeded; only
      // authorisation failed, and destroying the session over that forced a
      // fresh trip through the email on every single load. That is what
      // players reported as "I have to log in every time", and it made an
      // Airtable data problem look like a broken login. AuthGate shows a
      // screen explaining it, with Retry, which matters because the People
      // lookup is cached for 60s and the first retry after an admin ticks
      // the box often still fails.
      if (data?.error === 'APPLICATION_ACCESS_DENIED') {
        setAccessDenied(data.message || 'Your access is not active.');
        throw new ApiError(data.message || 'Access denied.', 403, data.error);
      }

      // 403 COACH_ACCESS_REQUIRED: legit user without coach rights for this
      // operation. Show the error but stay logged in.
      if (data?.error === 'COACH_ACCESS_REQUIRED') {
        toast.error(data.message || 'You do not have coach permissions for this action.');
        throw new ApiError(data.message || 'Coach access required.', 403, data.error);
      }
    }

    const message = data?.message || data?.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data?.error);
  }

  return data;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

function toSearchParams(params?: QueryParams): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${search.toString()}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RefreshOutcome = 'refreshed' | 'rejected' | 'unreachable';

/**
 * One refresh at a time. A screen fires several requests at once, and when
 * the access token has just expired they all get a 401 together; they
 * should share one refresh rather than race each other.
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

function refreshSessionOnce(): Promise<RefreshOutcome> {
  refreshInFlight ??= supabase.auth
    .refreshSession()
    .then(({ data, error }): RefreshOutcome => {
      if (data.session) return 'refreshed';
      // No network, or Supabase unreachable: the session may be perfectly
      // good. Only a definite answer from Supabase ends it.
      if (error && isAuthRetryableFetchError(error)) return 'unreachable';
      return 'rejected';
    })
    .catch((): RefreshOutcome => 'unreachable')
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Sends an authenticated request, and keeps the user signed in whenever the
 * session can be saved.
 *
 * Supabase access tokens last an hour, but the refresh token behind them does
 * not expire. So a 401 usually just means the access token ran out - a phone
 * left asleep, a request that outlived it - and the session is fine. The
 * request is retried once with a refreshed token. The user is signed out
 * (on this device only) when Supabase refuses the refresh itself, which is
 * what a revoked or signed-out session looks like; being offline, or
 * Supabase being unreachable, never signs anyone out.
 *
 * This used to sign out on the first 401, everywhere, which is how users kept
 * finding themselves logged out of every device.
 */
async function authorisedFetch(
  method: string,
  path: string,
  init: (headers: Record<string, string>) => RequestInit,
): Promise<Response> {
  const response = await timedFetch(method, path, init(await getAuthHeaders()));
  if (response.status !== 401) return response;

  const outcome = await refreshSessionOnce();
  if (outcome === 'refreshed') {
    return timedFetch(method, path, init(await getAuthHeaders()));
  }
  if (outcome === 'rejected') {
    await signOut().catch(() => {});
  }
  return response;
}

/**
 * Single choke point for app-data requests. Logs one line per request at
 * console.debug (devtools verbose) so browser-side request counts and
 * latency per page can be compared with the Worker's perf.request lines in
 * Workers Logs. React Query requests all funnel through here.
 */
async function timedFetch(method: string, path: string, init: RequestInit): Promise<Response> {
  const startedAt = performance.now();
  const response = await fetch(`${API_URL}${path}`, init);
  console.debug(
    `[perf] ${method} ${path} ${response.status} ${Math.round(performance.now() - startedAt)}ms`,
  );
  return response;
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await authorisedFetch('GET', `${path}${toSearchParams(params)}`, (headers) => ({ headers }));
  return parseResponse(response) as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await authorisedFetch('POST', path, (headers) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  return parseResponse(response) as Promise<T>;
}
