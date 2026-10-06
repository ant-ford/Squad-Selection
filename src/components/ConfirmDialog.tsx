import { useState } from 'react';
import { ActionButton } from '@/components/ui/action-button';
import { Sheet } from '@/components/ui/sheet';

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
 * Shared confirmation dialog used across the app for destructive actions.
 * Renders as a centred modal (desktop) / bottom sheet (mobile) overlay.
 * Replaces all `window.confirm` calls and ad-hoc confirmation modals.
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
    <Sheet open raised onOpenChange={(next) => !next && onCancel()}>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[61] flex items-end sm:items-center justify-center pointer-events-none"
      >
        <div className="bg-background rounded-t-2xl sm:rounded-lg p-4 w-full sm:max-w-sm mx-0 sm:mx-4 shadow-lg pointer-events-auto">
          <p className="text-foreground font-medium mb-2">{title}</p>
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
      </div>
    </Sheet>
  );
}