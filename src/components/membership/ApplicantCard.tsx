import { MessageCircle } from 'lucide-react';
import type { ApplicantCard as Card, Chase } from '@/api/membership';
import { toWhatsAppNumber, whatsAppLink } from '@/lib/whatsapp';

/** Amber from two weeks in one stage, red from a month. */
export function ageTone(days: number | null): string {
  if (days === null) return 'bg-muted text-muted-foreground';
  if (days >= 30) return 'bg-destructive/15 text-destructive';
  if (days >= 14) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

export function ageLabel(card: Card): string | null {
  if (card.days === null) return null;
  return card.stageSince ? `${card.days}d in stage` : `applied ${card.days}d ago`;
}

/** A wa.me link to `mobile` with `message` typed in, or null when the number is unusable. */
export function whatsAppTo(mobile: string | undefined, message: string): string | null {
  const number = toWhatsAppNumber(mobile);
  return number ? whatsAppLink(number, message) : null;
}

export function applicantWhatsApp(card: Card): string | null {
  const first = card.name.split(' ')[0] || card.name;
  return whatsAppTo(card.mobileNo, `Hi ${first}, `);
}

/** "sponsor" / "Chairman" / "Membership Officer", as said in a message. */
const roleInMessage = (role: Chase['role']) => (role === 'Sponsor' ? 'sponsor' : role);

/** WhatsApp to whoever the application is waiting on, with a reminder typed in. */
export function chaseWhatsApp(card: Card): string | null {
  if (!card.chase) return null;
  return whatsAppTo(
    card.chase.mobile,
    `Hi ${card.chase.firstName || card.chase.name}, ${card.name}'s membership application is waiting for your signature as ${roleInMessage(card.chase.role)}.`,
  );
}

export function Avatar({ card, size = 'h-10 w-10' }: { card: { name: string; photo?: string }; size?: string }) {
  return (
    <div className={`${size} shrink-0 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center`}>
      {card.photo ? (
        <img
          src={card.photo}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          // Airtable attachment URLs expire; fall back to the initial.
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span className="text-sm font-bold text-primary">{(card.name || '?')[0].toUpperCase()}</span>
      )}
    </div>
  );
}

/** A small WhatsApp icon link that does not open the card it sits on. */
export function WhatsAppIcon({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="p-1.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
      aria-label={label}
      title={label}
    >
      <MessageCircle className="h-4 w-4" />
    </a>
  );
}

export default function ApplicantCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const whatsApp = applicantWhatsApp(card);
  const chase = chaseWhatsApp(card);
  const age = ageLabel(card);
  const meta = [card.team, card.playingPosition].filter(Boolean).join(' · ');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="bg-card border border-border rounded-lg p-3 text-left hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
    >
      <div className="flex items-start gap-2.5">
        <Avatar card={card} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{card.name}</p>
          {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
          {card.membershipNo && <p className="text-xs text-muted-foreground">No. {card.membershipNo}</p>}
        </div>
        {whatsApp && <WhatsAppIcon href={whatsApp} label={`WhatsApp ${card.name}`} />}
      </div>
      {(age || card.waitingOn) && (
        <div className="mt-2 flex items-center gap-1.5">
          {age && <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${ageTone(card.days)}`}>{age}</span>}
          {card.waitingOn && (
            <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">Waiting on {card.waitingOn}</span>
          )}
          {chase && card.chase && (
            <WhatsAppIcon href={chase} label={`WhatsApp ${card.chase.name} (${card.chase.role})`} />
          )}
        </div>
      )}
    </div>
  );
}
