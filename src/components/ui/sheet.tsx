import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { X } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DialogLibContext, useDialogLib } from '@/components/ui/dialogLib';

/** How SheetHeader's close button reaches the open sheet's "ask first" check. */
const SheetGuard = createContext<((close: () => void) => void) | null>(null);

/**
 * The one overlay primitive, on Radix Dialog: every bottom sheet, side panel
 * and dialog in the app renders through this and SheetContent.
 *
 * - Focus moves into the sheet, stays in it, and goes back to where it was
 *   when the sheet closes.
 * - Escape and a tap on the backdrop close only the top layer: a dialog
 *   opened from a sheet closes first.
 * - The page behind can't scroll, and screen readers hear only the sheet.
 *
 * Radix itself loads on first use (ui/dialogLib), not with the first page.
 *
 * `dirty`: the sheet holds something typed and not saved. The backdrop,
 * Escape and SheetHeader's close button then ask before closing; a Cancel
 * button the sheet draws itself can do the same with useSheetClose().
 */
export function Sheet({
  children,
  open,
  onOpenChange,
  dirty = false,
}: {
  children: React.ReactNode;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Unsaved changes: ask before closing. */
  dirty?: boolean;
}) {
  // The close that's waiting for "Discard" while the question is up.
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = useCallback(
    (close: () => void) => {
      if (dirty) setPending(() => close);
      else close();
    },
    [dirty],
  );

  const Dialog = useDialogLib(open);
  if (!Dialog) return null;
  return (
    <SheetGuard.Provider value={guard}>
      <DialogLibContext.Provider value={Dialog}>
        <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange?.(true) : guard(() => onOpenChange?.(false)))}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-overlay bg-black/40" />
            {children}
          </Dialog.Portal>
        </Dialog.Root>
      </DialogLibContext.Provider>
      {pending && (
        <ConfirmDialog
          title="Discard changes?"
          message="What you've changed here isn't saved."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => {
            const close = pending;
            setPending(null);
            close();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </SheetGuard.Provider>
  );
}

/**
 * For a Cancel button inside a sheet: `const cancel = useSheetClose(onClose)`
 * closes at once, or asks first while the sheet is dirty.
 */
export function useSheetClose(close: () => void): () => void {
  const guard = useContext(SheetGuard);
  return () => (guard ? guard(close) : close());
}

const POSITIONS = {
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl',
  right: 'right-0 top-0 h-full w-full max-w-md border-l border-border',
  center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[90vh] w-[min(92vw,420px)] rounded-2xl',
  // A bottom sheet on phones, a small centred box on wider screens.
  dialog:
    'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)] sm:max-w-sm sm:rounded-lg',
} as const;

/**
 * Focus goes back to whatever had it when the overlay opened. Radix would
 * send it to a Dialog.Trigger, and these overlays are opened from state, so
 * they have none. Opened from a menu item, which is about to disappear, it
 * goes back to the button that opened the menu (the menu's aria-labelledby).
 */
export function useReturnFocus() {
  const [opener] = useState(() => {
    const el = document.activeElement;
    const menu = el?.closest('[role=menu]');
    const button = menu?.getAttribute('aria-labelledby');
    return (button && document.getElementById(button)) || el;
  });
  return (e: Event) => {
    e.preventDefault();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
}

/** A tap on a toast isn't a tap outside the sheet. */
const keepForToasts = (e: Event) => {
  if (e.target instanceof Element && e.target.closest('[data-sonner-toaster]')) e.preventDefault();
};

/**
 * The sheet's box. It scrolls as a whole; put a SheetHeader first (it stays
 * at the top) and the rest in a SheetBody.
 *
 * Every sheet needs a title for screen readers: a SheetTitle, or `label`
 * when the sheet shows no title of its own.
 */
export function SheetContent({
  children,
  side = 'bottom',
  className = '',
  label,
}: {
  children: React.ReactNode;
  side?: keyof typeof POSITIONS;
  className?: string;
  /** The title read out when the sheet has no SheetTitle. */
  label?: string;
}) {
  const Dialog = useContext(DialogLibContext)!;
  const box = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Content
      ref={box}
      aria-describedby={undefined}
      // Focus the sheet itself rather than its first field, so opening a
      // sheet doesn't pop up the phone keyboard. A field with autoFocus keeps it.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        if (!box.current?.contains(document.activeElement)) box.current?.focus();
      }}
      onCloseAutoFocus={returnFocus}
      onInteractOutside={keepForToasts}
      className={`fixed z-overlay overflow-y-auto overscroll-contain bg-background shadow-lg focus:outline-none ${POSITIONS[side]} ${className}`}
    >
      {label && <Dialog.Title className="sr-only">{label}</Dialog.Title>}
      {children}
      {/* Clear of the iPhone home bar. */}
      {(side === 'bottom' || side === 'dialog') && (
        <div aria-hidden className={`h-[env(safe-area-inset-bottom)] ${side === 'dialog' ? 'sm:hidden' : ''}`} />
      )}
    </Dialog.Content>
  );
}

/**
 * The sheet's top bar: the title and, when `onClose` is given, a close
 * button. It stays at the top while the sheet scrolls.
 */
export function SheetHeader({
  children,
  onClose,
  closeLabel = 'Close',
}: {
  children: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  const guard = useContext(SheetGuard);
  return (
    <div className="sticky top-0 z-raised flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={() => (guard ? guard(onClose) : onClose())}
          className="-mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

export function SheetTitle({ children, className = 'text-lg font-semibold' }: { children: React.ReactNode; className?: string }) {
  const Dialog = useContext(DialogLibContext)!;
  return <Dialog.Title className={`text-foreground ${className}`}>{children}</Dialog.Title>;
}

/** The padded part of a sheet under its header. */
export function SheetBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
