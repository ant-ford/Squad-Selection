import type { User } from '@supabase/auth-js';

/**
 * Opening before the token refresh.
 *
 * The installed app usually opens with an expired access token (they last an
 * hour), and auth-js refreshes it over the network before getSession()
 * answers. Waiting for that kept the loading screen up even when the person's
 * fixtures were already on the phone (persistedQueries.ts). Instead, the app
 * starts as the person whose session auth-js saved, and getSession() confirms
 * it behind the screen. Every API call still waits for that confirmation
 * (apiClient's getAuthHeaders asks getSession for the token), so nothing is
 * sent on the strength of the saved copy alone.
 *
 * These are the rules; auth.tsx applies them.
 */

/**
 * The person in the session auth-js saved in localStorage, when it can still
 * be refreshed (it has a refresh token). Read only: the session itself is
 * auth-js's and is never written here.
 */
export function savedSessionUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as { user?: Partial<User> | null; refresh_token?: unknown } | null;
    const user = session?.user;
    if (!user || typeof user.id !== 'string' || !user.id) return null;
    if (typeof session?.refresh_token !== 'string' || !session.refresh_token) return null;
    return user as User;
  } catch {
    return null;
  }
}

export type StartupOutcome =
  /** Confirmed: show this person. `clearCache` when it isn't who the app opened as. */
  | { kind: 'signed-in'; user: User; clearCache: boolean }
  /** No session (refused or never signed in): the sign-in screen. `clearCache` when the app had opened as someone. */
  | { kind: 'signed-out'; clearCache: boolean }
  /** Supabase couldn't be reached: carry on as the saved person, if there is one. */
  | { kind: 'unconfirmed'; user: User | null };

/**
 * What getSession()'s first answer means, given who the app opened as.
 *
 * - A session: that person. If it's someone else (a sign-in link for another
 *   person opened on this phone), whatever was shown was the other person's
 *   and goes.
 * - No session and no error: signed out, typically a refresh Supabase refused
 *   (signed out elsewhere, made inactive, profile deleted). Anything shown
 *   from the saved copy goes with it.
 * - An error (no connection, Supabase down): nothing is known yet, so the app
 *   stays as it opened. Requests will refresh or sign out as they go
 *   (apiClient's authorisedFetch).
 */
export function startupOutcome(
  openedAs: User | null,
  result: { session: { user: User } | null; error: unknown },
): StartupOutcome {
  const user = result.session?.user ?? null;
  if (user) return { kind: 'signed-in', user, clearCache: !!openedAs && openedAs.id !== user.id };
  if (result.error && openedAs) return { kind: 'unconfirmed', user: openedAs };
  if (result.error) return { kind: 'unconfirmed', user: null };
  return { kind: 'signed-out', clearCache: !!openedAs };
}
