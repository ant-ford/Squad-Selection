import { useState } from 'react';
import { X } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';

/**
 * An event's poster, fitted to the sheet; a tap shows it full screen (the
 * same lightbox as the ranking screen's photos), and a tap anywhere closes it.
 */
export default function PosterImage({ url, title, className = '' }: { url: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full" aria-label={`Show the ${title} poster full size`}>
        <img src={url} alt={`${title} poster`} className={`w-full object-contain rounded-lg bg-muted cursor-zoom-in ${className}`} />
      </button>
      <Sheet open={open} raised onOpenChange={(next) => !next && setOpen(false)}>
        <div className="fixed inset-0 z-[61] bg-black/85 flex items-center justify-center p-3" onClick={() => setOpen(false)} role="dialog" aria-label={`${title} poster`}>
          <img src={url} alt={`${title} poster`} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          <button type="button" className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </Sheet>
    </>
  );
}
