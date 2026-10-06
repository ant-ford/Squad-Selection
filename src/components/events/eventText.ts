import { safeFormat } from '@/lib/dateUtils';
import { toneClasses } from '@/lib/statusTone';
import { PAYMENT_LABEL, priceText, type EventDetails, type ResponseStatus } from '@shared/events';

export const statusChip: Record<ResponseStatus, string> = {
  going: toneClasses('success'),
  maybe: toneClasses('warning'),
  not_going: toneClasses('neutral'),
};

/** "Sat 12 Dec, 19:00 – 23:00", or across days "Fri 3 Apr, 18:00 – Sun 5 Apr" (24-hour, as the glossary says). */
export function eventWhen(e: Pick<EventDetails, 'startsAt' | 'endsAt'>): string {
  const start = safeFormat(e.startsAt, 'EEE d MMM, HH:mm');
  if (!e.endsAt) return start;
  const sameDay = safeFormat(e.startsAt, 'yyyy-MM-dd') === safeFormat(e.endsAt, 'yyyy-MM-dd');
  return `${start} – ${safeFormat(e.endsAt, sameDay ? 'HH:mm' : 'EEE d MMM')}`;
}

/** The price lines: member, then guests, then how it's paid. Empty when free. */
export function priceLines(e: EventDetails): string[] {
  if (e.paymentMode === 'free') return [];
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
