import { availabilityLabel, type AvailabilityAnswer } from '@/lib/availabilityTone';

/**
 * The three answers a player (or a coach on their behalf) can give for a
 * fixture, in the order the segmented control shows them. The stored value
 * for "No" stays Unavailable.
 */
export const ANSWERS: readonly AvailabilityAnswer[] = ['Available', 'Maybe', 'Unavailable'];

export interface AnswerOption {
  value: AvailabilityAnswer;
  label: string;
  pressed: boolean;
}

/**
 * The control's three buttons: "Available / Maybe / No", with "Going" in
 * place of Available once the player is in the squad. Exactly one is pressed
 * when the current status is one of the three; none for anything else.
 */
export function answerOptions(current: string | null | undefined, isSelected = false): AnswerOption[] {
  return ANSWERS.map((value) => ({
    value,
    label: availabilityLabel(value, isSelected),
    pressed: current === value,
  }));
}

/** What the "pref." tag next to the control means, for screen readers and hover. */
export function preferenceTagLabel(whose: 'your' | 'their'): string {
  return whose === 'your'
    ? 'Set by your availability preferences. Choose an answer to set this fixture on its own.'
    : 'Set by their availability preferences. Saving an answer sets this fixture on its own.';
}
