/**
 * Wording for a failed sign-in attempt.
 *
 * Supabase says "Token has expired or is invalid", which tells someone
 * staring at a code they have just typed nothing about what to do next. A
 * code is single-use and requesting another replaces the previous one, so
 * the answer is almost always "use the newest email".
 *
 * Lives here rather than in the login page because it is a pure string
 * function. Importing it from the page dragged in the Supabase client, which
 * throws at module load when its environment variables are absent - so the
 * test passed locally, where .env exists, and failed in CI, where it does
 * not.
 */
export function signInErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/expired|invalid/i.test(raw)) {
    return 'That code has already been used or has expired. Tap Resend email and use the code from the newest one.';
  }
  return raw || 'Could not sign you in. Please try again.';
}
