import { useState } from 'react';
import { ActionButton } from '@/components/ui/action-button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** A word they must type before the confirm button works, for what can't be undone. */
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation dialog used across the app for destructive actions:
 * a bottom sheet on phones, a centred box on wider screens. It stacks above
 * any sheet that's open, and Escape closes it first.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const ready = !busy && (!typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase());
  return (
    <Sheet open onOpenChange={(next) => !next && onCancel()}>
      <SheetContent side="dialog">
        <div className="p-4">
          <SheetTitle className="mb-2 font-medium">{title}</SheetTitle>
          <p className="text-sm text-muted-foreground mb-4">{message}</p>
          {typeToConfirm && (
            <label className="block mb-4 text-sm text-foreground">
              Type <span className="font-semibold">{typeToConfirm}</span> to confirm
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="mt-1 block w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          )}
          <div className="flex gap-2">
            <ActionButton variant="outline" className="flex-1" onClick={onCancel}>
              {cancelLabel}
            </ActionButton>
            <ActionButton
              variant={destructive ? 'danger' : 'primary'}
              className="flex-1"
              onClick={onConfirm}
              disabled={!ready}
            >
              {confirmLabel}
            </ActionButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}