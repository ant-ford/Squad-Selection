import { MapPin, Calendar, Clock } from 'lucide-react';
import { safeFormat, countdownLabel, hkDaysUntil } from '@/lib/dateUtils';

/**
 * Reusable date/venue/time meta row, with a countdown to the fixture.
 *
 * The countdown earns its emphasis rather than shouting by default: it is
 * quiet for anything a week or more away, picks up weight inside the week,
 * and only takes the accent colour on the day itself. A row of loud badges
 * on every fixture would tell a player nothing about which one to act on.
 */
export function MetaLine({ date, venue }: { date: string; venue: string }) {
  const countdown = countdownLabel(date);
  const days = hkDaysUntil(date);

  const tone =
    days === null || days < 0
      ? 'border-border/70 text-muted-foreground'
      : days === 0
      ? 'border-primary/30 bg-primary/10 text-primary'
      : days <= 6
      ? 'border-border bg-muted/60 text-foreground'
      : 'border-border/70 text-muted-foreground';

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
      <span className="flex items-center gap-1">
        <Calendar className="h-3 w-3" />
        {safeFormat(date, 'EEE d MMM')}
      </span>
      {countdown && (
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tabular-nums ${tone}`}
        >
          {countdown}
        </span>
      )}
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {safeFormat(date, 'HH:mm')}
      </span>
      {venue && (
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {venue}
        </span>
      )}
    </div>
  );
}
