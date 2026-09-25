import { MessageCircle } from 'lucide-react';
import type { ApplicantCard as Card } from '@/api/membership';
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

export function applicantWhatsApp(card: Card): string | null {
  const number = toWhatsAppNumber(card.mobileNo);
  if (!number) return null;
  const first = card.name.split(' ')[0] || card.name;
  return whatsAppLink(number, `Hi ${first}, `);
}

export function Avatar({ card, size = 'h-10 w-10' }: { card: Card; size?: string }) {
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

export default function ApplicantCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const whatsApp = applicantWhatsApp(card);
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
        {whatsApp && (
          <a
            href={whatsApp}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={`WhatsApp ${card.name}`}
            title="WhatsApp"
          >
            <MessageCircle className="h-4 w-4" />
          </a>
        )}
      </div>
      {(age || card.waitingOn) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {age && <span className={`text-[11px] px-1.5 py-0.5 rounded ${ageTone(card.days)}`}>{age}</span>}
          {card.waitingOn && (
            <span className="text-[11px] text-muted-foreground truncate">Waiting on {card.waitingOn}</span>
          )}
        </div>
      )}
    </div>
  );
}
