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
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  const raw = err instanceof Error ? err.message : '';
  if (/expired|invalid/i.test(raw)) {
    return 'That code has already been used or has expired. Tap Resend email and use the code from the newest one.';
  }
  return raw || 'Could not sign you in. Please try again.';
}

/** Wording for a failed request to send the sign-in email. */
export function sendEmailErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  const raw = err instanceof Error ? err.message : '';
  return raw || 'Could not send the email. Please try again.';
}

// The browser never reached Supabase: the phone is offline, or an ad
// blocker, VPN, private DNS or filtered Wi-Fi is blocking supabase.co.
// Nothing reaches the auth logs, so the player is the only one who can fix
// it - and "Failed to fetch" tells them nothing.
const NETWORK_MESSAGE =
  "Couldn't reach the sign-in service. Check you're online, then try mobile data instead of Wi-Fi, or turn off any ad blocker, VPN or Private DNS.";

/**
 * Each browser words a blocked fetch differently: Chrome "Failed to fetch",
 * Firefox "NetworkError when attempting to fetch resource", Safari "Load
 * failed". Supabase passes the message through on an AuthRetryableFetchError.
 */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(err.message);
}
