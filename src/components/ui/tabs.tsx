import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Underlined tab strip, the look ClubStats, MembershipBoard, Kit,
 * Registration, Umpiring, Volunteers and FixtureList each build by hand.
 *
 *   <Tabs id="stats" label="Stats views" items={TABS} value={tab} onChange={setTab} />
 *   <TabPanel tabsId="stats" value={tab}>...</TabPanel>
 *
 * - Controlled: `value` + `onChange`. Selection follows focus (arrow keys
 *   select as they move), which suits panels that show at once.
 * - Keys: Left/Right move and wrap, Home/End jump to the ends; disabled tabs
 *   are skipped. Roving tabindex: only the selected tab is in the Tab order,
 *   so Tab goes from the strip straight into the panel.
 * - Scrolls sideways on a narrow phone; the edge with more tabs past it
 *   fades out, and the selected tab is kept in view.
 * - Each tab is at least 40 px tall.
 * - aria-controls is set on the selected tab only, since only the selected
 *   panel is rendered; pointing at a panel that is not in the page is invalid.
 */

export interface TabItem<K extends string = string> {
  value: K;
  label: ReactNode;
  disabled?: boolean;
}

const safe = (s: string) => s.replace(/[^\w-]/g, '-');
export const tabId = (tabsId: string, value: string) => `${tabsId}-tab-${safe(value)}`;
export const tabPanelId = (tabsId: string, value: string) => `${tabsId}-panel-${safe(value)}`;

/** Width of the edge fade, px. */
const FADE = 24;

export function Tabs<K extends string>({
  id,
  label,
  items,
  value,
  onChange,
  className = '',
}: {
  /** Base for the tab and panel ids; TabPanel takes the same value as `tabsId`. */
  id: string;
  /** Names the strip for screen readers, e.g. "Stats views". */
  label: string;
  items: readonly TabItem<K>[];
  value: K;
  onChange: (value: K) => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [fade, setFade] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, items.length]);

  const selectedIndex = items.findIndex((t) => t.value === value);
  // If `value` matches nothing, the first enabled tab still takes the Tab stop.
  const tabStop = selectedIndex >= 0 ? selectedIndex : items.findIndex((t) => !t.disabled);

  // Keep the selected tab in view without scrolling the page (scrollIntoView would).
  useLayoutEffect(() => {
    const el = scroller.current;
    const tab = tabs.current[selectedIndex];
    if (!el || !tab) return;
    const start = tab.offsetLeft - FADE;
    const end = tab.offsetLeft + tab.offsetWidth + FADE;
    if (start < el.scrollLeft) el.scrollLeft = Math.max(0, start);
    else if (end > el.scrollLeft + el.clientWidth) el.scrollLeft = end - el.clientWidth;
    measure();
  }, [selectedIndex, measure]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = items.flatMap((t, i) => (t.disabled ? [] : [i]));
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(index);
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = enabled[(pos + 1) % enabled.length];
        break;
      case 'ArrowLeft':
        next = enabled[(pos - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    e.preventDefault();
    tabs.current[next]?.focus({ preventScroll: true });
    if (items[next].value !== value) onChange(items[next].value);
  };

  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? 'transparent' : '#000'}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${
          fade.right ? 'transparent' : '#000'
        })`
      : undefined;

  return (
    <div
      ref={scroller}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={`relative flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_-1px_0_hsl(var(--border))] ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {items.map((t, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={t.value}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, t.value)}
            aria-selected={selected}
            aria-controls={selected ? tabPanelId(id, t.value) : undefined}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={t.disabled}
            onClick={() => !selected && onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`shrink-0 whitespace-nowrap min-h-10 px-3 text-sm border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none ${
              selected
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for the selected tab. Render only the selected one. */
export function TabPanel({
  tabsId,
  value,
  className = '',
  children,
}: {
  tabsId: string;
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      tabIndex={0}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm ${className}`}
    >
      {children}
    </div>
  );
}
