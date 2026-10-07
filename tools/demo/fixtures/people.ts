// Officers' screens: People search, a person's admin page and history,
// Suspensions, Offices and teams, Data checks and HKHA registration.
// Fictional people only; HKID and passport numbers are obviously fake.
import type {
  HistoryEntry, PersonAdminCan, PersonAdminView, PersonMembership, PersonSearchRow, PersonSquad,
} from '@/api/adminPeople';
import type { CardSuspensionRow, LegacySuspensionRow, SuspensionRow, SuspensionsBoard } from '@/api/suspensions';
import type { ClubOffice, Holder, OfficeView, TeamAdminView } from '@/api/club';
import type { DataCheckPerson, DataChecks } from '@/api/dataChecks';
import { REGISTRATION_CSV_HEADER, registrationCsvRow, type RegistrationBoard, type RegistrationPlayer, type RegistrationReason } from '@shared/registration';
import { stageTargets } from '@shared/membershipStages';
import type { Persona } from '../personas.mjs';
import { reply, type Routes } from './routing';
import { OTHERS, PERSONAS, SEASON, SQUAD_PLAYERS, TEAMS, SAT1, at, day, sectionsOf } from './data';

// ── The cast ────────────────────────────────────────────────────────────

interface Person {
  id: string;
  name: string;
  team: string | null;
  position: string | null;
  status: 'Member' | 'Applicant';
  stage: string | null;
  active: boolean;
  memberType: string | null;
  categoryType: string | null;
  membershipNo: string | null;
  joinDate: string | null;
  commitmentEndDate: string | null;
  selectedTeamSos: string | null;
  selectedTeamEos: string | null;
}

const PERSONA_IDS: Record<string, string> = Object.fromEntries(Object.values(PERSONAS).map((p) => [p.name, p.id]));

/** One id per name: a persona's, a squad player's, else demo<Name>. */
const idFor = (name: string) =>
  PERSONA_IDS[name] ?? SQUAD_PLAYERS.find((p) => p.name === name)?.id ?? `demo${name.replace(/\W/g, '')}`;

const SEASON_END = `${SEASON.slice(5)}-08-31`;

let memberNo = 4100;
function member(name: string, team: string | null, position: string | null, more: Partial<Person> = {}): Person {
  memberNo += 37;
  return {
    id: idFor(name), name, team, position, status: 'Member', stage: 'Accepted', active: true,
    memberType: 'Main', categoryType: 'Sports Preferred', membershipNo: `D${memberNo}`,
    joinDate: `20${16 + (memberNo % 9)}-09-01`, commitmentEndDate: SEASON_END,
    selectedTeamSos: team, selectedTeamEos: null,
    ...more,
  };
}

/** The person the guide's screenshots open: an applicant the Membership Officer is about to approve. */
const TOM: Person = {
  id: 'demoP102', name: 'Tom Reid', team: 'HKFC D', position: 'Midfielder',
  status: 'Applicant', stage: '6. Membership Officer (Signed)', active: true,
  memberType: 'Main', categoryType: 'Junior (21-27)', membershipNo: 'D20417',
  joinDate: day(-3), commitmentEndDate: `${Number(SEASON.slice(5)) + 1}-08-31`,
  selectedTeamSos: 'HKFC D', selectedTeamEos: null,
};

const NOT_YET = { membershipNo: null, joinDate: null, commitmentEndDate: null };

/** Applicants, a visiting player, inactive and junior members, a duplicate name. */
const EXTRAS: Person[] = [
  member('Callum Reeves', 'HKFC E', 'Defender', { id: 'demoP101' }),
  TOM,
  member('Nikhil Rao', null, null, { id: 'demoP103', status: 'Applicant', stage: '1. Trial Application', selectedTeamSos: null, ...NOT_YET }),
  member('Lucas Ferreira', 'HKFC E', 'Forward', { id: 'demoP104', status: 'Applicant', stage: '4. Sponsor (Signed)', categoryType: 'Sports Subscriber', ...NOT_YET }),
  member('Jonas Becker', 'HKFC D', 'Defender', { id: 'demoP105', stage: 'Temporary', memberType: null, categoryType: null, ...NOT_YET }),
  member('Mark Ellison', 'HKFC F', 'Goalkeeper', { id: 'demoP106', active: false, stage: 'On Hold' }),
  member('Hugo Martin', null, 'Midfielder', { id: 'demoP107', stage: 'Rejected', active: false, selectedTeamSos: null, ...NOT_YET }),
  member('Kai Yeung', 'HKFC H', null, { id: 'demoP108', memberType: 'Child', categoryType: 'Junior (under 21)', joinDate: '2024-09-01' }),
  member('Dev Malhotra', 'HKFC G', 'Forward', { id: 'demoP109' }),
  member('Tim Kwan', 'HKFC H', 'Defender', { id: 'demoP110' }),
  member('Ryan Lau', 'HKFC H', 'Midfielder', { id: 'demoP111', categoryType: 'Sports Debenture' }),
  member('Stefan Novak', 'HKFC F', 'Midfielder', { id: 'demoP112', active: false }),
  member('Harry Lam', 'HKFC H', 'Forward', { id: 'demoP113' }),
];

const PEOPLE: Person[] = [
  ...SQUAD_PLAYERS.map((p) => member(p.name, p.team, p.position)),
  ...OTHERS.map(([name, team, position]) => member(name, team, position)),
  // Officers and the coach, who don't play.
  member('Jo Bennett', null, null, { categoryType: 'Sports Debenture' }),
  member('Dan Marsh', null, null),
  member('Graham Holt', null, null),
  ...EXTRAS,
];
PEOPLE.find((p) => p.name === 'Ethan Chan')!.categoryType = 'Junior (under 21)';

const byId = (id: string) => PEOPLE.find((p) => p.id === id);
function byName(name: string): Person {
  const p = PEOPLE.find((x) => x.name === name);
  if (!p) throw new Error(`people.ts: nobody called ${name}`);
  return p;
}
const holder = (name: string): Holder => ({ id: byName(name).id, name });
const checkPerson = (p: Person): DataCheckPerson => ({ id: p.id, name: p.name, team: p.team, active: p.active, status: p.status });
const dc = (name: string) => checkPerson(byName(name));
const SECOND_HARRY = byId('demoP113')!;

// ── People search and the person page ───────────────────────────────────

function search(q: string): { people: PersonSearchRow[] } {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const people = PEOPLE.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 30)
    .map(({ id, name, team, status, stage, active }) => ({ id, name, team, status, stage, active }));
  return { people };
}

const OPEN_STAGES = ['1. Trial Application', '2. Section Captain Invitation', '3. Club Application (Signed)', '4. Sponsor (Signed)', '5. Chairman (Signed)', '6. Membership Officer (Signed)'];
const isJuniorMember = (p: Person) =>
  p.status === 'Member' && !OPEN_STAGES.includes(p.stage ?? '') && (p.memberType === 'Child' || (p.categoryType ?? '').startsWith('Junior'));

/** Mirrors canFor in worker/src/admin/people.ts. */
function canFor(persona: Persona, p: Person): PersonAdminCan {
  const sections = sectionsOf(persona);
  const membership = sections.includes('membership');
  const registeredTeam = sections.includes('registration');
  return {
    membership,
    stage: membership && stageTargets(p.status, p.stage).length > 0,
    squad: sections.includes('club') || registeredTeam,
    registeredTeam,
    suspend: persona.offices.includes('hockeyConvenor'),
    activate: persona.offices.includes('sectionCaptain'),
    juniorRoute: membership && isJuniorMember(p),
  };
}

function personView(persona: Persona, id: string) {
  const p = byId(id);
  if (!p) return reply(404, { error: 'NOT_FOUND', message: 'Person not found.' });
  const can = canFor(persona, p);
  const view: PersonAdminView = { id: p.id, name: p.name, status: p.status, stage: p.stage, active: p.active, team: p.team, can };
  if (can.membership) {
    const membership: PersonMembership = {
      memberType: p.memberType, categoryType: p.categoryType, membershipNo: p.membershipNo,
      joinDate: p.joinDate, commitmentEndDate: p.commitmentEndDate,
    };
    view.membership = membership;
  }
  if (can.stage) view.stageTargets = stageTargets(p.status, p.stage);
  if (can.squad) {
    const squad: PersonSquad = { registeredTeam: p.team, selectedTeamSos: p.selectedTeamSos, selectedTeamEos: p.selectedTeamEos, playingPosition: p.position };
    view.squad = squad;
    view.teamOptions = TEAMS;
  }
  return view;
}

// ── History ─────────────────────────────────────────────────────────────

const h = (days: number, hh: number, actor: string | null, action: string, summary: string, fields: string[] = []): HistoryEntry =>
  ({ at: at(days, hh, 15), actor, action, summary, fields });
/** A change no person made: Eddy itself (shown as the wordmark), or the HKHA fixture sync. */
const bySystem = (label: 'eddy' | 'hkha-sync', e: HistoryEntry): HistoryEntry =>
  ({ ...e, actor: label === 'eddy' ? 'Eddy' : 'HKHA fixtures', actorLabel: label });

const TOM_HISTORY: HistoryEntry[] = [
  h(-1, 21, 'Daniel Price', 'admin-membership', 'Membership details changed', ['Membership number', 'Join date', 'Commitment end date']),
  bySystem('eddy', h(-2, 10, null, 'row-update', 'Changed', ['Stage: 5. Chairman (Signed) → 6. Membership Officer (Signed)'])),
  h(-4, 19, 'Jo Bennett', 'squad', 'Squad changed', ['Selected, HKFC D v Tigers']),
  h(-4, 18, 'Jo Bennett', 'row-availability', 'Availability answered for them', ['Available']),
  h(-6, 12, 'Alex Morgan', 'admin-squad', 'Teams or position changed', ['Selected team (start of season): none → HKFC D', 'Position: none → Midfielder']),
  h(-6, 11, 'Chris Tam', 'admin-squad', 'Teams or position changed', ['Registered team: none → HKFC D']),
  h(-7, 20, 'Alex Morgan', 'activate', 'Made active'),
  h(-8, 9, 'Alex Morgan', 'joiner-registration', 'HKHA registration requested'),
  h(-12, 17, 'Alex Morgan', 'admin-stage', 'Stage changed', ['Stage: 1. Trial Application → 2. Section Captain Invitation']),
  h(-15, 20, 'Alex Morgan', 'trial-practice-invite', 'Invited to a practice'),
  h(-18, 13, null, 'joiner-create', 'Added as a new joiner'),
];

function history(person: string | null, match: string | null): { entries: HistoryEntry[] } {
  if (match) {
    return { entries: [
      h(-1, 20, 'Jo Bennett', 'squad', 'Squad changed', ['Selected: Sam Carter, Jamie Wong, Priya Nair']),
      bySystem('hkha-sync', h(-2, 9, null, 'row-update', 'Changed', ['Date and time'])),
      h(-6, 9, null, 'row-insert', 'Fixture added'),
    ] };
  }
  if (person === TOM.id) return { entries: TOM_HISTORY };
  const p = person ? byId(person) : undefined;
  if (!p) return { entries: [] };
  return { entries: [
    h(-9, 19, 'Jo Bennett', 'row-availability', 'Availability answered for them', ['Unavailable']),
    h(-30, 10, 'Alex Morgan', 'admin-squad', 'Teams or position changed', [`Selected team (start of season): none → ${p.team ?? 'none'}`]),
    h(-41, 12, 'Chris Tam', 'registration-registered', 'Registered with HKHA'),
  ] };
}

// ── Suspensions ─────────────────────────────────────────────────────────

function suspension(n: number, name: string, matches: number | null, fromDays: number, reason: string, more: Partial<SuspensionRow> = {}): SuspensionRow {
  const p = byName(name);
  return {
    id: `demoSusp${n}`, player: p.id, name: p.name, servingTeam: p.team ?? 'HKFC C', matches, fromDate: day(fromDays), reason,
    served: 0, remaining: matches, active: true, servedOn: null,
    createdAt: at(fromDays, 21), createdBy: 'Chris Tam', clearedAt: null, clearedBy: null, clearReason: null,
    ...more,
  };
}

function suspensions(): SuspensionsBoard {
  // In serving order: a player's suspensions run one after another.
  const open = [
    suspension(1, 'Henry Yip', 3, -12, 'Red card v Valley A: striking an opponent with the stick.', { served: 2, remaining: 1 }),
    suspension(2, 'Henry Yip', 2, -5, 'Disciplinary Committee: dissent towards the umpire after the red card.'),
    suspension(3, 'Lewis Mak', null, -3, 'Awaiting a Disciplinary Committee hearing.', { remaining: null }),
    suspension(4, 'Max Keller', 2, -9, 'Red card v Tigers.', { served: 1, remaining: 1 }),
  ];
  const cleared = [
    suspension(5, 'Pete Summers', 1, -30, 'Red card v Kowloon CC B.', { served: 1, remaining: 0, active: false, servedOn: day(-23) }),
    suspension(6, 'Isaac Ho', 2, -40, 'Red card v Shaheen C.', { served: 1, remaining: 1, active: false, clearedAt: at(-33, 18), clearedBy: 'Chris Tam', clearReason: 'Appeal upheld' }),
  ];
  const cards: CardSuspensionRow[] = [
    { player: idFor('Jonah Fung'), name: 'Jonah Fung', servingTeam: 'HKFC B', remainingMatches: 1, points: 10, dcReferral: false, indeterminate: false },
    { player: idFor('Aiden Choi'), name: 'Aiden Choi', servingTeam: 'HKFC E', remainingMatches: 2, points: 15, dcReferral: true, indeterminate: false },
    { player: idFor('Kenji Tanaka'), name: 'Kenji Tanaka', servingTeam: 'HKFC C', remainingMatches: 1, points: 10, dcReferral: false, indeterminate: true },
  ];
  // The flags left after the move have no registered team.
  const legacy: LegacySuspensionRow[] = [{ player: 'demoP112', name: 'Stefan Novak', team: null, isSuspended: true, matchesToServe: 1 }];
  return { open, cleared, cards, legacy, teams: TEAMS };
}

// ── Offices and teams ───────────────────────────────────────────────────

function offices(): { offices: OfficeView[] } {
  const rows: [ClubOffice, string, OfficeView['status'], string | null, string | null][] = [
    ['sectionCaptain', 'Alex Morgan', 'Active', null, 'mens.captain@example.com'],
    ['sectionCaptain', 'Rohan Kapoor', 'Retired', null, null],
    ['sectionChair', 'Matteo Bianchi', 'Active', null, 'mens.chair@example.com'],
    ['sectionChair', 'Victor Kwok', 'Retired', null, null],
    ['membershipOfficer', 'Daniel Price', 'Active', null, 'membership@example.com'],
    ['membershipOfficer', 'Samuel Obi', 'Retired', null, null],
    ['hockeyConvenor', 'Chris Tam', 'Active', null, 'mens.convenor@example.com'],
    ['kitConvenor', 'Dan Marsh', 'Active', null, 'kit@example.com'],
    ['assistantDirector', 'Adam Walsh', 'Active', null, null],
    ['umpireCoordinator', 'Graham Holt', 'Active', null, null],
    ['sponsor', 'Will Ashford', 'Active', null, null],
    ['sponsor', 'Patrick Ng', 'Active', null, null],
    ['sponsor', 'Karan Shah', 'Active', null, null],
    ['sponsor', 'Daniel Price', 'Retired', null, null],
  ];
  return { offices: rows.map(([office, name, status, designation, officeEmail], i) => ({
    id: `demoOffice${i + 1}`, office, designation, officeEmail, status, holder: holder(name),
  })) };
}

const TEAM_STAFF: Record<string, [coaches: string[], captains: string[], size: number]> = {
  'HKFC A': [['Matteo Bianchi'], ['Chris Tam'], 16],
  'HKFC B': [['Victor Kwok'], ['Henry Yip', 'Adam Walsh'], 16],
  'HKFC C': [['Jo Bennett'], ['Priya Nair'], 16],
  'HKFC D': [['Jo Bennett', 'Charlie Dunn'], ['Omar Haddad'], 16],
  'HKFC E': [['Patrick Ng'], ['Aiden Choi'], 15],
  'HKFC F': [['Karan Shah'], [], 15],
  'HKFC G': [[], ['Pete Summers'], 14],
  'HKFC H': [['Dev Malhotra'], ['Tim Kwan'], 14],
};

function teams(): { teams: TeamAdminView[] } {
  return { teams: TEAMS.map((name, i) => {
    const [coaches, captains, size] = TEAM_STAFF[name] ?? [[], [], 16];
    return {
      id: `demoTeam${name.slice(-1)}`, name, rank: i + 1, active: true, targetSquadSize: size,
      coaches: coaches.map(holder), captains: captains.map(holder), sectionCaptains: [holder('Alex Morgan')],
    };
  }) };
}

// ── Data checks ─────────────────────────────────────────────────────────

function dataChecks(): DataChecks {
  return {
    unlinkedCards: [
      { id: 'demoCard1', rawName: 'WONG Jamie Ka Ho', team: 'HKFC C', matchDate: at(SAT1 - 7, 14, 30), opponent: 'Punjab B', suggestions: [dc('Jamie Wong')] },
      { id: 'demoCard2', rawName: 'LEUNG M.', team: 'HKFC C', matchDate: at(SAT1 - 7, 14, 30), opponent: 'Punjab B', suggestions: [dc('Marcus Leung'), dc('Ryan Lau')] },
      { id: 'demoCard3', rawName: 'NGUYEN Minh', team: 'HKFC D', matchDate: at(SAT1 - 14, 9, 30), opponent: 'Valley D', suggestions: [] },
    ],
    sharedRegisteredNames: [{ registeredName: 'LAM Harry', people: [dc('Harry Lam'), checkPerson(SECOND_HARRY)] }],
    reRegistrations: [{
      id: 'demoReReg1', person: dc('Arjun Mehta'), season: SEASON, previousTeam: 'HKFC D', suggestedTeam: 'HKFC C',
      detail: '3 play-ups for HKFC C this season',
      playUps: [{ matchDate: day(SAT1 - 21), team: 'HKFC C' }, { matchDate: day(SAT1 - 14), team: 'HKFC C' }, { matchDate: day(SAT1 - 7), team: 'HKFC C' }],
      createdAt: at(SAT1 - 6, 9),
    }],
    incomplete: [
      { person: dc('Nikhil Rao'), missing: ['team', 'position', 'ability'] },
      { person: dc('Lucas Ferreira'), missing: ['ability'] },
      { person: dc('Kai Yeung'), missing: ['position'] },
    ],
    duplicates: [
      { match: 'name', people: [dc('Harry Lam'), checkPerson(SECOND_HARRY)] },
      { match: 'email', people: [dc('Tom Reid'), dc('Dev Malhotra')] },
    ],
    needsFixing: [
      { kind: 'stage', person: dc('Mark Ellison'), value: 'On Hold' },
      { kind: 'review', person: dc('Stefan Novak'), commitmentId: 'demoCommit1', value: '' },
      { kind: 'legacySuspension', person: dc('Stefan Novak'), value: 'Is Suspended, Matches to serve' },
    ],
  };
}

// ── HKHA registration ───────────────────────────────────────────────────

const FILE = '/assets/default-profile.png';
const NATIONALITY = ['British', 'Indian', 'Australian', 'Dutch', 'Irish', 'Canadian', 'New Zealander', 'Pakistani', 'South African', 'Hong Kong'];
const CHINESE: Record<string, string> = { 'Jamie Wong': '黃家明', 'Marcus Leung': '梁文傑', 'Ethan Chan': '陳以信', 'Dylan Cheung': '張德倫', 'Chris Tam': '譚志強', 'Kai Yeung': '楊啟文' };
const shortDate = (days: number) => new Date(at(days, 12)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' });

interface RegExtra {
  reason?: RegistrationReason;
  detail?: string;
  team?: string;
  previousEos?: string | null;
  registeredName?: string | null;
  nameShared?: boolean;
  visiting?: boolean;
  passportOnly?: boolean;
  dateOfBirth?: string;
  noPhoto?: boolean;
  noIdCopy?: boolean;
}

/** Who needs registering, and why; everyone else was ticked off in September. */
const REG_SPECIAL: Record<string, RegExtra> = {
  'Tom Reid': { reason: 'new', previousEos: null, noPhoto: true },
  'Jonas Becker': { reason: 'new', previousEos: null, passportOnly: true, visiting: true },
  'Kai Yeung': { reason: 'new', previousEos: null, dateOfBirth: `${Number(SEASON.slice(0, 4)) - 15}-03-14` },
  'Lucas Ferreira': { reason: 'new', previousEos: null, noIdCopy: true },
  'Isaac Ho': { reason: 'playUps', detail: `From HKFC D, ${shortDate(-4)}`, team: 'HKFC C', previousEos: 'HKFC D' },
  'Wesley Tsang': { reason: 'moved', detail: `Registered for HKFC E on ${shortDate(-23)}` },
  'Callum Reeves': { reason: 'season', registeredName: null },
  'Ethan Chan': { reason: 'season' },
  'Harry Lam': { nameShared: true },
};

function regPlayer(p: Person, n: number, x: RegExtra = {}): RegistrationPlayer {
  const [given, ...rest] = p.name.split(' ');
  const surname = rest.join(' ');
  const shirt = SQUAD_PLAYERS.find((s) => s.name === p.name)?.shirtNo;
  const team = x.team ?? p.team;
  const passportOnly = !!x.passportOnly;
  return {
    id: p.id,
    name: p.name,
    team,
    previousEos: x.previousEos === undefined ? team : x.previousEos,
    shirtNo: shirt ? Number(shirt) : 24 + (n % 26),
    registeredName: x.registeredName === undefined ? `${surname.toUpperCase()} ${given}` : x.registeredName,
    ...(x.nameShared ? { nameShared: true } : {}),
    ...(x.visiting ? { visiting: true } : {}),
    surname,
    givenNames: given,
    chineseName: CHINESE[p.name] ?? null,
    hkidNo: passportOnly ? null : `Z${String(100000 + n * 1373).slice(0, 6)}(${n % 10})`,
    passportNo: passportOnly || n % 4 === 0 ? `XD${5550000 + n * 211}` : null,
    dateOfBirth: x.dateOfBirth ?? `${1984 + (n % 18)}-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}`,
    nationality: CHINESE[p.name] ? 'Hong Kong' : NATIONALITY[n % NATIONALITY.length],
    mobileNo: `+852 5550 ${String(2000 + n * 7).slice(-4)}`,
    email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
    files: {
      photo: x.noPhoto ? null : FILE,
      hkid: passportOnly || x.noIdCopy ? null : FILE,
      passport: passportOnly ? FILE : null,
      u18Form: null,
    },
    registeredAt: x.reason ? null : at(-30 + (n % 9), 10),
    reason: x.reason ?? null,
    reasonDetail: x.detail ?? null,
  };
}

function registrationBoard(): RegistrationBoard {
  const rank = (t: string | null) => (t ? TEAMS.indexOf(t) : 99);
  const players = PEOPLE.filter((p) => p.active && p.team)
    .map((p, i) => regPlayer(p, i + 1, REG_SPECIAL[p.name]))
    .sort((a, b) => rank(a.team) - rank(b.team) || (a.surname ?? '').localeCompare(b.surname ?? ''));
  return { season: SEASON, players };
}

function registrationExport(todo: boolean, team: string | null): { filename: string; csv: string; count: number } {
  const rows = registrationBoard().players.filter((p) => (!todo || p.reason) && (!team || p.team === team));
  const line = (r: string[]) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',');
  return { filename: `hkha-registration-${SEASON}.csv`, csv: [REGISTRATION_CSV_HEADER, ...rows.map(registrationCsvRow)].map(line).join('\r\n'), count: rows.length };
}

// ── Routes ──────────────────────────────────────────────────────────────

const ok = { ok: true as const };
const keys = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o) : []);

export const routes: Routes = {
  'GET /api/admin/people': ({ query }) => search(query.get('q') ?? ''),
  'GET /api/admin/people/:id': ({ persona, params }) => personView(persona, params.id),
  'GET /api/history': ({ query }) => history(query.get('person'), query.get('match')),
  'POST /api/admin/people': () => ({ ...ok, id: 'demoNewPerson' }),
  'POST /api/admin/people/:id/membership': ({ body }) => ({ ...ok, changed: keys(body?.expect), removedPeriods: 0 }),
  'POST /api/admin/people/:id/squad': ({ body }) => ({ ...ok, changed: keys(body?.expect) }),
  'POST /api/admin/people/:id/stage': () => ({ ...ok, changed: ['applicant_stage'] }),
  'POST /api/ranking/activate': () => ok,
  'POST /api/ranking/deactivate': () => ok,

  'GET /api/discipline/suspensions': () => suspensions(),
  'POST /api/discipline/suspensions': () => ({ ...ok, id: 'demoSuspNew' }),
  'POST /api/discipline/suspensions/:id': () => ok,
  'POST /api/discipline/suspensions/:id/clear': () => ok,
  'POST /api/discipline/flags/:id/clear': () => ok,

  'GET /api/admin/offices': () => offices(),
  'POST /api/admin/offices': () => ({ ...ok, id: 'demoOfficeNew' }),
  'POST /api/admin/offices/:id': ({ params }) => ({ ...ok, id: params.id }),
  'GET /api/admin/teams': () => teams(),
  'POST /api/admin/teams/:id': ({ body }) => ({ ...ok, changed: keys(body) }),

  'GET /api/admin/data-checks': () => dataChecks(),
  'POST /api/admin/match-cards/:id/link': ({ body }) => ({ ...ok, linked: body?.saveName ? 2 : 1 }),
  'POST /api/admin/registration-events/:id/resolve': ({ body }) => ({ ...ok, team: body?.team ?? 'HKFC D' }),

  'GET /api/registration/board': () => registrationBoard(),
  'GET /api/registration/export': ({ query }) => registrationExport(query.get('todo') === '1', query.get('team')),
  'POST /api/registration/registered': ({ body }) => ({ ...ok, count: Array.isArray(body?.ids) ? body.ids.length : 1 }),
  'POST /api/registration/unregistered': () => ok,
  'POST /api/registration/details': ({ body }) => ({ ...ok, linked: body?.registeredName ? 3 : 0 }),
};
