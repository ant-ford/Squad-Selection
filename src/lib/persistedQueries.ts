import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Keeps the signed-in person's own profile, fixtures and tasks on the phone,
 * so the installed app opens on what they last saw and refreshes behind it.
 *
 * Only those three queries are kept, and only for the person who fetched them
 * on this build of the app, for at most a day. Log out, a lapsed session and
 * a different person signing in all wipe them. Storage that fails (private
 * mode, quota, no IndexedDB) is ignored: the app then starts as it always did.
 *
 * The logic is here; the IndexedDB adapter is src/lib/idbStore.ts and the
 * wiring is src/lib/queryClient.ts, main.tsx and auth.tsx.
 */

/** The first part of each persisted query's key: useMyProfile, myFixturesQuery (both variants), myTasksQuery. */
export const PERSISTED_QUERY_ROOTS = ['myProfile', 'myFixtures', 'myTasks'] as const;

/** Kept data older than this is ignored and deleted. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long after a change the cache is written (several answers in a row make one write). */
export const PERSIST_THROTTLE_MS = 1000;

/** Bumped if the stored record's own shape changes. */
const RECORD_VERSION = 1;

export function isPersistedQueryKey(queryKey: QueryKey): boolean {
  return (PERSISTED_QUERY_ROOTS as readonly unknown[]).includes(queryKey[0]);
}

/** One of the three, holding data from a successful fetch (or an answer laid over one). */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return isPersistedQueryKey(query.queryKey) && query.state.status === 'success' && query.state.data !== undefined;
}

export interface PersistedRecord {
  version: number;
  /** The app build that wrote it. */
  build: string;
  /** The Supabase user id of the person whose data it is. */
  userId: string;
  savedAt: number;
  state: DehydratedState;
}

export interface UsableCheck {
  build: string;
  userId: string | null;
  now: number;
}

/**
 * The stored queries that may be shown now, or null when none may: no
 * session, another person's data, another build's, or older than a day.
 * Queries older than a day inside a newer record are left out too.
 */
export function usableQueries(record: unknown, { build, userId, now }: UsableCheck): DehydratedState['queries'] | null {
  if (!userId || !record || typeof record !== 'object') return null;
  const r = record as Partial<PersistedRecord>;
  if (r.version !== RECORD_VERSION || r.build !== build || r.userId !== userId) return null;
  if (typeof r.savedAt !== 'number' || !(now - r.savedAt < PERSIST_MAX_AGE_MS) || r.savedAt > now + 60_000) return null;
  const queries = (r.state?.queries ?? []).filter(
    (q) => isPersistedQueryKey(q.queryKey) && q.state.status === 'success' && q.state.data !== undefined && now - q.state.dataUpdatedAt < PERSIST_MAX_AGE_MS,
  );
  return queries.length ? queries : null;
}

/** Reads the signed-in user's id from the session auth-js keeps in localStorage (read only). */
export function storedSessionUserId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as { user?: { id?: unknown }; refresh_token?: unknown } | null;
    const id = session?.user?.id;
    return typeof id === 'string' && id && session?.refresh_token ? id : null;
  } catch {
    return null;
  }
}

/** Where the record lives. Every method may reject; the persister swallows it. */
export interface PersistStore {
  get(): Promise<unknown>;
  set(value: PersistedRecord): Promise<void>;
  del(): Promise<void>;
}

export interface QueryPersister {
  /**
   * Shows the stored queries if they are this person's, from this build and
   * less than a day old, then marks them stale so they refetch as soon as
   * they're on screen. Anything unusable is deleted. Resolves true when
   * something was shown. Never rejects.
   */
  restore(): Promise<boolean>;
  /** Starts writing the three queries back after each change. Returns the unsubscribe. */
  start(): () => void;
  /**
   * Who is signed in now. The first call (at start-up, before anything is
   * fetched) trusts the cache; after that only data fetched since the change
   * is written. A different person wipes what's stored.
   */
  setOwner(userId: string | null): void;
  /** Log out or a lapsed session: wipe what's stored and write nothing until someone signs in. */
  clear(): Promise<void>;
  /** Writes now (tests, and the throttle). */
  flush(): Promise<void>;
}

export interface PersisterOptions {
  queryClient: QueryClient;
  store: PersistStore;
  build: string;
  now?: () => number;
  throttleMs?: number;
}

export function createQueryPersister({ queryClient, store, build, now = Date.now, throttleMs = PERSIST_THROTTLE_MS }: PersisterOptions): QueryPersister {
  let owner: string | null = null;
  let ownerKnown = false;
  // Only data at least this new is written: what the current person fetched.
  let ownerSince = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const quiet = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = async () => {
    cancel();
    const userId = owner;
    if (!userId) return;
    const since = ownerSince;
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (q) => shouldPersistQuery(q) && q.state.dataUpdatedAt >= since,
      shouldDehydrateMutation: () => false,
    });
    if (!state.queries.length) return;
    // Only what hydrate needs: no errors or fetch details from a failed refetch.
    const queries = state.queries.map(({ queryKey, queryHash, state: s }) => ({
      queryKey,
      queryHash,
      state: { ...s, error: null, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, fetchStatus: 'idle' as const, isInvalidated: false },
    }));
    await quiet(() => store.set({ version: RECORD_VERSION, build, userId, savedAt: now(), state: { mutations: [], queries } }));
  };

  const schedule = () => {
    if (timer !== null || !owner) return;
    timer = setTimeout(() => void flush(), throttleMs);
  };

  const restore = async () => {
    const record = await quiet(() => store.get());
    if (record === undefined || record === null) return false;
    // Whoever is signed in now, not when storage was asked.
    const queries = usableQueries(record, { build, userId: owner, now: now() });
    if (!queries) {
      await quiet(() => store.del());
      return false;
    }
    try {
      hydrate(queryClient, { mutations: [], queries });
      for (const q of queries) {
        const query = queryClient.getQueryCache().get(q.queryHash);
        // Only the ones that took the stored data (newer data already in the
        // cache wins). Stale now, so each refetches the moment it's on screen;
        // one already fetching carries on rather than starting again.
        if (query && query.state.dataUpdatedAt === q.state.dataUpdatedAt) {
          void queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true }, { cancelRefetch: false }).catch(() => {});
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const start = () =>
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && isPersistedQueryKey(event.query.queryKey)) schedule();
    });

  const setOwner = (userId: string | null) => {
    if (ownerKnown && userId === owner) return;
    const first = !ownerKnown;
    const previous = owner;
    ownerKnown = true;
    owner = userId;
    ownerSince = first ? 0 : now();
    cancel();
    if (first || !userId) return;
    if (previous && previous !== userId) {
      void quiet(() => store.del());
      return;
    }
    // Signed in after being signed out: drop someone else's leftovers.
    void quiet(async () => {
      const record = (await store.get()) as Partial<PersistedRecord> | null | undefined;
      if (record && record.userId !== userId) await store.del();
    });
  };

  const clear = async () => {
    cancel();
    owner = null;
    ownerKnown = true;
    ownerSince = now();
    await quiet(() => store.del());
  };

  return { restore, start, setOwner, clear, flush };
}
