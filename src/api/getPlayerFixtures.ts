import { peopleRepository, matchesRepository, availabilityRepository, selectionsRepository } from '@/repositories';

export async function getPlayerFixtures(playerId: string) {
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }

  const teamName = player.registeredTeam || '';

  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .filter(m => (m.homeTeam || '') === teamName || (m.awayTeam || '') === teamName)
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  const matchIds = upcoming.map(m => m.id);

  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return pId === playerId && mId && matchIds.includes(mId);
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  const allSelections = await selectionsRepository.findAll({});
  const playerSelections = allSelections.filter(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === playerId && mId && matchIds.includes(mId);
  });
  const selectionByMatch = new Map(playerSelections.map(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return [mId || '', s];
  }));

  const fixtures = upcoming.map(m => {
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);
    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: m.homeTeam || '',
      awayTeam: m.awayTeam || '',
      venue: m.venue || '',
      division: m.division || '',
      availabilityStatus: exc?.availabilityStatus || 'Available',
      playerNotes: exc?.note || '',
      availabilityExceptionId: exc?.id || '',
      selectionStatus: sel?.selectionStatus || '',
    };
  });

  return {
    playerName: player.preferredName || player.givenNames || 'Player',
    registeredTeam: teamName,
    fixtures,
  };
}

export type GetPlayerFixturesOutput = Awaited<ReturnType<typeof getPlayerFixtures>>;