import React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';

/**
 * Drop-down menus on Radix: arrow keys move between items, typing jumps to
 * one, Escape or a tap outside closes the menu, and focus goes back to the
 * button that opened it (also after a sheet opened from an item closes; see
 * useReturnFocus). The menu is portalled above everything (z-overlay) and
 * flips to stay on screen, so a menu inside a scrolling list isn't cut off.
 */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  children,
  align = 'end',
  className = 'w-56',
  ...rest
}: { children: React.ReactNode; align?: 'start' | 'end'; className?: string } & Omit<Menu.DropdownMenuContentProps, 'align' | 'className'>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={`z-overlay rounded-md border border-border bg-card py-1 shadow-lg ${className}`}
        {...rest}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

const ITEM =
  'flex w-full min-h-10 cursor-pointer select-none items-center gap-2 px-3 text-left text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40';

export function DropdownMenuItem({ className = 'text-foreground', ...props }: Menu.DropdownMenuItemProps) {
  return <Menu.Item className={`${ITEM} ${className}`} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}
