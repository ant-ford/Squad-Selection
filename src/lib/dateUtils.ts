import { format, parseISO, isValid } from 'date-fns';

export function safeFormat(dateStr: string | undefined | null, fmt: string, fallback = '—'): string {
  if (!dateStr) return fallback;
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, fmt) : fallback;
}