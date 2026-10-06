import { Check } from 'lucide-react';
import { safeFormat } from '@/lib/dateUtils';
import { availabilityClasses, type AvailabilityAnswer } from '@/lib/availabilityTone';
import { dayAnswerOptions } from '@/lib/availabilityAnswers';
import { commonDayAnswer } from '@/lib/sameDayGames';
import { FIXTURE_DATE } from '@/components/shared';
import type { MyFixture } from '@/api/getMyFixtures';

/**
 * One answer for every game on a day: "All available / All maybe / All no".
 * Shown in front of the first card of each day with more than one fixture.
 * It uses the whole-day update, which also covers HKFC games that day not on
 * this page; each card can still be changed on its own afterwards.
 */
export default function DayAnswerControl({
  date,
  fixtures,
  busy,
  onSet,
}: {
  /** The Hong Kong day key (YYYY-MM-DD). */
  date: string;
  /** Every fixture the player has that day, from all lists. */
  fixtures: MyFixture[];
  busy: boolean;
  onSet: (date: string, status: AvailabilityAnswer) => void;
}) {
  const day = safeFormat(fixtures[0]?.date ?? date, FIXTURE_DATE);
  return (
    <div
      role="group"
      aria-label={`Whole day, ${day}, ${fixtures.length} games`}
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      {/* Just the date: with the count as well the row wrapped on a phone. */}
      <span className="mr-auto text-xs font-medium text-muted-foreground" aria-hidden="true">
        {day}
      </span>
      {dayAnswerOptions(commonDayAnswer(fixtures)).map(({ value, label, pressed }) => (
        <button
          key={value}
          type="button"
          aria-pressed={pressed}
          disabled={busy}
          onClick={() => onSet(date, value)}
          className={`h-10 inline-flex items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
            pressed ? `${availabilityClasses(value, 'solid')} border-transparent` : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          {pressed && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  );
}
