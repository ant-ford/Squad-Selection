// Officers' screens: Membership (board, statements, insights), Email lists,
// Season plans, Trial sessions, Volunteers and System. Fictional people only.
import type { ApplicantCard, Chase, MembershipBoard, MembershipInsightsData, StatementBoard, StatementCard } from '@/api/membership';
import type { ChairmanDirectory } from '@/api/chairman';
import type { TrialSession } from '@shared/trials';
import type { DirectoryPerson } from '@shared/emailLists';
import type { InsightFact, TeamSquad } from '@shared/membershipInsights';
import { APPROVABLE_STAGE, PARKED_STAGES, PIPELINE_STAGES, SUBMITTED_STAGES, columnFor, waitingOn } from '@shared/membershipStages';
import { REVIEW_STAGES, reviewColumnFor, reviewWaitingOn } from '@shared/statementStages';
import { PLAYING_PREFERENCES, type SeasonPlanAnswers, type SeasonPlanBoard, type SeasonPlanPlayer } from '@shared/seasonPlan';
import { EMPTY_ROLES, type Volunteer, type VolunteerRoles, type VolunteersBoard } from '@shared/volunteering';
import type { MessageTemplate } from '@/api/messages';
import { reply, type Routes } from './routing';
import { OTHERS, PERSONAS, SAT2, SEASON, SQUAD_PLAYERS, TEAMS, at, day, firstName, type Persona } from './data';

const mobile = (n: number) => `+852 5550 ${String(2000 + n).padStart(4, '0')}`;
const email = (name: string) => `${name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.')}@example.com`;
const surnameOf = (name: string) => name.split(' ').slice(1).join(' ');
const isCaptain = (p: Persona) => p.offices.includes('sectionCaptain');
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Everyone in the section: the HKFC C and D squads, the rest, and the personas in neither. */
const SECTION: { id: string; name: string; team: string; position: string }[] = [
  ...SQUAD_PLAYERS.map((p) => ({ id: p.id, name: p.name, team: p.team, position: p.position })),
  ...OTHERS.map(([name, team, position]) => ({ id: `demo${name.replace(/\W/g, '')}`, name, team, position })),
  ...Object.values(PERSONAS)
    .filter((p) => !SQUAD_PLAYERS.some((s) => s.name === p.name) && !OTHERS.some(([n]) => n === p.name))
    .map((p, i) => ({ id: p.id, name: p.name, team: ['HKFC E', 'HKFC F', 'HKFC G', 'HKFC H'][i % 4], position: 'Midfielder' })),
];
const member = (name: string) => SECTION.find((p) => p.name === name)!;

// ── Membership: the New Joiner board ────────────────────────────────────

const chase = (role: Chase['role'], name: string, n: number): Chase => ({ role, name, firstName: firstName(name), mobile: mobile(n) });
/** Who each stage waits on (worker/src/membership.ts CHASE_BY_STAGE); the sponsor is the card's own. */
const chaseFor = (stage: string, sponsor: string | undefined, n: number): Chase | undefined =>
  stage === '3. Club Application (Signed)' && sponsor ? chase('Sponsor', sponsor, n)
  : stage === '4. Sponsor (Signed)' ? chase('Chairman', 'Henry Yip', 42)
  : stage === '5. Chairman (Signed)' ? chase('Membership Officer', PERSONAS['membership-officer'].name, 43)
  : undefined;

type Applicant = [name: string, stage: string, applied: number, inStage: number, team: string, position: string, type: string, category: string, sponsor?: string];

/** Name, stage, days since applying, days in stage, team, position, applicant type, category, sponsor. */
const APPLICANTS: Applicant[] = [
  ['Callum Reid', '1. Trial Application', 3, 3, '', 'Defender', 'New HKFC Member', 'Sports Preferred'],
  ['Mateo Silva', '1. Trial Application', 9, 9, '', 'Forward', 'New HKFC Member', 'Junior (21-27)'],
  ['Kai Yamamoto', '1. Trial Application', 19, 19, '', 'Goalkeeper', 'New HKFC Member', 'Sports Preferred'],
  ['Hugo Laurent', '2. Section Captain Invitation', 24, 6, 'HKFC D', 'Midfielder', 'New HKFC Member', 'Sports Preferred', 'Daniel Price'],
  ['Nikhil Rao', '2. Section Captain Invitation', 31, 16, 'HKFC E', 'Defender', 'Existing HKFC Member', 'Sports Debenture', 'Chris Tam'],
  ['Ewan Murray', '3. Club Application (Signed)', 28, 4, 'HKFC C', 'Forward', 'New HKFC Member', 'Junior (21-27)', 'Will Ashford'],
  ['Brandon Lau', '3. Club Application (Signed)', 45, 21, 'HKFC F', 'Midfielder', 'New HKFC Member', 'Sports Preferred', 'Will Ashford'],
  ['Tobias Weber', '4. Sponsor (Signed)', 52, 11, 'HKFC B', 'Defender', 'New HKFC Member', 'Sports Preferred', 'Rohan Kapoor'],
  ['Sebastian Cruz', '5. Chairman (Signed)', 60, 33, 'HKFC D', 'Forward', 'New HKFC Member', 'Junior (21-27)', 'Jo Bennett'],
  ['Owen Pritchard', APPROVABLE_STAGE, 66, 2, 'HKFC C', 'Midfielder', 'New HKFC Member', 'Sports Preferred', 'Jo Bennett'],
  ['Ali Rahman', APPROVABLE_STAGE, 71, 8, 'HKFC E', 'Goalkeeper', 'Existing HKFC Member', 'Sports Subscriber', 'Chris Tam'],
  ['Vikram Joshi', 'Accepted', 95, 20, 'HKFC D', 'Defender', 'New HKFC Member', 'Sports Preferred', 'Jo Bennett'],
  ['Desmond Chow', 'Accepted', 140, 61, 'HKFC B', 'Midfielder', 'New HKFC Member', 'Junior (21-27)', 'Rohan Kapoor'],
  ['Lars Nilsson', 'Accepted', 210, 150, 'HKFC A', 'Forward', 'Existing HKFC Member', 'Sports Debenture', 'Alex Morgan'],
  ['Rafael Ortiz', 'Temporary', 40, 40, 'HKFC E', 'Midfielder', 'New HKFC Member', 'Sports Subscriber'],
  ['Jonas Becker', 'Temporary', 75, 75, 'HKFC F', 'Defender', 'New HKFC Member', 'Sports Subscriber'],
  ['Marco Ricci', 'Rejected', 120, 98, '', 'Forward', 'New HKFC Member', 'Sports Preferred'],
];

const BACKGROUNDS = [
  'Played club hockey in Edinburgh for six years, mostly in midfield.',
  'University first team, then a few seasons of indoor hockey.',
  'Schoolboy hockey, back playing after a break of a few years.',
  'Played in the Dutch third division before moving to Hong Kong.',
];

function applicantCard([name, stage, applied, inStage, team, position, applicantType, categoryType, sponsor]: Applicant, i: number): ApplicantCard {
  const [givenNames, surname] = name.split(' ');
  const accepted = stage === 'Accepted';
  return {
    id: `demoApp${i + 1}`,
    name,
    surname,
    givenNames,
    stage,
    column: columnFor(stage),
    status: accepted ? 'Member' : stage === 'Temporary' || stage === 'Rejected' ? stage : 'Applicant',
    membershipNo: accepted || applicantType === 'Existing HKFC Member' ? `F0${640 + i * 7}` : undefined,
    joinDate: accepted ? day(-inStage) : undefined,
    commitmentEndDate: accepted ? day(3 * 365 - inStage) : undefined,
    appliedOn: day(-applied),
    stageSince: day(-inStage),
    days: inStage,
    waitingOn: waitingOn(stage, sponsor),
    canApprove: stage === APPROVABLE_STAGE,
    mobileNo: mobile(100 + i),
    applicantType,
    categoryType,
    gender: 'Male',
    playingPosition: position,
    team: team || undefined,
    sponsor,
    sportsBackground: BACKGROUNDS[i % BACKGROUNDS.length],
    personalInterest: i % 3 === 0 ? 'Keen to help with junior coaching on Saturdays.' : undefined,
    tourInterest: i % 2 === 0 ? ['Easter 5s'] : [],
    qualifiedUmpire: i === 4 ? 'Level 1' : undefined,
    qualifiedCoach: i === 7 ? 'Level 2' : undefined,
    playingLevel: [i % 2 ? 'Club' : 'University'],
    selectionComments: stage.startsWith('1.') ? undefined : 'Trialled with the C team. Good first touch, reads the game well.',
    applicationForm: SUBMITTED_STAGES.includes(stage) ? [{ url: 'https://files.example.com/demo-application.pdf', filename: `${surname}-application.pdf` }] : [],
    chase: chaseFor(stage, sponsor, 40 + i),
    turns28On: stage === APPROVABLE_STAGE ? day(365 * (2 + (i % 4))) : undefined,
  };
}

const CARDS = APPLICANTS.map(applicantCard);

const membershipBoard = (): MembershipBoard => ({
  columns: { pipeline: [...PIPELINE_STAGES], parked: [...PARKED_STAGES] },
  cards: CARDS,
  hasStageDates: true,
  generatedAt: hoursAgo(1),
});

// ── Membership: Statements (yearly commitment reviews) ─────────────────

type Review = [name: string, stage: string, endsIn: number, inStage: number | null, yearNo: number, sponsor: string];
const REVIEWS: Review[] = [
  ['Ravi Patel', 'Not Started', 95, null, 1, 'Jo Bennett'],
  ['Kenji Tanaka', 'Not Started', 75, null, 2, 'Jo Bennett'],
  ['Victor Kwok', 'Not Started', 120, null, 1, 'Rohan Kapoor'],
  ['Oliver Grant', 'Notified Member', 40, 12, 2, 'Jo Bennett'],
  ['Aiden Choi', 'Notified Member', 25, 33, 1, 'Chris Tam'],
  ['Marcus Leung', 'Member Submitted (with Sponsor)', 30, 5, 3, 'Jo Bennett'],
  ['Lewis Mak', 'Member Submitted (with Sponsor)', 18, 17, 1, 'Will Ashford'],
  ['Jonah Fung', 'Sponsor Submitted (with Membership Officer)', 22, 3, 2, 'Rohan Kapoor'],
  ['Priya Nair', 'Complete', 10, 6, 1, 'Jo Bennett'],
];

function statementCard([name, stage, endsIn, inStage, yearNo, sponsor]: Review, i: number): StatementCard {
  const p = member(name);
  const submitted = stage !== 'Not Started' && stage !== 'Notified Member';
  const sponsorDone = stage.startsWith('Sponsor') || stage === 'Complete';
  return {
    id: `demoRev${i + 1}`,
    personId: p.id,
    name,
    mobileNo: mobile(200 + i),
    membershipNo: `F0${500 + i * 9}`,
    yearNo,
    periodStart: day(endsIn - 365),
    periodEnd: day(endsIn),
    joinDate: day(endsIn - 365 * yearNo),
    commitmentEndDate: day(endsIn + 365 * (3 - yearNo)),
    stage,
    column: reviewColumnFor(stage),
    team: p.team,
    sponsor,
    waitingOn: reviewWaitingOn(stage, sponsor),
    stageSince: inStage === null ? undefined : day(-inStage),
    days: inStage,
    autoNoticeOn: day(endsIn - 60),
    inAutoWindow: endsIn <= 60,
    notifyRequested: i === 2,
    canNotify: stage === 'Not Started' && i !== 2,
    matchesPlayed: submitted ? 14 + i : undefined,
    matchesAvailable: submitted ? 18 + i : undefined,
    matchesNotAvailable: submitted ? 3 : undefined,
    matchesTeamPlayed: submitted ? 22 : undefined,
    teamsPlayed: submitted ? [p.team] : [],
    practices: submitted ? 'Most weeks' : undefined,
    socialFunctions: submitted ? ['Season launch', 'Christmas drinks'] : [],
    gamesUmpired: submitted ? String(2 + (i % 4)) : undefined,
    otherContributions: submitted && i % 2 ? 'Helped run the junior Saturday sessions.' : undefined,
    sponsorRecommendation: sponsorDone ? 'Meets the commitment' : undefined,
    memberSubmittedOn: submitted ? day(-(inStage ?? 0) - 4) : undefined,
    sponsorSubmittedOn: sponsorDone ? day(-(inStage ?? 0)) : undefined,
    officerSubmittedOn: stage === 'Complete' ? day(-(inStage ?? 0)) : undefined,
    playerStatement: submitted ? [{ url: 'https://files.example.com/demo-statement.pdf', filename: `${surnameOf(name)}-statement.pdf` }] : [],
    chase: stage === 'Member Submitted (with Sponsor)' ? chase('Sponsor', sponsor, 60 + i) : undefined,
  };
}

const statementBoard = (): StatementBoard => ({
  columns: [...REVIEW_STAGES],
  cards: REVIEWS.map(statementCard),
  unlinked: 0,
  hasStageDates: true,
  generatedAt: hoursAgo(1),
});

// ── Membership: Insights ────────────────────────────────────────────────

/** This board's applicants, plus the joiners and rejections of the last two seasons. */
function insights(): MembershipInsightsData {
  const PAST_NAMES = ['Adrian Holm', 'Bruno Costa', 'Cyrus Lo', 'Dev Malhotra', 'Elliot Shaw', 'Frank Ito', 'Gavin Tse', 'Ivan Petrov',
    'Jake Morris', 'Kofi Mensah', 'Liam Doyle', 'Mohan Iyer', 'Nate Yuen', 'Oscar Lind', 'Paolo Greco', 'Quentin Roy', 'Reece Tong',
    'Simon Kerr', 'Theo Wright', 'Umar Siddiqui', 'Vince Ma', 'Zac Allen'];
  const past: InsightFact[] = PAST_NAMES.map((name, i) => {
    const appliedAgo = 60 + i * 28;
    const stage = i % 7 === 3 ? 'Rejected' : 'Accepted';
    const joined = stage === 'Accepted' ? day(-appliedAgo + 35 + (i % 5) * 9) : undefined;
    return {
      name,
      stage,
      column: columnFor(stage),
      appliedOn: day(-appliedAgo),
      joinDate: joined,
      stageSince: joined ?? day(-appliedAgo + 20),
      days: null,
      team: TEAMS[i % 6],
      playingPosition: ['Defender', 'Midfielder', 'Forward', 'Goalkeeper'][i % 4],
      applicantType: i % 5 === 0 ? 'Existing HKFC Member' : 'New HKFC Member',
      categoryType: i % 3 === 0 ? 'Junior (21-27)' : 'Sports Preferred',
      gender: 'Male',
      sponsor: ['Jo Bennett', 'Rohan Kapoor', 'Chris Tam', 'Will Ashford'][i % 4],
    };
  });
  const current: InsightFact[] = CARDS.map((c) => ({
    name: c.name, stage: c.stage, column: c.column, appliedOn: c.appliedOn, joinDate: c.joinDate, stageSince: c.stageSince,
    days: c.days, team: c.team, playingPosition: c.playingPosition, applicantType: c.applicantType, categoryType: c.categoryType,
    gender: c.gender, sponsor: c.sponsor,
  }));
  const teams: TeamSquad[] = TEAMS.map((team, i) => {
    const byPosition = { Goalkeeper: i === 6 ? 1 : 2, Defender: 6 - (i % 3), Midfielder: 6 + (i % 2), Forward: 5 - (i % 2) };
    return { team, teamRank: i + 1, targetSquadSize: 16, active: Object.values(byPosition).reduce((a, b) => a + b, 0), byPosition };
  });
  return { facts: [...past, ...current], teams, hasStageDates: true, generatedAt: hoursAgo(1) };
}

// ── Email lists (the chairman's directory) ──────────────────────────────

const AGE_BANDS = ['21-25', '26-30', '31-35', '36-40', '41-45', '26-30', '31-35', '46-50'];
const CATEGORIES = ['Sports Preferred', 'Sports Preferred', 'Junior (21-27)', 'Sports Debenture', 'Sports Subscriber'];

function directory(): ChairmanDirectory {
  const people: DirectoryPerson[] = SECTION.map((p, i) => {
    const under18 = i === 13 || i === 19;
    const coach = p.name === PERSONAS.coach.name || i % 9 === 4;
    const values: Record<string, string[]> = {
      status: ['Member'],
      active: [i % 11 === 10 ? 'Not an active player' : 'Active player'],
      team: [p.team],
      memberType: [under18 ? 'Child' : i % 10 === 7 ? 'Spouse' : 'Main'],
      category: [under18 ? 'Junior (under 21)' : CATEGORIES[i % CATEGORIES.length]],
      playerCoach: coach ? ['Player', 'Coach'] : ['Player'],
      ageBand: [under18 ? '16-20' : AGE_BANDS[i % AGE_BANDS.length]],
      captaincyInterest: [['Yes', 'Maybe', 'No', 'No'][i % 4]],
    };
    if (i % 6 === 1) values.tourInterest = ['Easter 5s', 'Autumn tour'];
    if (i % 5 === 2) values.generalVolunteers = ['Matchday bar', 'Pitch setup'];
    if (i % 8 === 3) values.juniorVolunteers = ['Sat Coaching 9:15-12:15pm (Sep-May)'];
    if (i % 7 === 0) values.subCommittee = ['Social & Events'];
    if (i % 12 === 5) values.qualifiedUmpire = ['Level 1'];
    if (coach) values.qualifiedCoach = ['Level 2'];
    // One member with no address on file, so the "no email" note shows.
    const own = i === 25 ? [] : [email(p.name)];
    const guardian = under18 ? [`parent.${surnameOf(p.name).toLowerCase()}@example.com`] : [];
    return {
      id: p.id,
      name: p.name,
      surname: surnameOf(p.name),
      membershipNo: `F0${400 + i * 3}`,
      values,
      emails: [...own, ...guardian],
      emailSource: own.length && guardian.length ? 'own-and-guardian' : own.length ? 'own' : 'none',
      mobile: mobile(i),
      firstName: firstName(p.name),
      under18,
    };
  });
  const applicants: DirectoryPerson[] = CARDS.filter((c) => c.status === 'Applicant' || c.status === 'Temporary').map((c, i) => ({
    id: c.id,
    name: c.name,
    surname: c.surname,
    values: {
      status: [c.status],
      active: ['Active player'],
      ...(c.team ? { team: [c.team] } : {}),
      category: [c.categoryType ?? 'Sports Preferred'],
      playerCoach: ['Player'],
      ageBand: [AGE_BANDS[(i + 2) % AGE_BANDS.length]],
    },
    emails: [email(c.name)],
    emailSource: 'own',
    mobile: c.mobileNo,
    firstName: c.givenNames,
    under18: false,
  }));
  return { people: [...people, ...applicants], generatedAt: hoursAgo(1) };
}

// ── Season plans ────────────────────────────────────────────────────────

const [HIGHEST, NEXT_DOWN] = PLAYING_PREFERENCES.map((p) => p.value);
const LEVELS = ['all', 'all', 'most', 'all', 'most', 'some', 'all', 'most', 'none'] as const;
const CAPTAINCY = ['No', 'Maybe', 'No', 'Yes', 'No', 'No'] as const;
function plan(i: number): SeasonPlanAnswers | null {
  if (i % 7 === 5) return null;
  const level = LEVELS[i % LEVELS.length];
  return {
    availabilityLevel: level,
    availabilityHalf: level === 'some' ? (i % 2 ? 'first' : 'second') : null,
    playingPreference: level === 'none' ? null : i % 5 === 3 ? NEXT_DOWN : HIGHEST,
    captaincyInterest: CAPTAINCY[i % CAPTAINCY.length],
  };
}

/** Every team for a Section Captain, a coach's own (worker/src/seasonPlan.ts getSeasonPlanBoard). */
function seasonPlanBoard(persona: Persona) {
  const teams = isCaptain(persona) ? 'all' : persona.coachTeams ?? [];
  if (teams !== 'all' && teams.length === 0) return reply(403, { error: 'COACH_ACCESS_REQUIRED', message: 'Coach or Section Captain access required.' });
  const grouped = new Map<string, SeasonPlanPlayer[]>();
  SECTION.forEach((p, i) => {
    if (teams !== 'all' && !teams.includes(p.team)) return;
    const status = p.name === 'Wesley Tsang' ? 'Temporary' : 'Member';
    grouped.set(p.team, [...(grouped.get(p.team) ?? []), { id: p.id, name: p.name, status, playingPosition: p.position, plan: plan(i) }]);
  });
  const board: SeasonPlanBoard = {
    season: SEASON,
    teams: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, players]) => ({ team, players: players.sort((a, b) => a.name.localeCompare(b.name)) })),
  };
  return board;
}

// ── Trial sessions (from a month back, as the Worker lists them) ───────

const TRIALS: (TrialSession & { count: number })[] = [
  { id: 'demoTrial1', startsAt: at(-12, 19, 30), place: 'HKFC main pitch', notes: 'Bring a stick if you have one; spares at the clubhouse.', count: 9 },
  { id: 'demoTrial2', startsAt: at(2, 19, 30), place: 'HKFC main pitch', notes: null, count: 6 },
  { id: 'demoTrial3', startsAt: at(SAT2, 10), place: 'Happy Valley pitch 2', notes: 'Saturday morning, with the D team', count: 4 },
  { id: 'demoTrial4', startsAt: at(16, 19, 30), place: 'HKFC main pitch', notes: null, count: 1 },
];

// ── Volunteers ──────────────────────────────────────────────────────────

type Offer = [name: string, roles: Partial<VolunteerRoles>, coach?: string, umpire?: string];
const OFFERS: Offer[] = [
  ['Sam Carter', { teamRoles: ['Balls & Masks'], easter5s: ['Pitch Setup'] }],
  ['Jamie Wong', { mensSubCommittee: ['Social & Events'], teamRoles: ['Social Secretary & Media'] }],
  ['Priya Nair', { juniorHockey: ['Sat Coaching 9:15-12:15pm (Sep-May)'] }, 'Level 1'],
  ['Tom Fletcher', { juniorHockey: ['Sat Goalkeeper Coaching (Sep-May)'] }, 'Level 2'],
  ['Marcus Leung', { touringCommittee: ['Tour Logistics', 'Hotel Bookings'] }],
  ['Ravi Patel', {}, undefined, 'Level 2'],
  ['Kenji Tanaka', { easter5s: ['Fixtures', 'Umpiring'] }, undefined, 'Level 1'],
  ['Arjun Mehta', { juniorHockey: ['Tue Coaching 4:30-6pm (Sep-May)', 'Junior Hockey League (JHL)'] }, 'Level 1'],
  ['Leo Barros', { teamRoles: ['Balls & Masks'] }],
  ['Isaac Ho', { hockeyCommittee: ['Social Media'], easter5s: ['Media & Comms'] }],
  ['Daniel Price', { mensSubCommittee: ['Membership Officer'] }],
  ['Chris Tam', { mensSubCommittee: ['Convenor'], hockeyCommittee: ['Treasurer'] }, undefined, 'Level 3'],
  ['Will Ashford', { teamRoles: ['Social Secretary & Media'], touringCommittee: ['Costume Ordering'] }],
  ['Henry Yip', { hockeyCommittee: ['Chairman'], touringCommittee: ['Head of Tours'] }],
  ['George Lee', { easter5s: ['Tournament Director', 'Logistics'] }],
  ['Victor Kwok', { mensSubCommittee: ['Pre-Season Friendlies Rep'] }, 'Level 3'],
  ['Patrick Ng', { juniorHockey: ['Fri Youth Coaching 5:30-7:30pm (Sep-May)'] }, 'Level 2'],
  ['Karan Shah', { hockeyCommittee: ['Sponsorship'], easter5s: ['Team Liaison', 'F&B'] }],
  ['Lewis Mak', { touringCommittee: ['Tournament Admin'] }],
  ['Pete Summers', { mensSubCommittee: ['Kit Convenor'] }],
  ['Jo Bennett', { mensSubCommittee: ['Captain/Vice Captain'] }, 'Level 3', 'Level 1'],
  ['Graham Holt', {}, undefined, 'FIH International Panel'],
  ['Felix Moreau', { easter5s: ['Pitch Setup'] }],
];

function volunteers(): VolunteersBoard {
  const list: Volunteer[] = OFFERS.map(([name, roles, coach, umpire], i) => {
    const p = member(name);
    return {
      id: p.id,
      name,
      team: p.team,
      status: 'Member',
      // Two who don't play any more: shown with "Include players who aren't Active".
      active: name !== 'Graham Holt' && name !== 'Henry Yip',
      email: email(name),
      roles: { ...EMPTY_ROLES, ...roles },
      qualifiedCoach: coach ?? null,
      qualifiedUmpire: umpire ?? null,
      updatedAt: i % 4 === 3 ? null : at(-(3 + i * 4), 20),
    };
  });
  return { volunteers: list };
}

// ── System ──────────────────────────────────────────────────────────────

/**
 * GET /api/system. SystemView (src/pages/System.tsx, mirroring
 * worker/src/systemHealth.ts) isn't exported, so the shape is spelled out here.
 */
interface SystemView {
  ok: boolean;
  checks: { key: string; label: string; ok: boolean; note?: string }[];
  jobs: { job: string; ran_at: string; ok: boolean; last_ok_at: string | null }[];
  errors: { at: string; source: string; route: string | null; status: number | null; message: string | null; request_id: string | null }[];
  serverErrors24h: number;
  clientErrors24h: number;
}

function system(): SystemView {
  const job = (name: string, h: number) => ({ job: name, ran_at: hoursAgo(h), ok: true, last_ok_at: hoursAgo(h) });
  const err = (h: number, source: string, route: string, status: number | null, message: string) => ({
    at: hoursAgo(h), source, route, status, message, request_id: `demo-req-${h}`,
  });
  return {
    ok: true,
    checks: [
      { key: 'backup', label: 'Backup', ok: true, note: '6h ago' },
      { key: 'hkha-sync', label: 'HKHA sync', ok: true, note: '2h ago' },
      { key: 'review-emails', label: 'Review emails', ok: true, note: '7h ago' },
      { key: 'retention', label: 'Retention', ok: true, note: '7h ago' },
      { key: 'health-check', label: 'Health check', ok: true, note: '6h ago' },
      { key: 'match-day-sync', label: 'Results synced', ok: true },
      { key: 'sync-errors', label: 'Match cards', ok: true },
      { key: 'server-errors', label: 'Server errors', ok: true, note: '2 in 24h' },
    ],
    jobs: [job('hkha-sync', 2), job('backup', 6), job('health-check', 6), job('retention', 7), job('review-emails', 7)],
    errors: [
      err(3, 'worker', '/api/match/demoM1/players', 503, 'Database error (selections, 503)'),
      err(9, 'client', '/coach/match/demoM1-home', null, 'TypeError: dynamically imported module did not load'),
      err(20, 'worker', '/api/upcoming-fixtures', 500, 'Database error (matches, 500)'),
    ],
    serverErrors24h: 2,
    clientErrors24h: 1,
  };
}

// The WhatsApp list sheet's saved messages (Email lists, and the other lists that use it).
const TEMPLATES: MessageTemplate[] = [
  { id: 'demoTpl1', name: 'Details reminder', body: 'Hi {{Preferred Name}}, a reminder to check your details in Eddy before the season starts. Thanks!' },
  { id: 'demoTpl2', name: 'Kit to collect', body: 'Hi {{Preferred Name}}, your kit is ready to collect from the Kit Convenor.' },
];

export const routes: Routes = {
  'GET /api/messages/templates': () => ({ templates: TEMPLATES }),
  'POST /api/messages/log': () => ({ ok: true }),
  'GET /api/membership/board': () => membershipBoard(),
  'GET /api/membership/statements': () => statementBoard(),
  'GET /api/membership/insights': () => insights(),
  'GET /api/membership/number-holders': () => ({ holders: [] }),
  'GET /api/membership/active-members': () => ({
    filename: 'hkfc-hockey-active-members.csv',
    csv: ['Name,Membership No.,Team', ...SECTION.map((p, i) => `${p.name},F0${400 + i * 3},${p.team}`)].join('\n'),
    count: SECTION.length,
  }),
  'POST /api/membership/approve': () => ({ success: true }),
  'POST /api/membership/statements/notify': () => ({ success: true }),
  'GET /api/chairman/directory': () => directory(),
  'POST /api/chairman/export-log': () => ({ ok: true }),
  'GET /api/season-plan/board': ({ persona }) => seasonPlanBoard(persona),
  'GET /api/trials/sessions': () => ({ sessions: TRIALS }),
  'POST /api/trials/sessions': () => ({ id: 'demoTrialNew' }),
  'POST /api/trials/sessions/:id/remove': () => ({ ok: true }),
  'GET /api/volunteering/board': () => volunteers(),
  'GET /api/system': () => system(),
};
