/**
 * Application-access denial, held outside React so the API client can raise
 * it from a plain fetch handler.
 *
 * The client used to answer a 403 APPLICATION_ACCESS_DENIED by signing the
 * player out. That threw away a perfectly good session over an
 * authorisation failure: they are who they say they are, they just are not
 * on the list yet. The visible result was "I have to log in every time",
 * because every load ended in a forced sign-out, and it made an Airtable
 * data problem look like a broken login.
 *
 * Now the denial is recorded here instead. The session survives, one screen
 * explains the situation, and Retry costs a tap rather than another trip
 * through the email.
 */

type Listener = () => void;

let deniedMessage: string | null = null;
const listeners = new Set<Listener>();

/** Called by the API client on 403 APPLICATION_ACCESS_DENIED, and to clear. */
export function setAccessDenied(message: string | null): void {
  if (deniedMessage === message) return;
  deniedMessage = message;
  for (const listener of listeners) listener();
}

/** Snapshot for useSyncExternalStore. Must be referentially stable. */
export function getAccessDenied(): string | null {
  return deniedMessage;
}

export function subscribeAccessDenied(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
