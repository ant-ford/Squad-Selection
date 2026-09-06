import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
          <div className="flex gap-2">
            <Button className="flex-1 h-10" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              className={`flex-1 h-10 ${
                destructive
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-primary text-primary-foreground'
              }`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}