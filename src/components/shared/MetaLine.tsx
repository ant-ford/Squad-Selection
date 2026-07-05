import { MapPin, Calendar, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';

/** Reusable date/venue/time meta row. */
export function MetaLine({ date, venue }: { date: string; venue: string }) {
  const d = parseISO(date);
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
      <span className="flex items-center gap-1">
        <Calendar className="h-3 w-3" />
        {format(d, 'EEE d MMM')}
      </span>
      <span className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {format(d, 'HH:mm')}
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
