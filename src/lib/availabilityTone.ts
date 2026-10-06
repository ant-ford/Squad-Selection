import { availableLabel } from '@shared/availableLabel';
import { toneClasses, toneHatch, type StatusTone, type ToneStyle } from '@/lib/statusTone';

/**
 * The one place an availability answer gets its colour. Available is the
 * success tone, Maybe warning, Unavailable danger; anything else (no answer,
 * an unknown value) is neutral.
 *
 * Accepts the loose `string` the API types carry (MyFixture.availabilityStatus,
 * TeamAvailabilityRow.status) as well as the strict union.
 */

export type AvailabilityAnswer = 'Available' | 'Maybe' | 'Unavailable';

const TONE: Record<AvailabilityAnswer, StatusTone> = {
  Available: 'success',
  Maybe: 'warning',
  Unavailable: 'danger',
};

export function availabilityTone(status: string | null | undefined): StatusTone {
  return (status && TONE[status as AvailabilityAnswer]) || 'neutral';
}

/**
 * Classes for an availability answer in one of the shared styles
 * (see ToneStyle in statusTone.ts). Default: `soft`.
 *
 *   availabilityClasses('Maybe')          -> pill tint + text
 *   availabilityClasses('Maybe', 'chip')  -> same, plus a border colour
 *   availabilityClasses('No answer')      -> neutral greys
 */
export function availabilityClasses(status: string | null | undefined, style: ToneStyle = 'soft'): string {
  return toneClasses(availabilityTone(status), style);
}

/** Hatching in the answer's colour (AttendanceGrid's "available, not picked"). */
export function availabilityHatch(status: string | null | undefined) {
  return toneHatch(availabilityTone(status));
}

/**
 * The word shown for an answer: "Available" (or "Going" once selected),
 * "Maybe", "No". Empty or unknown shows a dash.
 */
export function availabilityLabel(status: string | null | undefined, selected = false): string {
  if (status === 'Available') return availableLabel(selected);
  if (status === 'Maybe') return 'Maybe';
  if (status === 'Unavailable') return 'No';
  return status || '—';
}
