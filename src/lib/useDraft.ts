import { useCallback, useRef, useState } from 'react';
import { draftStore, readDraft, removeDraft, writeDraft } from '@/lib/drafts';

/**
 * Form state kept in this browser until the form is saved (src/lib/drafts.ts).
 *
 *   const [form, setForm, clearDraft] = useDraft(`draft:joiner:${id}`, startingValues);
 *   ...on a successful save: clearDraft();
 *
 * - `key` null keeps nothing (e.g. before the signed-in user is known).
 * - `omit`: fields never written to the device (ID and bank numbers); they
 *   start from `initial` again after a reload.
 * - The setter takes a value or an updater, like useState's.
 */
export function useDraft<T extends object>(
  key: string | null,
  initial: T,
  { omit = [] }: { omit?: readonly string[] } = {},
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => (key ? readDraft(draftStore(), key, initial) : initial));
  // The latest value, so an updater can be written straight to storage.
  const latest = useRef(value);
  latest.current = value;
  const omitKey = omit.join('|');

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(latest.current) : next;
      latest.current = resolved;
      setValue(resolved);
      if (key) writeDraft(draftStore(), key, resolved, { omit: omitKey ? omitKey.split('|') : [] });
    },
    [key, omitKey],
  );
  const clear = useCallback(() => {
    if (key) removeDraft(draftStore(), key);
  }, [key]);
  return [value, set, clear];
}
