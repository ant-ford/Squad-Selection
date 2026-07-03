import { peopleRepository, teamsRepository, matchesRepository, availabilityRepository, selectionsRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

// Helper to check eligibility and build blocks/warnings
function evaluatePlayerEligibility(
  player: any,
  match: any,
  teamRankMap: Record<string, number>,
  existingSelections: any[],
  playerSelectionsForOtherMatches: any[]
) {
  const blocks: { rule: string; reason: string }[] = [];
  const warnings: { rule: string; reason: string }[] = [];
  const conflicts: { type: string; team: string; matchId: string }[] = [];

  // Suspension
  if (player.isSuspended || (player.matchesToServe && player.matchesToServe > 0)) {
    blocks.push({ rule: 'SUSPENDED', reason: 'Player is suspended' });
  }

  // Higher-to-lower movement (7.2a)
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  const targetTeamRank = teamRankMap[hkfcTeam] || 99;
  const playerTeamRank = teamRankMap[player.registeredTeam || ''] || 99;
  if (playerTeamRank < targetTeamRank) {
    blocks.push({ rule: 'HIGHER_TO_LOWER', reason: 'Higher-to-lower movement blocked (7.2a)' });
  }

  // Visiting player fixed team (6.4)
  if (player.isVisitingPlayer && player.registeredTeam !== hkfcTeam) {
    blocks.push({ rule: 'VISITING_FIXED', reason: 'Visiting player fixed to registered team (6.4)' });
  }

  // Check for duplicate selection in this match
  const alreadySelected = existingSelections.some(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return pId === player.id && mId === match.id;
  });
  if (alreadySelected) {
    blocks.push({ rule: 'DUPLICATE', reason: 'Already selected for this match' });
  }

  // Conflicts: selected/reserve for other matches on same day? We'll keep as warnings.
  // For simplicity, we'll just show if they are selected for another match on same day.
  // (Not implemented fully; can be added later)

  return { blocks, warnings, conflicts };
}

export async function getPlayersForMatch(matchId: string) {
  const user = await getCurrentPeople(); // need coach permissions? We'll check later.
  const ref = await getClubReferenceData();
  const teamRankMap = ref.teamRankMap;
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));

  const match = await matchesRepository.findById(matchId);
  if (!match) throw new Error('Match not found');

  // Determine HKFC team from match
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  const hkfcTeam = teamRankMap[home] !== undefined ? home : away;
  if (!hkfcTeam) throw new Error('Cannot determine HKFC team for this match');

  // Fetch all active players (or those eligible for this team? We'll use all active)
  const allPlayers = await peopleRepository.findAll({
    filterByFormula: '{Active}=TRUE()'
  });

  // Fetch existing selections for this match
  const allSelections = await selectionsRepository.findAll({});
  const matchSelections = allSelections.filter(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return mId === matchId;
  });
  const selectionMap = new Map<string, any>();
  for (const sel of matchSelections) {
    const pId = Array.isArray(sel.player) ? sel.player[0] : sel.player;
    if (pId) selectionMap.set(pId, sel);
  }

  // Fetch availability exceptions for this match
  const allExceptions = await availabilityRepository.findAll({});
  const matchExceptions = allExceptions.filter(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return mId === matchId;
  });
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = Array.isArray(exc.player) ? exc.player[0] : exc.player;
    if (pId) exceptionMap.set(pId, exc);
  }

  // Build player objects with eligibility
  const players = allPlayers.map(p => {
    const sel = selectionMap.get(p.id);
    const exc = exceptionMap.get(p.id);
    const availabilityStatus = exc?.availabilityStatus || 'Available';
    const playerNotes = exc?.note || '';

    // Compute eligibility
    const eligibility = evaluatePlayerEligibility(
      p,
      match,
      teamRankMap,
      matchSelections,
      [] // conflicts not implemented
    );

    // Determine eligibilityStatus
    let eligibilityStatus = 'eligible';
    if (eligibility.blocks.length > 0) eligibilityStatus = 'blocked';
    else if (eligibility.warnings.length > 0) eligibilityStatus = 'warning';

    // Compute play-up count (placeholder)
    const playUpCount = 0; // would require history

    return {
      id: p.id,
      preferredName: p.preferredName || p.givenNames || '',
      registeredTeam: p.registeredTeam || '',
      playingPosition: p.playingPosition || '',
      playingAbility: p.playingAbility || '',
      availabilityStatus,
      playerNotes,
      playUpCount,
      eligibilityStatus,
      blocks: eligibility.blocks,
      warnings: eligibility.warnings,
      conflicts: eligibility.conflicts,
      selectionStatus: sel?.selectionStatus || '',
      selectionId: sel?.id || '',
    };
  });

  // Sort: selected first, then eligible, then blocked
  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    if (a.eligibilityStatus === 'blocked' && b.eligibilityStatus !== 'blocked') return 1;
    if (a.eligibilityStatus !== 'blocked' && b.eligibilityStatus === 'blocked') return -1;
    return 0;
  });

  const matchInfo = {
    date: match.matchDate || '',
    homeTeam: match.homeTeam || '',
    awayTeam: match.awayTeam || '',
    division: match.division || '',
    venue: match.venue || '',
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: matchSelections.filter(s => s.selectionStatus === 'Selected').length,
    reserveCount: matchSelections.filter(s => s.selectionStatus === 'Reserve').length,
  };

  return { match: matchInfo, players };
}

export type GetPlayersForMatchOutput = Awaited<ReturnType<typeof getPlayersForMatch>>;