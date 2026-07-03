import { peopleRepository, teamsRepository, matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export async function selectPlayer(matchId: string, playerId: string, selectionStatus: 'Selected' | 'Reserve') {
  const user = await getCurrentPeople(); // acting coach

  // Revalidate player
  const player = await peopleRepository.findById(playerId);
  if (!player || !player.active) {
    throw new Error('Player not found or inactive');
  }
  if (!player.registeredTeam || !player.playingPosition || !player.playingAbility) {
    throw new Error('Player profile is incomplete');
  }
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    throw new Error('Player is suspended');
  }

  const match = await matchesRepository.findById(matchId);
  if (!match) throw new Error('Match not found');

  // Team rank checks
  const ref = await getClubReferenceData();
  const teamRankMap = ref.teamRankMap;
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] || 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ''] || 99;
  if (playerTeamRank < targetTeamRank) {
    throw new Error('Higher-to-lower movement blocked (7.2a)');
  }
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    throw new Error('Visiting player fixed to registered team (6.4)');
  }

  // Check duplicate
  const allSelections = await selectionsRepository.findAll({});
  const existing = allSelections.find(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === playerId && mId === matchId;
  });
  if (existing) {
    throw new Error('Player already selected for this match');
  }

  // Create selection
  const result = await selectionsRepository.create({
    match: matchId,
    player: playerId,
    selectionStatus,
    selectedBy: user.id,
    selectedAt: new Date().toISOString(),
  });

  return { id: result.id, success: true };
}