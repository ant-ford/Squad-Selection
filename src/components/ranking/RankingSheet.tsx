import type { ReactNode } from 'react';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** The ranking screen's bottom sheet: title, close button, padded body clear of the home bar. */
export function RankingSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {children}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
