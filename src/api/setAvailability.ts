import { peopleRepository, availabilityRepository } from '@/repositories';

export async function setAvailability(
  playerId: string,
  matchIds: string[],
  status: 'Available' | 'Maybe' | 'Unavailable',
  notes?: string
) {
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }

  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    return pId === playerId;
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  let updated = 0;

  for (const matchId of matchIds) {
    const existing = exceptionByMatch.get(matchId);
    if (status === 'Available') {
      if (existing) {
        await availabilityRepository.delete(existing.id);
        updated++;
      }
    } else if (existing) {
      await availabilityRepository.update(existing.id, {
        availabilityStatus: status,
        playerNotes: notes || '',
        updatedBy: playerId,
      });
      updated++;
    } else {
      await availabilityRepository.create({
        match: matchId,
        player: playerId,
        availabilityStatus: status,
        playerNotes: notes || '',
        updatedBy: playerId,
      });
      updated++;
    }
  }

  return { success: true, updated };
}