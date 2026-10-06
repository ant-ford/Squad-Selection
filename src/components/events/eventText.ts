import { safeFormat } from '@/lib/dateUtils';
import { PAYMENT_LABEL, priceText, type EventDetails, type ResponseStatus } from '@shared/events';

export const statusChip: Record<ResponseStatus, string> = {
  going: 'bg-emerald-500/15 text-emerald-700',
  maybe: 'bg-amber-500/15 text-amber-700',
  not_going: 'bg-muted text-muted-foreground',
};

/** "Sat 12 Dec, 7:00 pm – 11:00 pm", or across days "Fri 3 Apr, 6:00 pm – Sun 5 Apr". */
export function eventWhen(e: Pick<EventDetails, 'startsAt' | 'endsAt'>): string {
  const start = safeFormat(e.startsAt, 'EEE d MMM, h:mm a');
  if (!e.endsAt) return start;
  const sameDay = safeFormat(e.startsAt, 'yyyy-MM-dd') === safeFormat(e.endsAt, 'yyyy-MM-dd');
  return `${start} – ${safeFormat(e.endsAt, sameDay ? 'h:mm a' : 'EEE d MMM')}`;
}

/** The price lines: member, then guests, then how it's paid. Empty when free. */
export function priceLines(e: EventDetails): string[] {
  if (e.paymentMode === 'free') return [];
  if (e.paymentMode === 'self_funded') {
    const cost = priceText(e.memberPrice);
    return [cost ? `Self-funded, about ${cost} each` : 'Self-funded'];
  }
  const lines: string[] = [];
  const member = priceText(e.memberPrice);
  if (member) lines.push(`Members ${member}`);
  if (e.guestsAllowed) {
    const adult = priceText(e.guestAdultPrice);
    const child = priceText(e.guestChildPrice);
    if (adult) lines.push(`Adult guests ${adult}`);
    if (child) lines.push(`Child guests ${child}`);
  }
  lines.push(PAYMENT_LABEL[e.paymentMode]);
  return lines;
}

/** A datetime-local value for an ISO time, on the Hong Kong clock. */
export const toLocalInput = (iso: string | null | undefined) => (iso ? safeFormat(iso, "yyyy-MM-dd'T'HH:mm", '') : '');

/** A datetime-local value read as Hong Kong time, wherever the browser is. */
export const fromLocalInput = (v: string) => (v ? `${v}:00+08:00` : null);
