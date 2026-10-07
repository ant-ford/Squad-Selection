import { X } from 'lucide-react';
import { useReturnFocus } from '@/components/ui/sheet';
import { useDialogLib, type DialogLib } from '@/components/ui/dialogLib';

/**
 * A picture full screen on a dark backdrop. A tap anywhere, the close button
 * or Escape closes it, and focus goes back to what opened it.
 */
export function Lightbox({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  const Dialog = useDialogLib(!!src);
  if (!Dialog) return null;
  return (
    <Dialog.Root open={!!src} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-black/85" />
        {src && <LightboxContent Dialog={Dialog} src={src} alt={alt} onClose={onClose} />}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LightboxContent({ Dialog, src, alt, onClose }: { Dialog: DialogLib; src: string; alt: string; onClose: () => void }) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Content
      aria-describedby={undefined}
      onCloseAutoFocus={returnFocus}
      onClick={onClose}
      className="fixed inset-0 z-overlay flex items-center justify-center p-3 focus:outline-none"
    >
      <Dialog.Title className="sr-only">{alt}</Dialog.Title>
      <img src={src} alt={alt} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
      <Dialog.Close className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white" aria-label="Close">
        <X className="h-5 w-5" />
      </Dialog.Close>
    </Dialog.Content>
  );
}
