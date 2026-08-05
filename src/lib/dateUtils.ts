import { format, parseISO, isValid } from 'date-fns';

export function safeFormat(dateStr: string | undefined | null, fmt: string, fallback = '—'): string {
  if (!dateStr) return fallback;
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, fmt) : fallback;
}

export function isPastFixture(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = parseISO(dateStr);
  if (!isValid(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}