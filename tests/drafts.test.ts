import { describe, expect, it } from 'vitest';
import { DRAFT_MAX_AGE_MS, clearAllDrafts, differs, mergeDraft, readDraft, removeDraft, writeDraft } from '../src/lib/drafts';

/** A Storage-shaped map, like localStorage. */
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Storage that refuses everything (private mode, blocked site data). */
const brokenStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('denied');
  },
  key: () => {
    throw new Error('denied');
  },
  length: 1,
};

const start = { name: '', team: 'HKFC C', notes: '', tags: [] as string[] };

describe('mergeDraft', () => {
  it('lets what was typed win', () => {
    expect(mergeDraft(start, { name: 'Sam', team: 'HKFC D' })).toEqual({ ...start, name: 'Sam', team: 'HKFC D' });
  });

  it('keeps a starting value where the draft box was left empty', () => {
    expect(mergeDraft(start, { team: '', notes: '' })).toEqual(start);
  });

  it('ignores fields the form no longer has', () => {
    expect(mergeDraft(start, { name: 'Sam', removed: 'x' })).toEqual({ ...start, name: 'Sam' });
  });

  it('ignores anything that is not an object', () => {
    expect(mergeDraft(start, null)).toBe(start);
    expect(mergeDraft(start, ['a'])).toBe(start);
    expect(mergeDraft(start, 'text')).toBe(start);
  });
});

describe('readDraft and writeDraft', () => {
  it('round-trips a draft', () => {
    const store = memoryStore();
    writeDraft(store, 'draft:x', { ...start, name: 'Sam' }, { now: 1000 });
    expect(readDraft(store, 'draft:x', start, { now: 2000 })).toEqual({ ...start, name: 'Sam' });
  });

  it('never writes the omitted fields', () => {
    const store = memoryStore();
    writeDraft(store, 'draft:x', { hkidNo: 'A123456(7)', name: 'Sam' }, { omit: ['hkidNo'] });
    expect(store.data.get('draft:x')).not.toContain('A123456');
    expect(readDraft(store, 'draft:x', { hkidNo: 'saved', name: '' })).toEqual({ hkidNo: 'saved', name: 'Sam' });
  });

  it('drops a draft past its age and removes it', () => {
    const store = memoryStore();
    writeDraft(store, 'draft:x', { ...start, name: 'Sam' }, { now: 0 });
    expect(readDraft(store, 'draft:x', start, { now: DRAFT_MAX_AGE_MS + 1 })).toBe(start);
    expect(store.data.has('draft:x')).toBe(false);
  });

  it('reads a Player Statement draft saved before drafts were dated', () => {
    const store = memoryStore({ 'review-draft:r1:member': JSON.stringify({ name: 'Sam' }) });
    expect(readDraft(store, 'review-draft:r1:member', start)).toEqual({ ...start, name: 'Sam' });
  });

  it('falls back to the starting values for unreadable JSON', () => {
    const store = memoryStore({ 'draft:x': '{not json' });
    expect(readDraft(store, 'draft:x', start)).toBe(start);
  });

  it('works without storage, and when storage throws', () => {
    expect(readDraft(null, 'draft:x', start)).toBe(start);
    expect(readDraft(brokenStore, 'draft:x', start)).toBe(start);
    expect(() => writeDraft(brokenStore, 'draft:x', start)).not.toThrow();
    expect(() => removeDraft(brokenStore, 'draft:x')).not.toThrow();
    expect(() => clearAllDrafts(brokenStore)).not.toThrow();
  });
});

describe('clearAllDrafts', () => {
  it('removes every draft and the old review drafts, nothing else', () => {
    const store = memoryStore({
      'draft:details:u1:personal': '{}',
      'draft:joiner:u1:new': '{}',
      'review-draft:r1:member': '{}',
      'join:pending': '1',
      'sb-auth-token': 'x',
    });
    clearAllDrafts(store);
    expect([...store.data.keys()].sort()).toEqual(['join:pending', 'sb-auth-token']);
  });
});

describe('differs', () => {
  it('compares field by field, by value', () => {
    expect(differs({ a: 1, b: ['x'] }, { a: 1, b: ['x'] })).toBe(false);
    expect(differs({ a: 1, b: ['x'] }, { a: 1, b: ['y'] })).toBe(true);
    expect(differs({ a: { n: 1 } }, { a: { n: 2 } })).toBe(true);
  });

  it('treats a missing value and null alike', () => {
    expect(differs({ a: null as string | null }, { a: undefined as unknown as string | null })).toBe(false);
  });

  it('notices a field added or taken away', () => {
    expect(differs({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toBe(true);
  });
});
