import { useState } from 'react';
import { Lightbox } from '@/components/ui/lightbox';

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
      <Lightbox src={open ? url : null} alt={`${title} poster`} onClose={() => setOpen(false)} />
    </>
  );
}
