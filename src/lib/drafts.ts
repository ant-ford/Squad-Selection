/**
 * Form drafts kept in this browser until the form is saved, so a failed
 * save, a reload or a dropped connection never loses what was typed.
 * Used through useDraft (src/lib/useDraft.ts); the pieces here are plain
 * functions so they can be tested without a browser.
 *
 * Storage can be missing or refuse (private mode, storage full, blocked
 * site data): every read and write is wrapped, and the form then works
 * without a draft.
 */

/** Prefix for the drafts useDraft keeps. Log out removes them all. */
export const DRAFT_PREFIX = 'draft:';
/** The Player Statement's drafts, from before useDraft; same handling. */
const LEGACY_PREFIXES = ['review-draft:'];

/** A draft older than this is ignored and removed (what's saved has moved on). */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { key?: Storage['key']; length?: number };

/** localStorage, or null where it can't be used. */
export function draftStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isEmpty = (v: unknown) => v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * The form's starting values with the draft laid over them. What was typed
 * wins, but a box left empty in the draft keeps its starting value (an AI
 * suggestion or a saved answer that arrived after the draft was made).
 * Only the form's own fields are taken, so a draft from an older version of
 * the form can't add stray ones.
 */
export function mergeDraft<T extends object>(initial: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return initial;
  const start = initial as Record<string, unknown>;
  const kept = Object.entries(saved as Record<string, unknown>).filter(
    ([field, v]) => field in start && (!isEmpty(v) || isEmpty(start[field])),
  );
  return { ...initial, ...Object.fromEntries(kept) };
}

interface Envelope {
  savedAt: number;
  value: unknown;
}

const isEnvelope = (x: unknown): x is Envelope =>
  !!x && typeof x === 'object' && typeof (x as Envelope).savedAt === 'number' && 'value' in (x as object);

/** The saved draft for `key` laid over `initial`; `initial` when there is none, or it's too old or unreadable. */
export function readDraft<T extends object>(
  store: Store | null,
  key: string,
  initial: T,
  { now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS }: { now?: number; maxAgeMs?: number } = {},
): T {
  if (!store) return initial;
  try {
    const raw = store.getItem(key);
    if (!raw) return initial;
    const parsed: unknown = JSON.parse(raw);
    // A bare object is a Player Statement draft saved before drafts were dated.
    if (!isEnvelope(parsed)) return mergeDraft(initial, parsed);
    if (now - parsed.savedAt > maxAgeMs) {
      removeDraft(store, key);
      return initial;
    }
    return mergeDraft(initial, parsed.value);
  } catch {
    return initial;
  }
}

/** Keeps `value` under `key`, leaving out `omit` (fields that must not sit on the device). */
export function writeDraft<T extends object>(store: Store | null, key: string, value: T, { now = Date.now(), omit = [] as readonly string[] } = {}): void {
  if (!store) return;
  try {
    const kept = omit.length ? Object.fromEntries(Object.entries(value).filter(([k]) => !omit.includes(k))) : value;
    store.setItem(key, JSON.stringify({ savedAt: now, value: kept } satisfies Envelope));
  } catch {
    /* not kept: the form still works */
  }
}

export function removeDraft(store: Store | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}

/** Removes every draft in this browser (on Log out, so the next person can't see them). */
export function clearAllDrafts(store: Store | null = draftStore()): void {
  if (!store || typeof store.key !== 'function') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < (store.length ?? 0); i++) {
      const k = store.key(i);
      if (k && (k.startsWith(DRAFT_PREFIX) || LEGACY_PREFIXES.some((p) => k.startsWith(p)))) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  } catch {
    /* nothing to clear */
  }
}

/** Whether a form's values differ from where they started (field by field, by value). */
export function differs<T extends object>(a: T, b: T): boolean {
  const ka = Object.keys(a) as (keyof T)[];
  const kb = new Set(Object.keys(b));
  if (ka.length !== kb.size || ka.some((k) => !kb.has(k as string))) return true;
  return ka.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}
