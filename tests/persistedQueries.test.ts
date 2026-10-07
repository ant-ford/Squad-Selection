import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  PERSIST_MAX_AGE_MS,
  createQueryPersister,
  isPersistedQueryKey,
  storedSessionUserId,
  usableQueries,
  type PersistedRecord,
  type PersistStore,
} from '../src/lib/persistedQueries';

// The installed app opens on the person's own fixtures from last time and
// refreshes behind. These pin what is kept, for whom, for how long, and that
// signing out (or someone else signing in) wipes it.

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);

function memoryStore(): PersistStore & { value: PersistedRecord | undefined; dels: number } {
  const s = {
    value: undefined as PersistedRecord | undefined,
    dels: 0,
    get: async () => s.value,
    set: async (v: PersistedRecord) => {
      s.value = structuredClone(v);
    },
    del: async () => {
      s.dels += 1;
      s.value = undefined;
    },
  };
  return s;
}

/** Storage that refuses everything (private mode, quota, no IndexedDB). */
const brokenStore: PersistStore = {
  get: async () => {
    throw new Error('denied');
  },
  set: async () => {
    throw new Error('QuotaExceededError');
  },
  del: async () => {
    throw new Error('denied');
  },
};

function setup(opts: { build?: string; store?: PersistStore; now?: () => number } = {}) {
  let clock = T0;
  const now = opts.now ?? (() => clock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: false } } });
  // Tests that read `value` pass a memory store (or none).
  const store = (opts.store ?? memoryStore()) as ReturnType<typeof memoryStore>;
  const persister = createQueryPersister({ queryClient, store, build: opts.build ?? 'b1', now });
  return { queryClient, store, persister, tick: (ms: number) => (clock += ms) };
}

const fixtures = { fixtures: [{ id: 'm1', availabilityStatus: 'Available' }] };

/** Fills a cache with the three kept queries and two that aren't, then writes it for `userId`. */
async function persistFor(userId: string, opts: { build?: string } = {}) {
  const s = setup(opts);
  s.persister.setOwner(userId);
  const at = { updatedAt: T0 };
  s.queryClient.setQueryData(['myProfile'], { id: 'p1', preferredName: 'Sam' }, at);
  s.queryClient.setQueryData(['myFixtures', true], fixtures, at);
  s.queryClient.setQueryData(['myFixtures', false], { fixtures: [] }, at);
  s.queryClient.setQueryData(['myTasks'], { tasks: [] }, at);
  s.queryClient.setQueryData(['ranking'], { list: ['someone else'] }, at);
  s.queryClient.setQueryData(['playersForMatch', 'm1'], { players: [] }, at);
  await s.persister.flush();
  return s;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('which queries are kept', () => {
  it('keeps my profile, both my-fixtures variants and my tasks, nothing else', () => {
    expect(isPersistedQueryKey(['myProfile'])).toBe(true);
    expect(isPersistedQueryKey(['myFixtures', true])).toBe(true);
    expect(isPersistedQueryKey(['myFixtures', false])).toBe(true);
    expect(isPersistedQueryKey(['myTasks'])).toBe(true);
    for (const key of [['ranking'], ['playersForMatch', 'm1'], ['teamAvailability', 'm1'], ['upcomingFixtures'], ['myEvents'], ['membershipBoard']]) {
      expect(isPersistedQueryKey(key)).toBe(false);
    }
  });

  it('writes only those queries, with their data', async () => {
    const { store } = await persistFor('user-a');
    const keys = store.value!.state.queries.map((q) => JSON.stringify(q.queryKey)).sort();
    expect(keys).toEqual(['["myFixtures",false]', '["myFixtures",true]', '["myProfile"]', '["myTasks"]']);
    expect(store.value!.userId).toBe('user-a');
    expect(store.value!.build).toBe('b1');
    expect(store.value!.state.mutations).toEqual([]);
  });

  it('never writes a failed or still-loading query', async () => {
    const s = setup();
    s.persister.setOwner('user-a');
    await s.queryClient.prefetchQuery({ queryKey: ['myTasks'], queryFn: () => Promise.reject(new Error('500')) });
    void s.queryClient.prefetchQuery({ queryKey: ['myProfile'], queryFn: () => new Promise(() => {}) });
    await s.persister.flush();
    expect(await s.store.get()).toBeUndefined();
  });

  it('writes nothing while nobody is signed in', async () => {
    const s = setup();
    s.persister.setOwner(null);
    s.queryClient.setQueryData(['myFixtures', true], fixtures);
    await s.persister.flush();
    expect(await s.store.get()).toBeUndefined();
  });

  it('writes about a second after a change, once for several changes', async () => {
    vi.useFakeTimers();
    const s = setup({ now: () => Date.now() });
    const set = vi.spyOn(s.store, 'set');
    s.persister.setOwner('user-a');
    const stop = s.persister.start();
    s.queryClient.setQueryData(['myFixtures', true], fixtures);
    s.queryClient.setQueryData(['myTasks'], { tasks: [] });
    s.queryClient.setQueryData(['ranking'], { list: [] });
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(1);
    s.queryClient.setQueryData(['ranking'], { list: ['x'] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(set).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('when kept data is used', () => {
  const record = (over: Partial<PersistedRecord> = {}): PersistedRecord => ({
    version: 1,
    build: 'b1',
    userId: 'user-a',
    savedAt: T0,
    state: {
      mutations: [],
      queries: [
        {
          queryKey: ['myFixtures', true],
          queryHash: '["myFixtures",true]',
          state: { data: fixtures, dataUpdatedAt: T0, status: 'success' } as never,
        },
      ],
    },
    ...over,
  });
  const check = { build: 'b1', userId: 'user-a', now: T0 + HOUR };

  it('same person, same build, under a day old: used', () => {
    expect(usableQueries(record(), check)).toHaveLength(1);
    expect(usableQueries(record(), { ...check, now: T0 + PERSIST_MAX_AGE_MS - 1 })).toHaveLength(1);
  });

  it('another person, another build, a day old or no session: not used', () => {
    expect(usableQueries(record(), { ...check, userId: 'user-b' })).toBeNull();
    expect(usableQueries(record(), { ...check, userId: null })).toBeNull();
    expect(usableQueries(record(), { ...check, build: 'b2' })).toBeNull();
    expect(usableQueries(record(), { ...check, now: T0 + PERSIST_MAX_AGE_MS })).toBeNull();
    expect(usableQueries(record({ version: 0 }), check)).toBeNull();
    expect(usableQueries('junk', check)).toBeNull();
    expect(usableQueries(null, check)).toBeNull();
  });

  it('leaves out a query older than a day inside a newer record', () => {
    const r = record({ savedAt: T0 + 30 * HOUR });
    expect(usableQueries(r, { ...check, now: T0 + 31 * HOUR })).toBeNull();
  });
});

describe('restore', () => {
  it("shows the person's own data at once, and marks it stale so it refetches on screen", async () => {
    const { store } = await persistFor('user-a');
    const next = setup({ store, now: () => T0 + 60_000 });
    next.persister.setOwner('user-a');
    expect(await next.persister.restore()).toBe(true);
    expect(next.queryClient.getQueryData(['myFixtures', true])).toEqual(fixtures);
    expect(next.queryClient.getQueryData(['myProfile'])).toEqual({ id: 'p1', preferredName: 'Sam' });
    expect(next.queryClient.getQueryData(['ranking'])).toBeUndefined();
    // A minute old would be fresh for four more; it is refetched anyway.
    expect(next.queryClient.getQueryState(['myFixtures', true])?.isInvalidated).toBe(true);
    expect(next.queryClient.getQueryCache().find({ queryKey: ['myProfile'] })?.isStaleByTime(Infinity)).toBe(true);
  });

  it("never shows one person's data to another, and deletes it", async () => {
    const { store } = await persistFor('user-a');
    const next = setup({ store });
    next.persister.setOwner('user-b');
    expect(await next.persister.restore()).toBe(false);
    expect(next.queryClient.getQueryData(['myFixtures', true])).toBeUndefined();
    expect(await store.get()).toBeUndefined();
  });

  it('shows nothing without a session, and deletes what was kept', async () => {
    const { store } = await persistFor('user-a');
    const next = setup({ store });
    next.persister.setOwner(null);
    expect(await next.persister.restore()).toBe(false);
    expect(next.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(await store.get()).toBeUndefined();
  });

  it('drops data kept by another build, or more than a day ago', async () => {
    const a = await persistFor('user-a', { build: 'old' });
    const next = setup({ store: a.store, build: 'new' });
    next.persister.setOwner('user-a');
    expect(await next.persister.restore()).toBe(false);
    expect(await a.store.get()).toBeUndefined();

    const b = await persistFor('user-a');
    const later = setup({ store: b.store, now: () => T0 + PERSIST_MAX_AGE_MS + 1 });
    later.persister.setOwner('user-a');
    expect(await later.persister.restore()).toBe(false);
    expect(await b.store.get()).toBeUndefined();
  });

  it('does not replace newer data the network already brought', async () => {
    const { store } = await persistFor('user-a');
    const next = setup({ store, now: () => T0 + 60_000 });
    next.persister.setOwner('user-a');
    const fresh = { fixtures: [] };
    next.queryClient.setQueryData(['myFixtures', true], fresh, { updatedAt: T0 + 30_000 });
    await next.persister.restore();
    expect(next.queryClient.getQueryData(['myFixtures', true])).toBe(fresh);
    expect(next.queryClient.getQueryState(['myFixtures', true])?.isInvalidated).toBe(false);
  });

  it('is silent when storage refuses', async () => {
    const s = setup({ store: brokenStore });
    s.persister.setOwner('user-a');
    s.queryClient.setQueryData(['myFixtures', true], fixtures);
    await expect(s.persister.flush()).resolves.toBeUndefined();
    await expect(s.persister.restore()).resolves.toBe(false);
    await expect(s.persister.clear()).resolves.toBeUndefined();
  });
});

describe('wiping', () => {
  it('Log out deletes what was kept and writes nothing more', async () => {
    const { store, persister, queryClient } = await persistFor('user-a');
    expect(store.value).toBeDefined();
    await persister.clear();
    expect(await store.get()).toBeUndefined();
    queryClient.setQueryData(['myFixtures', true], fixtures);
    await persister.flush();
    expect(await store.get()).toBeUndefined();
  });

  it("a different person signing in deletes the last one's", async () => {
    const { store, persister } = await persistFor('user-a');
    persister.setOwner('user-b');
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get()).toBeUndefined();
  });

  it("someone signing in after a lapsed session drops another person's leftovers, keeps their own", async () => {
    const a = await persistFor('user-a');
    a.persister.setOwner(null);
    a.persister.setOwner('user-a');
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.store.get()).toBeDefined();

    a.persister.setOwner(null);
    a.persister.setOwner('user-b');
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.store.get()).toBeUndefined();
  });

  it("after a change of person, only what the new person fetched is written", async () => {
    const s = await persistFor('user-a');
    s.tick(1000);
    s.persister.setOwner('user-b');
    await s.persister.flush();
    expect(await s.store.get()).toBeUndefined();
    s.queryClient.setQueryData(['myTasks'], { tasks: ['b'] }, { updatedAt: T0 + 2000 });
    await s.persister.flush();
    const kept = s.store.value!;
    expect(kept.userId).toBe('user-b');
    expect(kept.state.queries.map((q) => q.queryKey)).toEqual([['myTasks']]);
  });
});

describe('the signed-in person, from the saved session', () => {
  it('reads the user id auth-js saved', () => {
    expect(storedSessionUserId(JSON.stringify({ access_token: 'x', refresh_token: 'r', user: { id: 'user-a' } }))).toBe('user-a');
  });

  it('is nobody without a usable saved session', () => {
    expect(storedSessionUserId(null)).toBeNull();
    expect(storedSessionUserId('not json')).toBeNull();
    expect(storedSessionUserId('null')).toBeNull();
    expect(storedSessionUserId(JSON.stringify({ user: { id: 'user-a' } }))).toBeNull();
    expect(storedSessionUserId(JSON.stringify({ refresh_token: 'r', user: {} }))).toBeNull();
  });
});

describe('signOut (Log out, a refused refresh, Delete my profile)', () => {
  it('wipes the kept copy, even when Supabase fails', async () => {
    vi.resetModules();
    const persisterClear = vi.fn(async () => {});
    const supabaseSignOut = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.doMock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: supabaseSignOut } } }));
    vi.doMock('../src/lib/queryClient', () => ({ queryClient: { clear: vi.fn() }, queryPersister: { clear: persisterClear } }));
    const { signOut } = await import('../src/lib/auth');
    await expect(signOut()).rejects.toThrow('offline');
    expect(persisterClear).toHaveBeenCalledTimes(1);
    vi.doUnmock('../src/lib/supabase');
    vi.doUnmock('../src/lib/queryClient');
  });
});
