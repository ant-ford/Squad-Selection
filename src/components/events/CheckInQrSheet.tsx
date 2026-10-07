import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Copy } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { secondary } from '@/components/profile/steps';
import { getCheckinLink } from '@/api/events';
import type { EventDetails } from '@shared/events';
import { eventWhen } from './eventText';

/** The link as a QR code, drawn as SVG so it stays sharp on screen and in print. */
function QrSvg({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }, [text]);
  return <div className="w-full max-w-[320px] mx-auto bg-white rounded-lg p-2 [&_svg]:w-full [&_svg]:h-auto" role="img" aria-label="Check-in QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The QR code members scan at the door to tick themselves in: show it on a
 * phone, or print it with the poster. It works from an hour before the
 * start until an hour after the end.
 */
export default function CheckInQrSheet({ event, onClose }: { event: EventDetails; onClose: () => void }) {
  const q = useQuery({ queryKey: ['checkinLink', event.id], queryFn: () => getCheckinLink(event.id) });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="center">
        <SheetHeader onClose={onClose}>
          <SheetTitle>Check in: {event.title}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-3 text-center">
          <p className="text-xs text-muted-foreground">{eventWhen(event)}</p>
          {q.data ? <QrSvg text={q.data.url} /> : <Skeleton className="w-full max-w-[320px] aspect-square mx-auto" />}
          <p className="text-sm text-foreground">Scan with your phone camera, then tap <strong>I'm here</strong>.</p>
          <p className="text-xs text-muted-foreground">Works from an hour before the start until an hour after the end. Show it on your phone at the door, or print it with the poster.</p>
          {q.data && (
            <button className={`${secondary} inline-flex items-center gap-1`} onClick={() => void navigator.clipboard.writeText(q.data.url).then(() => toast.success('Link copied'))}>
              <Copy className="h-4 w-4" /> Copy check-in link
            </button>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
