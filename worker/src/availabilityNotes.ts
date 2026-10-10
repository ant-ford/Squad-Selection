import { availabilityNeedsNote, AVAILABILITY_NOTE_REQUIRED } from '../../shared/availabilityNotes';
import { HttpError } from './http';

/** Validate self-service writes before any database mutation; old clients
 * cannot save the status first and skip the explanation afterwards.
 */
export function playerAvailabilityNote(status: string, notes: unknown): string | undefined {
  if (notes != null && typeof notes !== 'string') throw new HttpError('Note must be text', 400);
  const note = typeof notes === 'string' ? notes.trim() : undefined;
  if (availabilityNeedsNote(status) && !note) throw new HttpError(AVAILABILITY_NOTE_REQUIRED, 400);
  return note;
}
