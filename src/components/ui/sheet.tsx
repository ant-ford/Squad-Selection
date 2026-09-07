import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * The one overlay primitive: backdrop + Escape-to-close + body scroll lock
 * while open. Every bottom sheet and dialog in the app renders through this
 * (and SheetContent below) so they share one z-index pair and one set of
 * dismiss behaviours instead of each hand-rolling its own.
 */
export function Sheet({
  children,
  open,
  onOpenChange,
  /** z-40/z-50 covers the app; a dialog that can stack above an already-open
   *  sheet (ConfirmDialog, the photo lightbox) raises both to the z-60 pair. */
  raised = false,
}: {
  children: React.ReactNode;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  raised?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange?.(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 ${raised ? 'z-[60]' : 'z-40'}`}
        onClick={() => onOpenChange?.(false)}
      />
      {children}
    </>
  );
}

export function SheetContent({
  children,
  side = 'bottom',
  className = '',
}: {
  children: React.ReactNode;
  side?: 'bottom' | 'right' | 'center';
  className?: string;
}) {
  const positionClasses =
    side === 'bottom'
      ? 'fixed bottom-0 left-0 right-0 rounded-t-2xl max-h-[85vh] overflow-y-auto'
      : side === 'right'
      ? 'fixed right-0 top-0 h-full w-full max-w-md border-l'
      : 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl max-h-[85vh] overflow-y-auto';
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`${positionClasses} bg-background shadow-lg z-50 ${className}`}
    >
      {children}
    </div>
  );
}

/** Header row with a title and, when `onClose` is given, a close button. */
export function SheetHeader({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  if (!onClose) return <div className="mb-4">{children}</div>;
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      {children}
      <button
        onClick={onClose}
        className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

export function SheetTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold text-lg text-foreground">{children}</h2>;
}
