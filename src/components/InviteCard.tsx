import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Copy, MessageCircle, UserPlus } from 'lucide-react';
import { useMyProfile } from '@/lib/queries';

const MESSAGE = "Interested in playing hockey with HKFC? Register your interest here and we'll be in touch about trials:";

/**
 * A member's own link for inviting someone to register their interest in
 * joining (trials.ts): copy it, or send it on WhatsApp. Folded away by
 * default so it doesn't crowd the player page.
 */
export default function InviteCard() {
  const { data } = useMyProfile();
  const [open, setOpen] = useState(false);
  const link = data?.inviteLink;
  if (!link) return null;
  const copy = () =>
    void navigator.clipboard
      .writeText(link)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error("Couldn't copy: press and hold the link to copy it."));
  return (
    <section className="mb-3 rounded-xl border border-border bg-card">
      <button className="w-full flex items-center gap-2 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <UserPlus className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1 text-sm font-medium text-foreground">Invite someone to join</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Send this link to anyone who'd like to play with us. They register their interest, and the Section Captains are told you sent them.
          </p>
          <p className="text-xs text-foreground break-all rounded-md bg-muted/50 p-2">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground">
              <Copy className="h-3.5 w-3.5" /> Copy link
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${MESSAGE} ${link}`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Send on WhatsApp
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
