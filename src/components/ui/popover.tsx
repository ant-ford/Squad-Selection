import React from 'react';
import * as Pop from '@radix-ui/react-popover';

/**
 * A small panel that opens from a button: portalled above everything
 * (z-overlay) and flipped to stay on screen. Modal, so the tap that closes
 * it doesn't also land on what's underneath, such as the card it opened from.
 * Escape closes it, and focus goes back to the button.
 */
export function Popover(props: Pop.PopoverProps) {
  return <Pop.Root modal {...props} />;
}

export const PopoverTrigger = Pop.Trigger;

export function PopoverContent({
  children,
  align = 'start',
  className = '',
  label,
}: {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** What the panel is, for screen readers. */
  label: string;
}) {
  return (
    <Pop.Portal>
      <Pop.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        aria-label={label}
        // A tap inside isn't a tap on the card behind (React passes events
        // up through the portal).
        onClick={(e) => e.stopPropagation()}
        className={`z-overlay rounded-md border border-border bg-card p-2 text-xs text-foreground shadow-lg outline-none ${className}`}
      >
        {children}
      </Pop.Content>
    </Pop.Portal>
  );
}
