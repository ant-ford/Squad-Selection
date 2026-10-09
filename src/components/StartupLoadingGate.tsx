import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import AppLoading from '@/components/AppLoading';

const Startup = createContext<{ ready: boolean; reveal: () => void } | null>(null);

/** One startup handoff per app opening; later navigation and background refreshes stay responsive. */
export function StartupLoadingProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const value = useMemo(() => ({ ready, reveal: () => setReady(true) }), [ready]);
  return <Startup.Provider value={value}>{children}</Startup.Provider>;
}

/** Mount the first screen's reads under the ball, then reveal its data (or retry controls). */
export default function StartupLoadingGate({ children }: { children: ReactNode }) {
  const startup = useContext(Startup);
  const pending = useIsFetching({
    // A cached screen is already usable: its background refresh mustn't hold the loader.
    predicate: (query) => query.state.data === undefined && query.state.status === 'pending',
  });
  useEffect(() => {
    if (!startup || startup.ready || pending > 0) return;
    // Let dependent reads start (e.g. profile -> team), without a frame of empty placeholders.
    const timer = window.setTimeout(startup.reveal, 160);
    return () => window.clearTimeout(timer);
  }, [startup, pending]);

  const loading = !!startup && !startup.ready;
  return (
    <>
      <div className={loading ? 'invisible' : 'contents'} aria-hidden={loading || undefined} inert={loading || undefined}>
        {children}
      </div>
      {loading && <div className="fixed inset-0 z-[100] bg-background overflow-y-auto"><AppLoading /></div>}
    </>
  );
}
