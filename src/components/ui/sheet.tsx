import React from 'react';

export function Sheet({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  // Backwards-compatible: if `open` isn't provided, render children as before.
  if (open === undefined) return <>{children}</>;
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
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
  side?: 'bottom' | 'right';
  className?: string;
}) {
  const positionClasses =
    side === 'bottom'
      ? 'fixed bottom-0 left-0 right-0 rounded-t-2xl max-h-[85vh] overflow-y-auto'
      : 'fixed right-0 top-0 h-full w-full max-w-md border-l';
  return (
    <div className={`${positionClasses} bg-background p-4 shadow-lg z-50 ${className}`}>
      {children}
    </div>
  );
}

export function SheetHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function SheetTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold text-lg">{children}</h2>;
}