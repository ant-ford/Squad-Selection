import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ClipboardList, HeartHandshake, LayoutGrid, Mail, Shirt, Users, type LucideIcon } from 'lucide-react';
import { headerIconClass, headerNavClass } from '@/components/AppHeader';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Something to do rather than a screen to open (inviting someone to join), shown last. */
export interface MenuAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/** The officers' screens a person may open, in a fixed order, from what the Worker says. */
export function officerItems(p: {
  sections?: string[];
  seasonPlans?: boolean;
  volunteers?: boolean;
}): Item[] {
  const s = p.sections ?? [];
  const all: (Item | false | undefined)[] = [
    s.includes('membership') && { to: '/membership', label: 'Membership', icon: Users },
    s.includes('chairman') && { to: '/chairman', label: 'Email lists', icon: Mail },
    (s.includes('planning') || p.seasonPlans) && { to: '/season-plans', label: 'Season plans', icon: ClipboardList },
    p.volunteers && { to: '/volunteers', label: 'Volunteers', icon: HeartHandshake },
    s.includes('kit') && { to: '/kit', label: 'Kit', icon: Shirt },
  ];
  return all.filter((i): i is Item => !!i);
}

/**
 * One header button for the officers' screens, so an officer who also
 * coaches doesn't get a row of buttons that pushes the title off a phone.
 * A single screen is a plain button; two or more open a menu. An action
 * (inviting someone to join, for every member) goes last in the menu, or
 * is a single icon for someone with no officers' screens.
 */
export default function OfficersMenu({ items, action }: { items: Item[]; action?: MenuAction }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const here = items.some((i) => location.pathname === i.to);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0 && !action) return null;
  if (items.length === 0 && action) {
    const Icon = action.icon;
    return (
      <button onClick={action.onSelect} className={headerIconClass} title={action.label} aria-label={action.label}>
        <Icon className="h-4 w-4" />
      </button>
    );
  }
  if (items.length === 1 && !action) {
    const [only] = items;
    const Icon = only.icon;
    return (
      <button onClick={() => navigate(only.to)} className={headerNavClass(here)}>
        <Icon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{only.label}</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={headerNavClass(here)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Officers' screens"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Officers</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-card shadow-lg z-50 py-1">
          {items.map((i) => {
            const Icon = i.icon;
            return (
              <button
                key={i.to}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate(i.to);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted ${location.pathname === i.to ? 'text-primary font-medium' : 'text-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                {i.label}
              </button>
            );
          })}
          {action && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted text-foreground border-t border-border mt-1"
            >
              <action.icon className="h-4 w-4" />
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
