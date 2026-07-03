import { matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface MyFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  availabilityStatus: string;
  playerNotes: string;
  availabilityExceptionId: string;
  selectionStatus: string;
  selectionNotes: string;
  selectedCount: number;
  targetSquadSize: number;
}
export type GetMyFixturesOutput = Awaited<ReturnType<typeof getMyFixtures>>;

export async function getMyFixtures(): Promise<{
  playerName: string;
  registeredTeam: string;
  playingPosition: string;
  shirtNoValue: string;
  isCoach: boolean;
  fixtures: MyFixture[];
}> {
  const user = await getCurrentPeople();
  const teamName = user.registeredTeam || '';
  const roles = Array.isArray(user.playerCoach) ? user.playerCoach : [];
  const isCoach = roles.includes('Coach');

  // Fetch teams for name→rank mapping
  const ref = await getClubReferenceData();
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));
  const teamNames = new Set(ref.teams.map(t => t.teamName));

  // Fetch matches for this team
  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .filter(m => {
      const home = m.homeTeam || '';
      const away = m.awayTeam || '';
      return home === teamName || away === teamName;
    })
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  if (upcoming.length === 0) {
    return {
      playerName: user.preferredName || user.givenNames || 'Player',
      registeredTeam: teamName,
      playingPosition: user.playingPosition || '',
      shirtNoValue: user.shirtNoValue || '',
      isCoach,
      fixtures: [],
    };
  }

  const matchIds = upcoming.map(m => m.id);

  // Fetch exceptions and selections for these matches
  const allExceptions = await availabilityRepository.findAll({});
  const playerExceptions = allExceptions.filter(e => {
    const pId = Array.isArray(e.player) ? e.player[0] : e.player;
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return pId === user.id && mId && matchIds.includes(mId);
  });
  const exceptionByMatch = new Map(playerExceptions.map(e => {
    const mId = Array.isArray(e.match) ? e.match[0] : e.match;
    return [mId || '', e];
  }));

  const allSelections = await selectionsRepository.findAll({});
  const allMatchSelections = allSelections.filter(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return mId && matchIds.includes(mId);
  });
  const playerSelections = allMatchSelections.filter(s => {
    const pId = Array.isArray(s.player) ? s.player[0] : s.player;
    return pId === user.id;
  });
  const selectionByMatch = new Map(playerSelections.map(s => {
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    return [mId || '', s];
  }));

  // Count selections per match
  const selectedCountByMatch = new Map<string, number>();
  for (const s of allMatchSelections) {
    if (s.selectionStatus !== 'Selected') continue;
    const mId = Array.isArray(s.match) ? s.match[0] : s.match;
    if (mId) selectedCountByMatch.set(mId, (selectedCountByMatch.get(mId) || 0) + 1);
  }

  const fixtures = upcoming.map(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    const isHome = home === teamName;
    const hkfcTeam = teamNames.has(home) ? home : away;
    const opponent = hkfcTeam === home ? away : home;
    const team = teamsByName.get(hkfcTeam);
    const exc = exceptionByMatch.get(m.id);
    const sel = selectionByMatch.get(m.id);

    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: home,
      awayTeam: away,
      hkfcTeam,
      opponent,
      isHome,
      venue: m.venue || '',
      division: m.division || '',
      availabilityStatus: exc?.availabilityStatus || 'Available',
      playerNotes: exc?.note || '',
      availabilityExceptionId: exc?.id || '',
      selectionStatus: sel?.selectionStatus || '',
      selectionNotes: sel?.selectionNotes || '',
      selectedCount: selectedCountByMatch.get(m.id) || 0,
      targetSquadSize: team?.targetSquadSize || 16,
    };
  });

  return {
    playerName: user.preferredName || user.givenNames || 'Player',
    registeredTeam: teamName,
    playingPosition: user.playingPosition || '',
    shirtNoValue: user.shirtNoValue || '',
    isCoach,
    fixtures,
  };
}