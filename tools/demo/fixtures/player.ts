// Player view: profile, fixtures, tasks, availability rules, stats, details.
import type { ProfileData } from '@/api/getMyProfile';
import type { GetMyFixturesOutput, MyFixture, PastFixture } from '@/api/getMyFixtures';
import type { MyTask } from '@/api/getMyTasks';
import type { AvailabilityRule } from '@/api/availabilityRules';
import type { PlayerSeasonStats } from '@/api/getPlayerStats';
import type { AttendanceCell, PlayerAttendance } from '@/api/getPlayerAttendance';
import type { MyDetails } from '@shared/profile';
import type { MySeasonPlan } from '@shared/seasonPlan';
import type { MyVolunteering } from '@shared/volunteering';
import type { Persona } from '../personas.mjs';
import type { Routes } from './routing';
import { umpireNextDuty } from './umpiring';
import {
  PERSONAS, SQUAD_PLAYERS, TEAMS, SEASON, SEASON_SHORT, SAT1, SUN1, WED, SAT2, SAT3, SAT4,
  at, dateOnly, day, firstName, personaTeam, sectionsOf,
} from './data';

const isCaptain = (p: Persona) => p.offices.includes('sectionCaptain');
const isCoach = (p: Persona) => !!p.coachTeams?.length || isCaptain(p);
const coachTeamNames = (p: Persona) => (isCaptain(p) ? TEAMS : p.coachTeams ?? []);

// Flags the app reads on main today and session 6's #276 removes (the menu
// then always offers the quizzes, and My details always shows). Spread in, so
// the fixtures typecheck on either side of that change; drop them after it.
const RETIRING_PROFILE_FLAGS: object = { quizzes: true };
const RETIRING_FIXTURES_FLAGS: object = { eddyProfile: true };

export function profile(p: Persona): ProfileData {
  const officer = p.offices.length > 0;
  return {
    preferredName: firstName(p.name),
    roles: isCoach(p) ? ['Coach'] : ['Player'],
    isCoach: isCoach(p),
    isSectionCaptain: isCaptain(p),
    officerRoles: p.offices.map((office) => ({ office, designation: '' })),
    sections: sectionsOf(p) as ProfileData['sections'],
    quizzes: true,
    applicant: false,
    inviteLink: 'https://app.eddy.global/join?ref=demo',
    seasonPlans: isCoach(p),
    volunteers: isCoach(p) || officer,
    events: isCaptain(p) || !!p.socialSecretaryOf?.length,
    umpiring: p.umpiring ?? (isCaptain(p) ? 'coordinator' : null),
    captainTeams: [],
    coachTeams: coachTeamNames(p).map((teamName) => ({
      id: `demoTeam${teamName.slice(-1)}`,
      teamName,
      teamRank: TEAMS.indexOf(teamName) + 1,
      targetSquadSize: 16,
    })),
  };
}

function fixture(o: Partial<MyFixture> & Pick<MyFixture, 'id' | 'date' | 'hkfcTeam' | 'opponent' | 'isHome' | 'venue' | 'division'>): MyFixture {
  return {
    homeTeam: o.isHome ? o.hkfcTeam : o.opponent,
    awayTeam: o.isHome ? o.opponent : o.hkfcTeam,
    playerNotes: '',
    availabilityExceptionId: '',
    selectionStatus: '',
    selectionNotes: '',
    selectedCount: 0,
    targetSquadSize: 16,
    fixtureCategory: 'own',
    kit: '',
    availabilityStatus: 'Available',
    ...o,
  };
}

const PAST: PastFixture[] = [
  { id: 'demoPast1', date: at(SAT1 - 14, 14), homeTeam: 'HKFC C', awayTeam: 'Punjab B', hkfcTeam: 'HKFC C', opponent: 'Punjab B', isHome: true, venue: 'HKFC', division: 'Division 2',
    goalsFor: 3, goalsAgainst: 1, outcome: 'win', played: true, myGoals: 1, myCards: [],
    scorers: [{ name: 'Sam Carter', goals: 1 }, { name: 'Jamie Wong', goals: 2 }], cards: [{ name: 'Marcus Leung', cards: ['Green'] }] },
  { id: 'demoPast2', date: at(SAT1 - 21, 15), homeTeam: 'Shaheen B', awayTeam: 'HKFC C', hkfcTeam: 'HKFC C', opponent: 'Shaheen B', isHome: false, venue: 'Happy Valley 2', division: 'Division 2',
    goalsFor: 2, goalsAgainst: 2, outcome: 'draw', played: true, myGoals: 0, myCards: ['Green'],
    scorers: [{ name: 'Kenji Tanaka', goals: 1 }, { name: 'Ravi Patel', goals: 1 }], cards: [{ name: 'Sam Carter', cards: ['Green'] }] },
  { id: 'demoPast3', date: at(SAT1 - 28, 13), homeTeam: 'HKFC C', awayTeam: 'Valley C', hkfcTeam: 'HKFC C', opponent: 'Valley C', isHome: true, venue: 'HKFC', division: 'Division 2',
    goalsFor: 0, goalsAgainst: 1, outcome: 'loss', played: false, myGoals: 0, myCards: [], scorers: [], cards: [] },
];

export function myFixtures(p: Persona, past: boolean): GetMyFixturesOutput {
  const team = personaTeam(p);
  return {
    playerId: p.id,
    playerName: firstName(p.name),
    photo: '',
    displayTeam: team,
    registeredTeam: team,
    playingPosition: 'Midfielder',
    shirtNoValue: '14',
    isCoach: isCoach(p),
    coachTeams: coachTeamNames(p),
    captainTeams: [],
    isSectionCaptain: isCaptain(p),
    sections: sectionsOf(p) as GetMyFixturesOutput['sections'],
    seasonPlans: profile(p).seasonPlans,
    volunteers: profile(p).volunteers,
    events: profile(p).events,
    umpiring: profile(p).umpiring,
    duty: p.umpiring === 'umpire' ? umpireNextDuty() : null,
    eddyProfile: true,
    isBirthday: false,
    teamBirthdays: ['Jamie Wong'],
    pastFixtures: past ? PAST : [],
    fixtures: [
      fixture({ id: 'demoM1', date: at(SAT1, 14, 30), hkfcTeam: 'HKFC C', opponent: 'Valley B', isHome: true, venue: 'HKFC', division: 'Division 2',
        selectionStatus: 'Selected', selectedCount: 15, kit: 'Blue', selectionNotes: 'Arrive 45 minutes before push-back.' }),
      fixture({ id: 'demoM2', date: at(SAT2, 16), hkfcTeam: 'HKFC C', opponent: 'Kowloon CC A', isHome: false, venue: 'King’s Park', division: 'Division 2',
        availabilityStatus: 'Maybe', playerNotes: 'Might be travelling', availabilityExceptionId: 'demoEx2' }),
      fixture({ id: 'demoM3', date: at(SAT3, 13), hkfcTeam: 'HKFC C', opponent: 'Dragons', isHome: true, venue: 'HKFC', division: 'Division 2',
        availabilityStatus: 'Unavailable', availabilityFromRule: true }),
      fixture({ id: 'demoM4', date: at(SAT4, 15, 30), hkfcTeam: 'HKFC C', opponent: 'Shaheen', isHome: false, venue: 'Happy Valley 3', division: 'Division 2' }),
    ],
    playUpOpportunities: [
      fixture({ id: 'demoM5', date: at(SUN1, 11), hkfcTeam: 'HKFC B', opponent: 'Khalsa A', isHome: true, venue: 'HKFC', division: 'Division 1',
        fixtureCategory: 'play-up', isPlayUp: true, selectionTeam: 'HKFC B', selectionStatus: 'Selected', selectedCount: 16, kit: 'White' }),
      fixture({ id: 'demoM6', date: at(SAT2, 12), hkfcTeam: 'HKFC B', opponent: 'Punjab', isHome: false, venue: 'King’s Park', division: 'Division 1',
        fixtureCategory: 'play-up', isPlayUp: true, selectionTeam: 'HKFC B' }),
    ],
    supportFixtures: [
      fixture({ id: 'demoM7', date: at(WED, 20), hkfcTeam: 'HKFC D', opponent: 'Tigers', isHome: true, venue: 'HKFC', division: 'Division 4',
        fixtureCategory: 'support', availabilityStatus: 'Maybe', availabilityFromRule: true }),
      fixture({ id: 'demoM8', date: at(SAT1, 9, 30), hkfcTeam: 'HKFC D', opponent: 'Valley D', isHome: false, venue: 'Happy Valley 1', division: 'Division 4',
        fixtureCategory: 'support', selectedCount: 12 }),
    ],
  };
}

function tasks(p: Persona): MyTask[] {
  const out: MyTask[] = [{ id: 'demoTask1', key: 'details', url: '/my-details' }];
  if (p.offices.includes('membershipOfficer')) out.push({ id: 'demoTask2', key: 'accept', subject: 'Lucas Moreau', role: 'Membership Officer', url: '/membership' });
  if (p.umpiring) out.push({ id: 'demoTask3', key: 'duty', url: '/umpiring' });
  return out;
}

const RULES: AvailabilityRule[] = [
  { id: 'demoRule1', ruleType: 'Date range', availability: 'Unavailable', active: true, startDate: day(SAT3 - 2), endDate: day(SAT3 + 2), notes: 'Family holiday', lastModified: at(-3, 10) },
  { id: 'demoRule2', ruleType: 'Midweek', availability: 'Maybe', active: true, startDate: '', endDate: '', notes: '', lastModified: at(-10, 10) },
];

function stats(id: string): PlayerSeasonStats {
  const pl = SQUAD_PLAYERS.find((x) => x.id === id) ?? SQUAD_PLAYERS[0];
  return {
    season: SEASON_SHORT, team: pl.team, playerName: pl.name,
    gamesPlayed: 7, gamesPlayedForTeam: 6, gamesAvailableNotSelected: 1, gamesNoShow: 0, gamesUnavailable: 1, teamGames: 8,
    participationPct: 88, availabilityPct: 88, goals: 4, cardPoints: 1,
    recentGames: [
      { matchId: 'demoPast1', date: at(SAT1 - 14, 14), team: 'HKFC C', opponent: 'Punjab B', isHome: true, goalsFor: 3, goalsAgainst: 1, outcome: 'win', goals: 1, cards: [], cardPoints: 0 },
      { matchId: 'demoPast2', date: at(SAT1 - 21, 15), team: 'HKFC C', opponent: 'Shaheen B', isHome: false, goalsFor: 2, goalsAgainst: 2, outcome: 'draw', goals: 0, cards: ['Green'], cardPoints: 1 },
      { matchId: 'demoPast4', date: at(SAT1 - 35, 14), team: 'HKFC B', opponent: 'Khalsa A', isHome: false, goalsFor: 4, goalsAgainst: 0, outcome: 'win', goals: 2, cards: [], cardPoints: 0 },
      { matchId: 'demoPast5', date: at(SAT1 - 42, 14), team: 'HKFC C', opponent: 'Dragons', isHome: true, goalsFor: 2, goalsAgainst: 1, outcome: 'win', goals: 1, cards: [], cardPoints: 0 },
    ],
  };
}

function attendance(id: string): PlayerAttendance {
  const pl = SQUAD_PLAYERS.find((x) => x.id === id) ?? SQUAD_PLAYERS[0];
  const teams = ['HKFC B', 'HKFC C', 'HKFC D'];
  const offs = [-42, -35, -28, -21, -14, -7, 0, 7, 14, 21];
  const opp = ['Tigers', 'Dragons', 'Khalsa A', 'Valley C', 'Shaheen B', 'Punjab B', 'Valley B', 'Kowloon CC A', 'Dragons', 'Shaheen'];
  const dates = offs.map((o) => day(SAT1 + o));
  const cells: AttendanceCell[] = [];
  offs.forEach((o, k) => {
    const past = o < 0;
    for (const team of teams) {
      let status: AttendanceCell['status'];
      if (team === 'HKFC C') status = past ? (k === 3 ? 'unavailable' : 'played') : k === 6 ? 'selected' : k === 7 ? 'maybe' : k === 8 ? 'unavailable' : 'available';
      else if (team === 'HKFC B') status = k === 2 ? 'played' : past ? 'not-selected' : 'available';
      else status = k === 2 ? 'elsewhere' : past ? 'not-selected' : 'available';
      cells.push({
        team, date: dates[k], matchId: `demoA${k}${team.slice(-1)}`, opponent: opp[k], isHome: k % 2 === 0, past, friendly: false, status,
        availability: status === 'unavailable' ? 'Unavailable' : status === 'maybe' ? 'Maybe' : 'Available',
        source: k === 8 ? 'rule' : 'answer', elsewhereTeam: status === 'elsewhere' ? 'HKFC B' : undefined,
        goalsFor: past ? 2 : undefined, goalsAgainst: past ? 1 : undefined, goals: status === 'played' && k % 2 ? 1 : 0,
      });
    }
  });
  return { season: SEASON_SHORT, team: pl.team, today: dateOnly(new Date().toISOString()), teams, dates, cells, playerName: pl.name };
}

function details(p: Persona): MyDetails {
  const [given, surname] = p.name.split(' ');
  return {
    season: SEASON, applicant: false, trialist: false, audience: 'member', underEighteen: false, email: `${given.toLowerCase()}@example.com`,
    values: { preferredName: given, surname, givenNames: given, mobileNo: '+852 5550 1001', active: true, playingPosition: 'Midfielder' },
    membership: { memberType: 'Full', categoryType: 'Sports Preferred', playerCoach: ['Player'], membershipNo: 'M1234', joinDate: '2019-09-01', commitmentEndDate: null },
    photoUrl: null, hasHkidCopy: true, hasPassportCopy: false, idHidden: false,
    kit: { supplier: 'Kukri', sizes: { shirt: 'L', shorts: 'M', socks: 'Large', goalieSmock: null, goalieSmockStyle: null }, printedShirt: { shirtNo: 14, size: 'L' }, goalkeeper: false },
    checkedAt: null,
  };
}

const SEASON_PLAN: MySeasonPlan = {
  season: SEASON,
  plan: { availabilityLevel: 'most', availabilityHalf: null, playingPreference: 'Play in the highest team I am selected for, including a development‑focused team.', captaincyInterest: 'Maybe', submittedAt: at(-17, 10) },
};

const VOLUNTEERING: MyVolunteering = {
  roles: { hockeyCommittee: [], mensSubCommittee: [], teamRoles: ['Team social secretary'], touringCommittee: [], juniorHockey: [], easter5s: [] },
  nothingForNow: false, qualifiedCoach: null, qualifiedUmpire: null, updatedAt: at(-20, 10),
};

export const routes: Routes = {
  'GET /api/my-profile': ({ persona }) => profile(persona),
  'GET /api/my-fixtures': ({ persona, query }) => myFixtures(persona, query.get('past') === '1'),
  'GET /api/my-tasks': ({ persona }) => ({ tasks: tasks(persona) }),
  'GET /api/my-availability-rules': () => ({ rules: RULES }),
  'GET /api/player-stats/:id': ({ params }) => stats(params.id),
  'GET /api/player-attendance/:id': ({ params }) => attendance(params.id),
  'GET /api/calendar/link': () => ({ url: 'https://api.example.com/calendar/demo.ics' }),
  'GET /api/calendar/team-link': () => ({ url: 'https://api.example.com/calendar/demo-team.ics' }),
  'GET /api/details/me': ({ persona }) => details(persona),
  'GET /api/season-plan/me': () => SEASON_PLAN,
  'GET /api/volunteering/me': () => VOLUNTEERING,
  'POST /api/set-my-availability': () => ({ success: true, exceptionId: 'demoExNew' }),
  'POST /api/set-my-availability-for-date': () => ({ success: true, updated: 2, results: [] }),
  'POST /api/my-availability-rules': ({ body }) => ({ ...RULES[0], ...body, id: 'demoRuleNew' }),
  'POST /api/my-availability-rules/:id': () => ({ success: true }),
  'POST /api/client-error': () => ({ ok: true }),
};

export { PERSONAS };
