import type { StatementCard as Card } from '@/api/membership';
import { safeFormat } from '@/lib/dateUtils';
import { NOT_STARTED } from '@shared/statementStages';
import { ageTone } from './ApplicantCard';

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

export function Initial({ name, size = 'h-10 w-10' }: { name: string; size?: string }) {
  return (
    <div className={`${size} shrink-0 rounded-full bg-primary/10 flex items-center justify-center`}>
      <span className="text-sm font-bold text-primary">{(name || '?')[0].toUpperCase()}</span>
    </div>
  );
}

export default function StatementCard({ card, today, onOpen }: { card: Card; today: string; onOpen: () => void }) {
  const status = statementStatus(card, today);
  const meta = [card.team, card.sponsor ? `Sponsor ${card.sponsor}` : undefined].filter(Boolean).join(' · ');
  const period = periodLabel(card);
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
        <Initial name={card.name} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{card.name}</p>
          {period && <p className="text-xs text-muted-foreground truncate">{period}</p>}
          {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
          {card.membershipNo && <p className="text-xs text-muted-foreground">No. {card.membershipNo}</p>}
        </div>
      </div>
      {(status || (card.waitingOn && card.stage !== NOT_STARTED)) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {status && <span className={`text-[11px] px-1.5 py-0.5 rounded ${status.tone}`}>{status.label}</span>}
          {card.waitingOn && card.stage !== NOT_STARTED && (
            <span className="text-[11px] text-muted-foreground truncate">Waiting on {card.waitingOn}</span>
          )}
        </div>
      )}
    </div>
  );
}
