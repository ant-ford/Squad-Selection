import { safeFormat } from '@/lib/dateUtils';

/**
 * How a fixture's date reads everywhere: "Sun 18 Oct" (shown in caps). No
 * year: the lists cover one season, and the space matters on a phone.
 */
export const FIXTURE_DATE = 'EEE d MMM';

/**
 * A day's heading in a list of fixtures or duties: bold caps, ruled to the
 * edge. The coach dashboard, the goalkeepers' list and the umpiring duties
 * share it so the three read the same.
 */
export function DateHeading({ date, suffix }: { date: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <h2 className="text-sm font-bold text-foreground uppercase tracking-wide whitespace-nowrap">
        {safeFormat(date, FIXTURE_DATE)}
        {suffix}
      </h2>
      <div className="h-px flex-1 bg-foreground/15" />
    </div>
  );
}
