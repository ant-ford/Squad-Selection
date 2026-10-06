import { toast } from 'sonner';
import { Copy, MessageCircle } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const MESSAGE = "Interested in playing hockey with HKFC? Register your interest here and we'll be in touch about trials:";

/**
 * A member's own link for inviting someone to register their interest in
 * joining (trials.ts): copy it, or send it on WhatsApp. Opened from the
 * header menu, so it doesn't sit on the fixtures page.
 */
export default function InviteDialog({ link, onClose }: { link: string; onClose: () => void }) {
  const copy = () =>
    void navigator.clipboard
      .writeText(link)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error("Couldn't copy: press and hold the link to copy it."));
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="dialog">
        <SheetHeader onClose={onClose}>
          <SheetTitle className="font-medium">Invite someone to join</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Send this link to anyone who'd like to play with us. They register their interest, and the Section Captains are told you sent them.
          </p>
          <p className="text-xs text-foreground break-all rounded-md bg-muted/50 p-2">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border hover:bg-muted text-foreground">
              <Copy className="h-4 w-4" /> Copy link
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${MESSAGE} ${link}`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground"
            >
              <MessageCircle className="h-4 w-4" /> Send on WhatsApp
            </a>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
