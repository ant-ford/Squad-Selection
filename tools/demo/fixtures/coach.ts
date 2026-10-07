// Coach view: fixtures, squad selection, ranking, team availability.
import type { GetUpcomingFixturesOutput, UpcomingFixture } from '@/api/getUpcomingFixtures';
import type { GetPlayersForMatchOutput, MatchPlayer } from '@/api/getPlayersForMatch';
import type { GetRecommendationsOutput } from '@/api/getRecommendations';
import type { TeamAttendance, TeamFixture, SquadPlayer } from '@/api/getTeamAttendance';
import type { RankingChange, TeamAvailability } from '@/lib/queries';
import type { InactiveRankingEntry, RankingList } from '@shared/schema/domainTypes';
import type { Routes } from './routing';
import { OTHERS, PERSONAS, SQUAD_PLAYERS, SAT1, SAT2, SAT3, WED, SEASON_SHORT, at, dateOnly, day } from './data';

const ME = PERSONAS.player.id;

function upcoming(team: string | null): GetUpcomingFixturesOutput {
  const f = (o: Partial<UpcomingFixture> & Pick<UpcomingFixture, 'id' | 'date' | 'hkfcTeam' | 'opponent' | 'isHome' | 'division' | 'venue'>): UpcomingFixture => ({
    homeTeam: o.isHome ? o.hkfcTeam : o.opponent,
    awayTeam: o.isHome ? o.opponent : o.hkfcTeam,
    targetSquadSize: 16, selectedCount: 0, maybeCount: 0, unavailableCount: 0, maybeNames: [], unavailableNames: [],
    ...o,
  });
  const list: UpcomingFixture[] = [
    f({ id: 'demoM1-home', date: at(SAT1, 14, 30), hkfcTeam: 'HKFC C', opponent: 'Valley B', isHome: true, division: 'Division 2', venue: 'HKFC',
      selectedCount: 15, selectedPlayers: [{ id: ME, name: 'Sam Carter' }], selectedUnavailableNames: ['Luca Rossi'], hasGoalkeeperSelected: true,
      maybeCount: 2, unavailableCount: 3, maybeNames: ['Noah Singh', 'Harry Lam'], unavailableNames: ['Luca Rossi', 'Felix Moreau', 'Ben Hughes'] }),
    f({ id: 'demoM8-away', date: at(SAT1, 9, 30), hkfcTeam: 'HKFC D', opponent: 'Valley D', isHome: false, division: 'Division 4', venue: 'Happy Valley 1',
      selectedCount: 12, hasGoalkeeperSelected: true, maybeCount: 1, unavailableCount: 2, maybeNames: ['Isaac Ho'], unavailableNames: ['Omar Haddad', 'Leo Barros'] }),
    f({ id: 'demoM7-home', date: at(WED, 20), hkfcTeam: 'HKFC D', opponent: 'Tigers', isHome: true, division: 'Division 4', venue: 'HKFC', maybeCount: 4, unavailableCount: 5 }),
    f({ id: 'demoM2-away', date: at(SAT2, 16), hkfcTeam: 'HKFC C', opponent: 'Kowloon CC A', isHome: false, division: 'Division 2', venue: 'King’s Park',
      selectedCount: 6, hasGoalkeeperSelected: false, maybeCount: 3, unavailableCount: 1, maybeNames: ['Sam Carter', 'Kenji Tanaka', 'Noah Singh'], unavailableNames: ['Priya Nair'] }),
    f({ id: 'demoM3-home', date: at(SAT3, 13), hkfcTeam: 'HKFC C', opponent: 'Dragons', isHome: true, division: 'Division 2', venue: 'HKFC',
      unavailableCount: 2, unavailableNames: ['Sam Carter', 'Ben Hughes'] }),
    f({ id: 'demoPast1-home', date: at(SAT1 - 14, 14), hkfcTeam: 'HKFC C', opponent: 'Punjab B', isHome: true, division: 'Division 2', venue: 'HKFC',
      selectedCount: 16, result: { goalsFor: 3, goalsAgainst: 1, outcome: 'win' } }),
  ];
  return { fixtures: team ? list.filter((x) => x.hkfcTeam === team) : list };
}

const STATUS = ['Available', 'Available', 'Available', 'Available', 'Maybe', 'Available', 'Available', 'Available', 'Unavailable', 'Unavailable',
  'Available', 'Maybe', 'Maybe', 'Unavailable', 'Available', 'Available', 'Available', 'Available', 'Maybe', 'Available', 'Available', 'Unavailable'];
const SELECTED = new Set([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 14]);

function matchPlayers(side: string | null): GetPlayersForMatchOutput {
  const players: MatchPlayer[] = SQUAD_PLAYERS.map((p, i) => ({
    id: p.id, preferredName: p.name, shirtNo: p.shirtNo, mobile: i === 20 ? '' : `+852 5550 ${String(1000 + i).slice(-4)}`,
    registeredTeam: p.team, playingPosition: p.position, playingAbility: p.ability,
    availabilityStatus: STATUS[i], availabilityFromRule: i === 13, optInOnly: i === 21,
    playerNotes: i === 4 ? 'Arriving 10 minutes late from work' : i === 8 ? 'Knee niggle' : '',
    playUpCount: p.team === 'HKFC D' ? [2, 1, 0, 0, 3, 2, 0, 1][i - 14] : 0,
    eligibilityStatus: 'eligible', reason: null, blocks: [], warnings: [], conflicts: [],
    selectedByTeam: null, sameDayHigherTeam: null,
    selectionStatus: SELECTED.has(i) ? 'Selected' : '', selectionId: SELECTED.has(i) ? `demoSel${i}` : '',
    isU21: i === 10 || i === 18, isVisitingPlayer: i === 11,
  }));
  Object.assign(players[16], { eligibilityStatus: 'blocked', reason: 'Suspended: 1 match to serve', blocks: [{ rule: 'suspension', reason: 'Suspended: 1 match to serve' }] });
  Object.assign(players[15], { selectedByTeam: 'HKFC D', conflicts: [{ type: 'same-day', team: 'HKFC D', matchId: 'demoM8' }] });
  players[17].supportUnavailable = ['HKFC D'];
  return {
    match: {
      date: at(SAT1, 14, 30), homeTeam: 'HKFC C', awayTeam: 'Valley B', division: 'Division 2', competitionType: 'League', venue: 'HKFC',
      targetSquadSize: 16, selectedCount: players.filter((p) => p.selectionStatus === 'Selected').length, hkfcTeam: 'HKFC C',
      autoSelectEnabled: false, autoSelectPlayerIds: [], side: side === 'away' ? 'away' : 'home', kit: 'Blue', selectionVersion: 3,
      notice: null, lastSquad: null,
    },
    players,
    recommendationOrder: players.filter((p) => p.eligibilityStatus !== 'blocked').map((p) => p.id),
  };
}

const RANK_NAMES = [...OTHERS.slice(0, 12).map(([n]) => n), ...SQUAD_PLAYERS.map((p) => p.name), ...OTHERS.slice(12).map(([n]) => n)];

function ranking(): RankingList {
  const players = RANK_NAMES.map((name, i) => {
    const squad = SQUAD_PLAYERS.find((p) => p.name === name);
    const other = OTHERS.find(([n]) => n === name);
    return {
      id: squad?.id ?? `demo${name.replace(/\W/g, '')}`,
      preferredName: name,
      registeredTeam: squad?.team ?? other?.[1],
      playingPosition: squad?.position ?? other?.[2],
      sectionRank: i + 1,
      teamRank: (i % 14) + 1,
      positionalRank: (i % 6) + 1,
      active: true,
      status: 'Active',
    };
  });
  Object.assign(players[players.length - 2], {
    status: 'Applicant', applicantStage: '1. Trial Application',
    sportsBackground: 'Played university hockey for three years, then club hockey abroad.',
    selectionComments: 'Strong on the ball. Trialled with the C team twice.',
  });
  return { players, activeCount: players.length, lastUpdated: at(-2, 21), config: { A: 6, B: 6, C: 8, D: 8, E: 6, F: 0, G: 0 }, version: 12 };
}

const INACTIVE: InactiveRankingEntry[] = [
  { id: 'demoRory', preferredName: 'Rory Blake', registeredTeam: 'HKFC C', playingPosition: 'Defender', lastSectionRank: 21, status: 'Inactive' },
];

const CHANGES: RankingChange[] = [
  { id: 'demoCh1', playerId: 'demoP1', kind: 'move', playerName: 'Jamie Wong', actorName: 'Jo Bennett', oldRank: 16, newRank: 14, note: 'Great form, 5 goals in 3 games', at: at(-1, 21) },
  { id: 'demoCh2', playerId: 'demoP9', kind: 'move', playerName: 'Luca Rossi', actorName: 'Jo Bennett', oldRank: 20, newRank: 22, note: '', at: at(-3, 20) },
];

function teamAttendance(): TeamAttendance {
  const offs = [-21, -14, -7, 0, 7, 14];
  const dates = offs.map((o) => day(SAT1 + o));
  const teams = ['HKFC C', 'HKFC D'];
  const fixtures: TeamFixture[] = [];
  for (const team of teams) {
    offs.forEach((o, k) => {
      const past = o < 0;
      fixtures.push({ team, date: dates[k], matchId: `demoTA${team.slice(-1)}${k}`, opponent: ['Tigers', 'Dragons', 'Punjab B', 'Valley B', 'Kowloon CC A', 'Shaheen'][k],
        isHome: k % 2 === 0, past, friendly: false, off: false, selectedCount: past ? 16 : k === 3 ? 15 : 4,
        ...(past ? { cardCount: 15, goalsFor: 2, goalsAgainst: 1 } : {}) });
    });
  }
  const status = (i: number, k: number) => {
    const past = offs[k] < 0;
    if (past) return (i + k) % 7 === 0 ? 'unavailable' : (i + k) % 5 === 0 ? 'not-selected' : 'played';
    return (i * 3 + k) % 11 === 0 ? 'unavailable' : (i + 2 * k) % 9 === 0 ? 'maybe' : k === 3 && i < 13 ? 'selected' : 'available';
  };
  const squads = teams.map((team) => ({
    team,
    targetSquadSize: 16,
    players: SQUAD_PLAYERS.filter((p) => p.team === team).map((p, i): SquadPlayer => ({
      id: p.id, name: p.name, position: p.position,
      cells: Object.fromEntries(offs.map((_, k) => [`demoTA${team.slice(-1)}${k}`, { status: status(i, k) as SquadPlayer['cells'][string]['status'], source: 'answer' as const }])),
    })),
  }));
  return { season: SEASON_SHORT, today: dateOnly(new Date().toISOString()), dates, teams: squads, fixtures };
}

function teamAvailability(matchId: string): TeamAvailability {
  const row = (i: number, status: string) => {
    const p = SQUAD_PLAYERS[i];
    return { id: p.id, name: p.name, shirtNo: p.shirtNo, position: p.position, status };
  };
  return {
    matchId, team: 'HKFC C', targetSquadSize: 16,
    selected: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12].map((i) => row(i, STATUS[i])),
    restOfTeam: [8, 11, 13].map((i) => row(i, STATUS[i])),
    suggestions: [14, 17, 19].map((i) => row(i, 'Available')),
  };
}

const RECOMMENDATIONS: GetRecommendationsOutput = { matchId: 'demoM1', targetPosition: null, recommendations: [] };

export const routes: Routes = {
  'GET /api/upcoming-fixtures': ({ query }) => upcoming(query.get('team')),
  'GET /api/match/:id/players': ({ query }) => matchPlayers(query.get('side')),
  'GET /api/match/:id/recommendations': () => RECOMMENDATIONS,
  'GET /api/match/:id/team-availability': ({ params }) => teamAvailability(params.id),
  'GET /api/match/:id/availability': () => ({ exceptions: [] }),
  'GET /api/team/auto-select-players': () => ({
    players: SQUAD_PLAYERS.slice(0, 4).map((p) => ({ id: p.id, preferredName: p.name, playingPosition: p.position })),
  }),
  'GET /api/ranking': () => ranking(),
  'GET /api/ranking/inactive': () => INACTIVE,
  'GET /api/recent-changes': () => ({ changes: CHANGES }),
  'GET /api/team-attendance': () => teamAttendance(),
};
