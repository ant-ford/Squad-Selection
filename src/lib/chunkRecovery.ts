import { isChunkLoadError, recoverFromStaleDeploy } from './staleDeploy';

/** Preserve the rejected import while recovery runs; report only if it cannot recover. */
export async function recoverScreenLoad(error: unknown, report: (error: unknown) => void): Promise<void> {
  try {
    if (await recoverFromStaleDeploy()) return;
  } catch {
    // A browser that refuses recovery must still surface the original failure.
  }
  report(error);
}

export function installChunkRecovery(report: (error: unknown) => void): void {
  window.addEventListener('vite:preloadError', (event) => {
    // Do not preventDefault: Vite would turn a rejected import into a promise
    // fulfilled with undefined, which crashes React.lazy reading .default.
    void recoverScreenLoad((event as Event & { payload: unknown }).payload, report);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) void recoverScreenLoad(event.reason, report);
  });
}
