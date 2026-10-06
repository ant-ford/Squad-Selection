import { Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DropMenuProps } from '@/components/HeaderMenus';
import { headerIconClass, type MenuEntry } from '@/components/headerItems';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * An icon button that drops down groups of entries, split by rules (see
 * ui/dropdown-menu for the keyboard and focus behaviour).
 */
export default function DropMenu({ label, icon: Icon, groups, align }: DropMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const pick = (e: MenuEntry) => {
    if (e.to) navigate(e.to);
    else e.onSelect?.();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={headerIconClass} aria-label={label} title={label}>
        <Icon className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align === 'left' ? 'start' : 'end'} className="w-60">
        {groups
          .filter((g) => g.length > 0)
          .map((g, n) => (
            <Fragment key={n}>
              {n > 0 && <DropdownMenuSeparator />}
              {g.map((e) =>
                e.href ? (
                  <DropdownMenuItem key={e.label} asChild>
                    <a href={e.href} target="_blank" rel="noopener noreferrer">
                      <e.icon className="h-4 w-4" />
                      {e.label}
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={e.label}
                    disabled={e.disabled}
                    onSelect={() => pick(e)}
                    aria-current={e.to && location.pathname === e.to ? 'page' : undefined}
                    className={e.to && location.pathname === e.to ? 'text-primary font-medium' : 'text-foreground'}
                  >
                    <e.icon className="h-4 w-4" />
                    {e.label}
                  </DropdownMenuItem>
                ),
              )}
            </Fragment>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
