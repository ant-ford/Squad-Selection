import { matchesRepository, selectionsRepository, availabilityRepository } from '@/repositories';
import { getCurrentPeople } from '@/lib/auth';
import { getClubReferenceData } from './getClubReferenceData';

export interface UpcomingFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  reserveCount: number;
  availableCount: number;
  maybeCount: number;
  unavailableCount: number;
}
export type GetUpcomingFixturesOutput = Awaited<ReturnType<typeof getUpcomingFixtures>>;

export async function getUpcomingFixtures(teamFilter?: string): Promise<{ fixtures: UpcomingFixture[] }> {
  const user = await getCurrentPeople();
  const ref = await getClubReferenceData();
  const teamsByName = new Map(ref.teams.map(t => [t.teamName, t]));

  // Find user's coached teams
  const userId = user.id;
  const coachedTeams = ref.teams.filter(t =>
    t.coach.includes(userId) || t.teamCaptain.includes(userId) || t.sectionCaptain.includes(userId)
  );
  const coachedTeamNames = new Set(coachedTeams.map(t => t.teamName));

  // Fetch scheduled matches
  const allMatches = await matchesRepository.findAll({
    filterByFormula: '{Match Status}="Scheduled"'
  });
  const now = new Date().toISOString();
  const upcoming = allMatches
    .filter(m => m.matchDate && m.matchDate >= now)
    .sort((a, b) => (a.matchDate || '').localeCompare(b.matchDate || ''));

  const relevant = upcoming.filter(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    if (teamFilter) {
      return home === teamFilter || away === teamFilter;
    }
    return coachedTeamNames.has(home) || coachedTeamNames.has(away);
  });

  if (relevant.length === 0) {
    return { fixtures: [] };
  }

  // Fetch all selections and exceptions for these matches
  const matchIds = relevant.map(m => m.id);
  const allSelections = await selectionsRepository.findAll({});
  const allExceptions = await availabilityRepository.findAll({});

  const selectionsByMatch = new Map<string, any[]>();
  for (const sel of allSelections) {
    const mId = Array.isArray(sel.match) ? sel.match[0] : sel.match;
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = selectionsByMatch.get(mId) || [];
    existing.push(sel);
    selectionsByMatch.set(mId, existing);
  }

  const exceptionsByMatch = new Map<string, any[]>();
  for (const exc of allExceptions) {
    const mId = Array.isArray(exc.match) ? exc.match[0] : exc.match;
    if (!mId || !matchIds.includes(mId)) continue;
    const existing = exceptionsByMatch.get(mId) || [];
    existing.push(exc);
    exceptionsByMatch.set(mId, existing);
  }

  const fixtures = relevant.map(m => {
    const home = m.homeTeam || '';
    const away = m.awayTeam || '';
    const isHome = coachedTeamNames.has(home) || (teamFilter ? home === teamFilter : false);
    const hkfcTeam = isHome ? home : away;
    const opponent = isHome ? away : home;
    const team = teamsByName.get(hkfcTeam);

    const matchSelections = selectionsByMatch.get(m.id) || [];
    const selectedCount = matchSelections.filter(s => s.selectionStatus === 'Selected').length;
    const reserveCount = matchSelections.filter(s => s.selectionStatus === 'Reserve').length;

    const matchExceptions = exceptionsByMatch.get(m.id) || [];
    const unavailableCount = matchExceptions.filter(e => e.availabilityStatus === 'Unavailable').length;
    const maybeCount = matchExceptions.filter(e => e.availabilityStatus === 'Maybe').length;

    return {
      id: m.id,
      date: m.matchDate || '',
      homeTeam: home,
      awayTeam: away,
      hkfcTeam,
      opponent,
      isHome,
      division: m.division || '',
      venue: m.venue || '',
      targetSquadSize: team?.targetSquadSize || 16,
      selectedCount,
      reserveCount,
      availableCount: 0,
      maybeCount,
      unavailableCount,
    };
  });

  return { fixtures };
}