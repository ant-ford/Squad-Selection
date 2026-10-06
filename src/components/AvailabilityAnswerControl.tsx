import { Check } from 'lucide-react';
import { availabilityClasses, type AvailabilityAnswer } from '@/lib/availabilityTone';
import { answerOptions } from '@/lib/availabilityAnswers';

interface Props {
  /** The current answer (MyFixture.availabilityStatus and friends). */
  value: string | null | undefined;
  onChange: (status: AvailabilityAnswer) => void;
  /** Names the group for screen readers, e.g. "Your answer for HKFC C vs Valley B". */
  label: string;
  /** In the squad: Available reads "Going". */
  isSelected?: boolean;
  /**
   * The answer comes from a standing preference, not one given for this
   * fixture: a small "pref." tag sits next to the control, and this text is
   * what it says to screen readers and on hover.
   */
  preferenceLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Available / Maybe / No as one 44 px segmented control. The chosen answer
 * is filled in its colour and carries a tick, so it does not rely on colour
 * alone; each button is a toggle with aria-pressed.
 *
 * Never put this inside another button or role="button" element: nested
 * interactive controls are announced wrongly and a tap can reach both.
 */
export default function AvailabilityAnswerControl({
  value,
  onChange,
  label,
  isSelected = false,
  preferenceLabel,
  disabled = false,
  className = '',
}: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div role="group" aria-label={label} className="flex flex-1 min-w-0 rounded-lg border border-border overflow-hidden divide-x divide-border">
        {answerOptions(value, isSelected).map(({ value: v, label: text, pressed }) => (
          <button
            key={v}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={`h-11 flex-1 min-w-0 inline-flex items-center justify-center gap-1 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 ${
              pressed ? availabilityClasses(v, 'solid') : 'bg-background text-foreground hover:bg-muted'
            }`}
          >
            {pressed && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="truncate">{text}</span>
          </button>
        ))}
      </div>
      {preferenceLabel && (
        <span
          role="note"
          aria-label={preferenceLabel}
          title={preferenceLabel}
          className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          pref.
        </span>
      )}
    </div>
  );
}
