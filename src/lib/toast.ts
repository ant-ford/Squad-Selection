import type { ExternalToast, toast as sonnerToast } from 'sonner';

/**
 * The app's toasts, without putting sonner (~33 kB) on the first load.
 *
 * Same calls as sonner's `toast`: toast(), .success(), .error(), .info(),
 * .warning(), .message() and .dismiss(). Each returns an id at once, so a toast
 * can be dismissed before sonner has arrived. Calls made before then wait in a
 * queue, and run in order once <Toaster /> (components/ui/sonner.tsx) has
 * loaded sonner and mounted, which it does when the browser is idle after
 * start-up or at the first toast, whichever comes first.
 */

type Sonner = typeof sonnerToast;
type Message = Parameters<Sonner>[0];
type Kind = 'default' | 'success' | 'error' | 'info' | 'warning' | 'message';
type Id = string | number;
type Call = { kind: Kind; message: Message; options: ExternalToast & { id: Id } } | { kind: 'dismiss'; id?: Id };

let ready: Sonner | null = null;
let queue: Call[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function run(sonner: Sonner, call: Call): void {
  if (call.kind === 'dismiss') sonner.dismiss(call.id);
  else if (call.kind === 'default') sonner(call.message, call.options);
  else sonner[call.kind](call.message, call.options);
}

function send(call: Call): void {
  if (ready) return run(ready, call);
  queue.push(call);
  listeners.forEach((wake) => wake());
}

function show(kind: Exclude<Kind, 'dismiss'>) {
  return (message: Message, options?: ExternalToast): Id => {
    const id = options?.id ?? `eddy-toast-${++nextId}`;
    send({ kind, message, options: { ...options, id } });
    return id;
  };
}

export const toast = Object.assign(show('default'), {
  success: show('success'),
  error: show('error'),
  info: show('info'),
  warning: show('warning'),
  message: show('message'),
  dismiss: (id?: Id): void => send({ kind: 'dismiss', id }),
});

/** Called by <Toaster /> once sonner's Toaster has mounted: runs what was queued. */
export function toasterReady(sonner: Sonner): void {
  ready = sonner;
  const waiting = withoutDismissed(queue);
  queue = [];
  waiting.forEach((call) => run(sonner, call));
}

/**
 * Drops queued toasts that were dismissed before sonner arrived, and the
 * dismissals themselves. Replayed in one go, sonner would apply a dismiss
 * before the toast it names had been added, and the toast would stay.
 */
function withoutDismissed(calls: Call[]): Call[] {
  const kept: Call[] = [];
  for (const call of calls) {
    if (call.kind !== 'dismiss') kept.push(call);
    else if (call.id === undefined) kept.length = 0;
    else {
      const i = kept.findIndex((c) => c.kind !== 'dismiss' && c.options.id === call.id);
      if (i >= 0) kept.splice(i, 1);
    }
  }
  return kept;
}

/** Lets <Toaster /> load sonner as soon as a toast is asked for. Returns an unsubscribe. */
export function onToastQueued(wake: () => void): () => void {
  listeners.add(wake);
  if (queue.length) wake();
  return () => listeners.delete(wake);
}

/** Tests only: back to the state before sonner loaded. */
export function resetToastsForTest(): void {
  ready = null;
  queue = [];
  nextId = 0;
  listeners.clear();
}
