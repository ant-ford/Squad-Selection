import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recover = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/staleDeploy', async (original) => ({
  ...(await original<typeof import('../src/lib/staleDeploy')>()),
  recoverFromStaleDeploy: recover,
}));
import { installChunkRecovery, recoverScreenLoad } from '../src/lib/chunkRecovery';

beforeEach(() => { recover.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('screen-load recovery', () => {
  it('does not turn Vite’s rejected import into a fulfilled undefined module', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    recover.mockResolvedValue(true);
    const report = vi.fn();
    installChunkRecovery(report);
    const failure = new TypeError('Failed to fetch dynamically imported module');
    // Vite's production preload helper dispatches this event, then throws
    // only when the listener has not prevented its default behaviour.
    const load = Promise.reject(failure).catch((error) => {
      const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error });
      target.dispatchEvent(event);
      if (!event.defaultPrevented) throw error;
    });
    await expect(load).rejects.toBe(failure);
    expect(recover).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it('reports the original failure when recovery is exhausted or unavailable', async () => {
    recover.mockResolvedValue(false);
    const report = vi.fn();
    const failure = new Error('Unable to preload CSS for /assets/page.css');
    await recoverScreenLoad(failure, report);
    expect(report).toHaveBeenCalledWith(failure);
  });

  it('still reports the import failure when the browser refuses to reload', async () => {
    recover.mockRejectedValue(new Error('reload refused'));
    const report = vi.fn();
    const failure = new TypeError('Importing a module script failed.');
    await recoverScreenLoad(failure, report);
    expect(report).toHaveBeenCalledWith(failure);
  });

  it('does not reload unrelated rejected promises', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    installChunkRecovery(vi.fn());
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('unrelated') }));
    expect(recover).not.toHaveBeenCalled();
  });
});
