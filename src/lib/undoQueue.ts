/**
 * Actions that wait out an Undo toast before they are sent.
 *
 * Tapping "Pull out" queues the request instead of sending it; it is sent
 * when the delay runs out, or dropped if Undo is tapped first. Nothing that
 * was queued is ever lost:
 *  - a second action sends any waiting one at once (one Undo at a time),
 *  - `flush()` sends everything waiting (the page unmounting, the tab being
 *    hidden or closed).
 * Each queued action is sent at most once.
 *
 * Pure apart from the timers, which are passed in so tests can drive them.
 */

export interface UndoTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: UndoTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface UndoQueue {
  /** Queues `send` under `key`, sending any other waiting action first. */
  add: (key: string, send: () => void) => void;
  /** Drops the waiting action. False when it had already been sent (or never queued). */
  undo: (key: string) => boolean;
  /** Sends every waiting action now. */
  flush: () => void;
  /** Keys waiting to be sent, oldest first. */
  pending: () => string[];
}

export function createUndoQueue(
  delayMs: number,
  options: { timers?: UndoTimers; onChange?: (pending: string[]) => void } = {},
): UndoQueue {
  const timers = options.timers ?? realTimers;
  const waiting = new Map<string, { send: () => void; handle: unknown }>();
  const changed = () => options.onChange?.([...waiting.keys()]);

  // Removes the entry before sending, so a send that throws or re-enters
  // the queue cannot send it twice.
  const sendNow = (key: string) => {
    const entry = waiting.get(key);
    if (!entry) return;
    waiting.delete(key);
    timers.clear(entry.handle);
    entry.send();
  };

  // Sends every one even if one throws, then rethrows the first error.
  const flushAll = () => {
    const keys = [...waiting.keys()];
    if (keys.length === 0) return;
    let failed: { error: unknown } | null = null;
    for (const key of keys) {
      try {
        sendNow(key);
      } catch (error) {
        failed ??= { error };
      }
    }
    changed();
    if (failed) throw failed.error;
  };

  return {
    add(key, send) {
      try {
        flushAll();
      } finally {
        const handle = timers.set(() => {
          try {
            sendNow(key);
          } finally {
            changed();
          }
        }, delayMs);
        waiting.set(key, { send, handle });
        changed();
      }
    },
    undo(key) {
      const entry = waiting.get(key);
      if (!entry) return false;
      waiting.delete(key);
      timers.clear(entry.handle);
      changed();
      return true;
    },
    flush: flushAll,
    pending: () => [...waiting.keys()],
  };
}
