import { QueryClient } from '@tanstack/react-query';
import { authClientOptions } from './authClientOptions';
import { idbStore } from './idbStore';
import { createQueryPersister, storedSessionUserId } from './persistedQueries';

/**
 * The app's single QueryClient, in a module rather than inline in main.tsx so
 * non-component code can reach it - specifically the sign-out path, which has
 * to drop every cached response before the next person signs in.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,  // keep in memory for 30 mins
      retry: 1,
      refetchOnWindowFocus: false, // prevents re-fetches when coaches switch tabs
    },
  },
});

/** Set per build by vite.config.ts (`define`); absent under vitest. */
declare const __EDDY_BUILD__: string | undefined;
const BUILD_ID = typeof __EDDY_BUILD__ === 'string' ? __EDDY_BUILD__ : 'dev';

/**
 * The person's own profile, fixtures and tasks, kept on the phone for a day
 * (src/lib/persistedQueries.ts). auth.tsx tells it who is signed in and wipes
 * it on sign-out.
 */
export const queryPersister = createQueryPersister({ queryClient, store: idbStore('queries'), build: BUILD_ID });

/**
 * main.tsx, before the first render: whoever's session auth-js saved (read
 * only, never written) gets their kept data shown straight away. Waits at
 * most `waitMs` for storage; a slower answer still fills in whatever hasn't
 * arrived from the network by then. Never rejects.
 */
export function restorePersistedQueries(waitMs: number): Promise<void> {
  let userId: string | null = null;
  try {
    const { storageKey } = authClientOptions(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
    userId = storedSessionUserId(localStorage.getItem(storageKey!));
  } catch {
    userId = null;
  }
  queryPersister.setOwner(userId);
  queryPersister.start();
  const restoring = queryPersister.restore();
  // No session: nothing to show (restore just deletes any leftovers).
  if (!userId) return Promise.resolve();
  return Promise.race([restoring.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, waitMs))]);
}
