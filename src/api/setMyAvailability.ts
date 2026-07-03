import { availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';

export async function setMyAvailability(
  matchId: string,
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string,
  existingExceptionId?: string
) {
  const user = await getCurrentPeople();

  if (status === 'Available') {
    if (existingExceptionId) {
      await availabilityRepository.delete(existingExceptionId);
    }
  } else if (existingExceptionId) {
    await availabilityRepository.update(existingExceptionId, {
      availabilityStatus: status,
      playerNotes: notes || '',
      updatedBy: user.id,
    });
  } else {
    await availabilityRepository.create({
      match: matchId,
      player: user.id,
      availabilityStatus: status,
      playerNotes: notes || '',
      updatedBy: user.id,
    });
  }

  return { success: true };
}