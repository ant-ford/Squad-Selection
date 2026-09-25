import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const storageKey = (id: string) => `insights-open:${id}`;

function readOpen(id: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(id)) !== '0';
  } catch {
    return true;
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    if (open) window.localStorage.removeItem(storageKey(id));
    else window.localStorage.setItem(storageKey(id), '0');
  } catch {
    // Private mode or blocked storage: the group still toggles, it just
    // opens again on the next visit.
  }
}

/**
 * One of the Insights tab's top-level groups (New Joiners, Commitment
 * reviews): a black heading bar that collapses the group (owner request,
 * 2026-09-26). "Black" is the theme's secondary, the near-black the app
 * already uses for selected controls; this theme defines no plain black. A collapsed group is not rendered, so its data is not
 * fetched either. Each device remembers what its viewer closed.
 */
export default function InsightsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(id));
  const panelId = useId();
  const toggle = () => {
    setOpen(!open);
    writeOpen(id, !open);
  };

  return (
    <section aria-label={title} className="space-y-3">
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center justify-between gap-3 rounded-lg bg-secondary px-4 py-2.5 text-left text-sm font-semibold text-secondary-foreground hover:bg-secondary/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {title}
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
            aria-hidden
          />
        </button>
      </h2>
      {open && (
        <div id={panelId} className="space-y-6">
          {children}
        </div>
      )}
    </section>
  );
}
