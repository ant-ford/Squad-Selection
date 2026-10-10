/** Player-authored uncertainty or absence needs context for the coaches. */
export const availabilityNeedsNote = (status: string) => status === 'Maybe' || status === 'Unavailable';

export const AVAILABILITY_NOTE_REQUIRED = 'Add a note for Maybe or No so your coaches know what to expect.';
