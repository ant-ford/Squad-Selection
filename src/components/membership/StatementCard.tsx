import type { StatementCard as Card } from '@/api/membership';
import { safeFormat } from '@/lib/dateUtils';
import { NOT_STARTED, NOTIFIED } from '@shared/statementStages';
import { Avatar, WhatsAppIcon, ageTone, whatsAppTo } from './ApplicantCard';

const date = (d?: string) => (d ? safeFormat(d, 'd MMM yyyy') : undefined);

/**
 * The line that matters on a Not Started review: when the automatic email
 * goes, or why it has not. Elsewhere, how long the review has sat in its
 * stage.
 */
export function statementStatus(card: Card, today: string): { label: string; tone: string } | null {
  if (card.stage === NOT_STARTED) {
    if (card.notifyRequested) return { label: 'Email requested', tone: 'bg-primary/10 text-primary' };
    if (card.inAutoWindow) return { label: 'Automatic email due: check the automation', tone: ageTone(14) };
    if (card.periodEnd && card.periodEnd < today) return { label: `Period ended ${date(card.periodEnd)}`, tone: ageTone(30) };
    if (card.autoNoticeOn) return { label: `Automatic email ${date(card.autoNoticeOn)}`, tone: ageTone(null) };
    return null;
  }
  if (card.days === null) return null;
  return { label: `${card.days}d in stage`, tone: ageTone(card.days) };
}

export function periodLabel(card: Card): string | undefined {
  const period =
    card.periodStart && card.periodEnd ? `${date(card.periodStart)} – ${date(card.periodEnd)}` : card.period;
  return [card.yearNo ? `Year ${card.yearNo}` : undefined, period].filter(Boolean).join(' · ') || undefined;
}

const firstOf = (name: string) => name.split(' ')[0] || name;

/**
 * WhatsApp to the member. Once they have been emailed, the message is a
 * reminder to fill in the Commitment Form.
 */
export function memberWhatsApp(card: Card): string | null {
  const first = firstOf(card.name);
  return whatsAppTo(
    card.mobileNo,
    card.stage === NOTIFIED
      ? `Hi ${first}, a reminder to fill in the Commitment Form from the email about your HKFC commitment review.`
      : `Hi ${first}, `,
  );
}

/** WhatsApp to the sponsor while the review waits on their section. */
export function sponsorWhatsApp(card: Card): string | null {
  if (!card.chase) return null;
  return whatsAppTo(
    card.chase.mobile,
    `Hi ${card.chase.firstName || card.chase.name}, ${card.name}'s commitment review is waiting for your sponsor section.`,
  );
}

export default function StatementCard({ card, today, onOpen }: { card: Card; today: string; onOpen: () => void }) {
  const status = statementStatus(card, today);
  const meta = [card.team, card.sponsor ? `Sponsor ${card.sponsor}` : undefined].filter(Boolean).join(' · ');
  const period = periodLabel(card);
  const whatsApp = memberWhatsApp(card);
  const chase = sponsorWhatsApp(card);
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
          {period && <p className="text-xs text-muted-foreground truncate">{period}</p>}
          {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
          {card.membershipNo && <p className="text-xs text-muted-foreground">No. {card.membershipNo}</p>}
        </div>
        {whatsApp && <WhatsAppIcon href={whatsApp} label={`WhatsApp ${card.name}`} />}
      </div>
      {(status || (card.waitingOn && card.stage !== NOT_STARTED)) && (
        <div className="mt-2 flex items-center gap-1.5">
          {status && <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${status.tone}`}>{status.label}</span>}
          {card.waitingOn && card.stage !== NOT_STARTED && (
            <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">Waiting on {card.waitingOn}</span>
          )}
          {chase && card.chase && <WhatsAppIcon href={chase} label={`WhatsApp ${card.chase.name} (Sponsor)`} />}
        </div>
      )}
    </div>
  );
}
