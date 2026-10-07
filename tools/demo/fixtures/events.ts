// Special events: the player page's Events list and sheet, the Events
// screen (/events/manage) and one event's tabs (details, answers, payments,
// register), and the check-in page. Fictional events and people only.
import {
  billed,
  computeCharges,
  type ChargeList,
  type CheckInView,
  type EventDetails,
  type EventPerson,
  type EventResponseRow,
  type EventResponses,
  type ManageView,
  type ManagedEvent,
  type MyEvent,
  type PaymentInfo,
  type ResponseDetails,
} from '@shared/events';
import type { Selection } from '@shared/emailLists';
import { reply, type DemoRequest, type Routes } from './routing';
import { OTHERS, PERSONAS, SQUAD_PLAYERS, SAT1, SAT3, SAT4, TEAMS, at, idOf, personaTeam, type Persona } from './data';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const notFound = () => reply(404, { error: 'NOT_FOUND', message: 'That event was not found.' });
type Refusal = ReturnType<typeof reply>;
const SOCIAL_SEC = PERSONAS['social-secretary'];

// ── The events ───────────────────────────────────────────────────────────

const base: Omit<EventDetails, 'id' | 'type' | 'title' | 'startsAt'> = {
  description: null,
  location: null,
  endsAt: null,
  respondBy: null,
  memberPrice: null,
  guestAdultPrice: null,
  guestChildPrice: null,
  paymentMode: 'free',
  paymentDetails: null,
  guestsAllowed: false,
  maxGuests: null,
  helpNeeded: null,
  linkUrl: null,
  questions: [],
  socialFunction: null,
  team: null,
  status: 'published',
  posterUrl: null,
};

/** An event as the demo keeps it: the details plus what the Events screen adds. */
interface DemoEvent {
  details: EventDetails;
  audience: Selection;
  invited: number;
  chargesSentAt: string | null;
  registerTakenAt: string | null;
}

const PLAYING: Selection = { status: ['Member'], active: ['Active player'] };

const EVENTS: DemoEvent[] = [
  // Start of Season drinks three weeks ago: free, register taken.
  {
    details: {
      ...base,
      id: 'demoEv4',
      type: 'social_function',
      title: 'Start of Season drinks',
      socialFunction: 'Start of Season',
      location: "Members' Bar, HKFC",
      startsAt: at(SAT1 - 21, 19),
      endsAt: at(SAT1 - 21, 22),
      respondBy: at(SAT1 - 22, 18),
      guestsAllowed: true,
      maxGuests: 1,
    },
    audience: PLAYING,
    invited: 108,
    chargesSentAt: null,
    registerTakenAt: at(SAT1 - 21, 22, 40),
  },
  // Last week's C team bowling: paid on the night, register not finished.
  {
    details: {
      ...base,
      id: 'demoEv5',
      type: 'team_social',
      title: 'C team bowling',
      team: 'HKFC C',
      location: 'Lucky Strike Lanes, Causeway Bay',
      startsAt: at(SAT1 - 8, 20),
      endsAt: at(SAT1 - 8, 22, 30),
      respondBy: at(SAT1 - 9, 20),
      memberPrice: 150,
      paymentMode: 'on_the_night',
    },
    audience: PLAYING,
    invited: 14,
    chargesSentAt: null,
    registerTakenAt: null,
  },
  // The C team's curry night after Saturday's home game: answers open, PayMe / FPS, guests.
  {
    details: {
      ...base,
      id: 'demoEv1',
      type: 'team_social',
      title: 'C team curry night',
      posterUrl: '/demo-assets/curry.svg',
      team: 'HKFC C',
      description: 'After the Valley B game. Set menu with a drink included; anything extra on your own tab.',
      location: 'Spice Lane, Wan Chai',
      startsAt: at(SAT1, 19, 30),
      endsAt: at(SAT1, 22, 30),
      respondBy: at(SAT1, 12),
      memberPrice: 280,
      guestAdultPrice: 280,
      paymentMode: 'payme_fps',
      paymentDetails: 'FPS ID 1234567 (W. Ashford)',
      guestsAllowed: true,
      maxGuests: 1,
      helpNeeded: '2 to book the tables and collect the cake',
      questions: [
        { key: 'dietary', label: 'Dietary requirements' },
        { key: 'q1', label: 'Spice level' },
      ],
    },
    audience: PLAYING,
    invited: 14,
    chargesSentAt: null,
    registerTakenAt: null,
  },
  // A draft the C team's social secretary is still writing.
  {
    details: {
      ...base,
      id: 'demoEv6',
      type: 'team_social',
      title: 'C team family day',
      team: 'HKFC C',
      description: 'Picnic and a kids-v-parents game on the training pitch.',
      location: 'HKFC Pitch',
      startsAt: at(SAT3 + 1, 11),
      endsAt: at(SAT3 + 1, 15),
      guestsAllowed: true,
      maxGuests: 4,
      status: 'draft',
    },
    audience: PLAYING,
    invited: 14,
    chargesSentAt: null,
    registerTakenAt: null,
  },
  // A self-funded tour with its WhatsApp group, for those who said they're interested.
  {
    details: {
      ...base,
      id: 'demoEv3',
      type: 'tour',
      title: 'Bangkok 11s',
      description: 'Everyone books their own flights and hotel. Squad of 14; tour shirts provided.',
      location: 'Bangkok, Thailand',
      startsAt: at(SAT4 + 35, 8),
      endsAt: at(SAT4 + 36, 20),
      paymentMode: 'self_funded',
      memberPrice: 4500,
      linkUrl: 'https://chat.whatsapp.com/DemoInviteLink',
    },
    audience: { tourInterest: ['Bangkok 11s (Dec)'] },
    invited: 29,
    chargesSentAt: null,
    registerTakenAt: null,
  },
  // The club's Christmas Party: charged to membership accounts, guests and children welcome.
  {
    details: {
      ...base,
      id: 'demoEv2',
      type: 'social_function',
      title: 'Christmas Party',
      socialFunction: 'Christmas Party',
      description: 'Three courses, a free bar until 22:00 and the season awards. Christmas jumpers encouraged.',
      location: "Members' Bar, HKFC",
      startsAt: at(SAT4 + 41, 19, 30),
      endsAt: at(SAT4 + 41, 23, 30),
      respondBy: at(SAT4 + 34, 18),
      memberPrice: 380,
      guestAdultPrice: 420,
      guestChildPrice: 150,
      paymentMode: 'account',
      guestsAllowed: true,
      maxGuests: 2,
      questions: [{ key: 'dietary', label: 'Dietary requirements', required: true }],
      posterUrl: '/demo-assets/christmas.svg',
    },
    audience: PLAYING,
    invited: 112,
    chargesSentAt: null,
    registerTakenAt: null,
  },
];
const byId = (id: string) => EVENTS.find((e) => e.details.id === id);

// ── Answers ──────────────────────────────────────────────────────────────

const resp = (status: ResponseDetails['status'], extra: Partial<ResponseDetails> = {}): ResponseDetails => ({
  status,
  guests: [],
  canHelp: false,
  answers: {},
  notes: null,
  signedUpBy: null,
  waived: false,
  attended: false,
  guestsCame: null,
  checkedInAt: null,
  ...extra,
});

const personIdOf = (name: string) => (name === SOCIAL_SEC.name ? SOCIAL_SEC.id : idOf(name));
const memberNo = (name: string) => `F0${400 + ([...name].reduce((t, c) => t + c.charCodeAt(0), 0) % 200)}`;
const row = (name: string, updatedAt: string, r: ResponseDetails): EventResponseRow => ({ personId: personIdOf(name), name, membershipNo: memberNo(name), updatedAt, ...r });
const by = (name: string) => ({ id: personIdOf(name), name });
/** Just the answer, without who it is. */
const answerOf = (r: EventResponseRow): ResponseDetails => ({
  status: r.status,
  guests: r.guests,
  canHelp: r.canHelp,
  answers: r.answers,
  notes: r.notes,
  signedUpBy: r.signedUpBy,
  waived: r.waived,
  attended: r.attended,
  guestsCame: r.guestsCame,
  checkedInAt: r.checkedInAt,
});

const C_TEAM = SQUAD_PLAYERS.filter((p) => p.team === 'HKFC C').map((p) => p.name);

const ROWS: Record<string, EventResponseRow[]> = {
  demoEv1: [
    row('Sam Carter', at(-3, 21), resp('going', { guests: [{ name: 'Mia Carter', age: 'adult', dietary: 'Vegetarian' }], answers: { dietary: 'No nuts', q1: 'Medium' }, canHelp: true })),
    row('Jamie Wong', at(-3, 22), resp('going', { answers: { q1: 'Hot' } })),
    row('Priya Nair', at(-2, 9), resp('going', { guests: [{ name: 'Arun Nair', age: 'adult' }], answers: { dietary: 'Vegetarian', q1: 'Mild' } })),
    row('Tom Fletcher', at(-2, 12), resp('going', { signedUpBy: by('Marcus Leung'), answers: { q1: 'Medium' } })),
    row('Marcus Leung', at(-2, 12), resp('going', { canHelp: true, answers: { q1: 'Hot' } })),
    row('Oliver Grant', at(-2, 18), resp('maybe', { notes: 'Depends when my work dinner finishes' })),
    row('Kenji Tanaka', at(-1, 8), resp('going', { waived: true, answers: { q1: 'Medium' }, notes: 'Birthday that week!' })),
    row('Ravi Patel', at(-1, 10), resp('not_going', { notes: 'Umpiring the late game' })),
    row('Ben Hughes', at(-1, 19), resp('going', { guests: [{ name: 'Hannah Hughes', age: 'adult', dietary: 'Gluten free' }], answers: { q1: 'Mild' } })),
    row('Luca Rossi', at(0, 8), resp('maybe')),
  ],
  demoEv2: [
    row('Daniel Price', at(-4, 20), resp('going', { guests: [{ name: 'Grace Price', age: 'adult', dietary: 'None' }], answers: { dietary: 'None' } })),
    row('Chris Tam', at(-4, 21), resp('going', { answers: { dietary: 'Halal' } })),
    row('Henry Yip', at(-3, 9), resp('maybe', { answers: { dietary: 'Vegetarian' }, notes: 'Depends on a work trip' })),
    row('Jonah Fung', at(-3, 13), resp('going', { guests: [{ name: 'Ella Fung', age: 'adult', dietary: 'Gluten free' }, { name: 'Max Fung', age: 'child', dietary: 'None' }], answers: { dietary: 'None' } })),
    row('Victor Kwok', at(-2, 10), resp('going', { answers: { dietary: 'None' }, signedUpBy: by('Jonah Fung') })),
    row('Ethan Chan', at(-2, 17), resp('going', { answers: { dietary: 'None' }, signedUpBy: by('Sam Carter') })),
    row('Jamie Wong', at(-2, 18), resp('going', { answers: { dietary: 'None' } })),
    row('Patrick Ng', at(-1, 11), resp('not_going')),
  ],
  demoEv3: [
    row('Rohan Kapoor', at(-6, 20), resp('going')),
    row('George Lee', at(-5, 9), resp('going')),
    row('Aiden Choi', at(-4, 13), resp('maybe', { notes: 'Waiting on leave' })),
    row(SOCIAL_SEC.name, at(-3, 19), resp('going')),
  ],
  demoEv4: [
    row('Daniel Price', at(SAT1 - 24, 20), resp('going', { attended: true, checkedInAt: at(SAT1 - 21, 19, 12), guests: [{ name: 'Grace Price', age: 'adult' }], guestsCame: 1 })),
    row('Jamie Wong', at(SAT1 - 24, 21), resp('going', { attended: true })),
    row('Marcus Leung', at(SAT1 - 23, 9), resp('going', { attended: true, checkedInAt: at(SAT1 - 21, 19, 25) })),
    row('Henry Yip', at(SAT1 - 23, 12), resp('going')),
    row('Karan Shah', at(SAT1 - 23, 18), resp('going', { attended: true, checkedInAt: at(SAT1 - 21, 19, 40) })),
    row('Lewis Mak', at(SAT1 - 22, 8), resp('not_going')),
  ],
  demoEv5: [
    row('Sam Carter', at(SAT1 - 12, 20), resp('going', { attended: true, checkedInAt: at(SAT1 - 8, 19, 55) })),
    row('Jamie Wong', at(SAT1 - 12, 21), resp('going', { attended: true })),
    row('Priya Nair', at(SAT1 - 11, 9), resp('going', { attended: true, checkedInAt: at(SAT1 - 8, 20, 4) })),
    row('Marcus Leung', at(SAT1 - 11, 12), resp('going')),
    row('Ethan Chan', at(SAT1 - 11, 18), resp('going')),
    row('Noah Singh', at(SAT1 - 10, 8), resp('going', { attended: true })),
    row('Felix Moreau', at(SAT1 - 10, 9), resp('not_going')),
  ],
};
const rowsOf = (e: DemoEvent) => ROWS[e.details.id] ?? [];

/** Invited, no answer yet, while answers are open: the rest of the team for a team's event, a few names otherwise. */
function notAnswered(e: DemoEvent): { personId: string; name: string }[] {
  const d = e.details;
  if (d.status !== 'published' || Date.parse(d.respondBy ?? d.startsAt) < Date.now() || e.audience.tourInterest) return [];
  const answered = new Set(rowsOf(e).map((r) => r.name));
  const pool = d.team ? C_TEAM : ['Harry Lam', 'Felix Moreau', 'Finn O’Brien', 'Pete Summers', 'Samuel Obi', 'Will Ashford'];
  return pool.filter((n) => !answered.has(n)).map((name) => ({ personId: personIdOf(name), name }));
}

function counts(rows: EventResponseRow[]): ManagedEvent['counts'] {
  const c = { going: 0, maybe: 0, notGoing: 0, adultGuests: 0, childGuests: 0, canHelp: 0, came: 0 };
  for (const r of rows) {
    if (r.status === 'going') c.going++;
    else if (r.status === 'maybe') c.maybe++;
    else c.notGoing++;
    if (r.status === 'going') for (const g of r.guests) g.age === 'child' ? c.childGuests++ : c.adultGuests++;
    if (r.canHelp) c.canHelp++;
    if (r.attended) c.came++;
  }
  return c;
}

/** The club-wide functions show whole-club numbers on the list; their answer rows are a sample. */
const CLUB_COUNTS: Record<string, Partial<ManagedEvent['counts']>> = {
  demoEv2: { going: 41, maybe: 6, notGoing: 9, adultGuests: 17, childGuests: 3 },
  demoEv4: { going: 38, notGoing: 12, adultGuests: 5, came: 31 },
};

/** Is this persona in the event's invite list? */
function invitedTo(e: DemoEvent, p: Persona): boolean {
  if (e.details.team) return personaTeam(p) === e.details.team;
  if (e.audience.tourInterest) return rowsOf(e).some((r) => r.name === p.name);
  return true;
}

function managed(e: DemoEvent, p: Persona): ManagedEvent {
  return {
    ...e.details,
    audience: e.audience,
    invited: e.invited,
    includesMe: invitedTo(e, p),
    chargesSentAt: e.chargesSentAt,
    registerTakenAt: e.registerTakenAt,
    counts: { ...counts(rowsOf(e)), ...CLUB_COUNTS[e.details.id] },
  };
}

// ── Who keeps what ───────────────────────────────────────────────────────

/** Section Captains keep every event; a team social secretary keeps their team's. */
const isClub = (p: Persona) => p.offices.includes('sectionCaptain');
const managesEvent = (p: Persona, e: DemoEvent) => isClub(p) || (!!e.details.team && !!p.socialSecretaryOf?.includes(e.details.team));

const SOCIAL_SECRETARIES: Record<string, string[]> = {
  'HKFC B': ['Jonah Fung'],
  'HKFC C': [SOCIAL_SEC.name],
  'HKFC D': ['Arjun Mehta'],
  'HKFC F': ['Lewis Mak', 'Karan Shah'],
};

/** The options in each invite group, as the directory would offer them. */
const GROUP_OPTIONS: Record<string, string[]> = {
  status: ['Member', 'Applicant'],
  active: ['Active player', 'Not an active player'],
  team: TEAMS,
  playerCoach: ['Player', 'Coach'],
  hockeyCommittee: ['Chairman', 'Secretary', 'Treasurer'],
  subCommittee: ['Section Captain', 'Fixtures', 'Social & Events'],
  touringCommittee: ['Tour Lead', 'Tour Logistics'],
  easter5s: ['Fixtures', 'Logistics', 'Sponsorship'],
  tourInterest: ['Bangkok 11s (Dec)', 'Singapore 6s (Mar)'],
  tournamentInterest: ['Easter 5s', 'Masters 9s'],
  qualifiedUmpire: ['Level 1', 'Level 2'],
};

function manageView(req: DemoRequest): ManageView | Refusal {
  const p = req.persona;
  const club = isClub(p);
  const teams = club ? TEAMS : p.socialSecretaryOf ?? [];
  if (!club && !teams.length) return reply(403, { error: 'OFFICER_ACCESS_REQUIRED', message: 'Events are kept by the social secretaries and Section Captains.' });
  const since = Date.now() - 60 * DAY;
  return {
    events: EVENTS.filter((e) => managesEvent(p, e) && Date.parse(e.details.startsAt) >= since).map((e) => managed(e, p)),
    club,
    teams,
    groups: GROUP_OPTIONS,
    socialSecretaries: club
      ? TEAMS.map((team) => ({
          team,
          teamId: `demoTeam${team.slice(-1)}`,
          people: (SOCIAL_SECRETARIES[team] ?? []).map((name) => ({ personId: personIdOf(name), name })),
        }))
      : [],
  };
}

function responses(req: DemoRequest): EventResponses | Refusal {
  const e = byId(req.params.id);
  if (!e || !managesEvent(req.persona, e)) return notFound();
  return { event: managed(e, req.persona), responses: rowsOf(e), notAnswered: notAnswered(e) };
}

// ── Payments ─────────────────────────────────────────────────────────────

/** A PayMe / FPS screenshot as Eddy read it; null amount when it couldn't be read. */
const proof = (amountDue: number, amountRead: number | null, extra: Partial<PaymentInfo> = {}, ref = 1): PaymentInfo => ({
  status: amountRead == null ? 'unreadable' : amountRead === amountDue ? 'matched' : 'amount_differs',
  amountDue,
  amountRead,
  paidOn: amountRead == null ? null : at(-1, 12),
  reference: amountRead == null ? null : `FRN2026${(ref * 7919 + 104_729).toString(36).toUpperCase()}`,
  payee: amountRead == null ? null : 'W. Ashford',
  proofUrl: null,
  uploadedAt: at(-1, 13),
  confirmedAt: null,
  confirmedBy: null,
  ...extra,
});

/** Each payer's screenshot for the curry night, by payer. */
const CURRY_PROOFS: Record<string, (due: number) => PaymentInfo> = {
  'Sam Carter': (due) => proof(due, due, {}, 1),
  'Jamie Wong': (due) => proof(due, due, { confirmedAt: at(-1, 20), confirmedBy: SOCIAL_SEC.name }, 2),
  'Priya Nair': (due) => proof(due, 280, {}, 3),
  'Marcus Leung': (due) => proof(due, due, { confirmedAt: at(-1, 20), confirmedBy: SOCIAL_SEC.name }, 4),
  'Ben Hughes': (due) => proof(due, null),
};

/**
 * Screenshot variants (`?as=<persona>:<variant>`):
 *  - charges-sent: the treasurer's list went out yesterday, and an answer changed since.
 *  - checkin-open: the check-in page during the Start of Season drinks, for
 *    someone who said Going with a guest and signed up their son.
 */
function chargeList(e: DemoEvent, variants?: Set<string>): ChargeList {
  if (variants?.has('charges-sent') && e.details.paymentMode === 'account') {
    return { ...chargeList(e), sentAt: at(-1, 10, 30), changedSince: ['Henry Yip'] };
  }
  const payers = computeCharges(
    e.details,
    rowsOf(e).map((r) => {
      const payer = r.signedUpBy ?? { id: r.personId, name: r.name };
      return { name: r.name, status: r.status, guests: r.guests, waived: r.waived, payer: { personId: payer.id, name: payer.name, membershipNo: memberNo(payer.name) } };
    }),
  ).map((c) => ({ ...c, payment: e.details.paymentMode === 'payme_fps' ? CURRY_PROOFS[c.name]?.(c.total) ?? null : null }));
  return { payers, total: payers.reduce((t, x) => t + x.total, 0), sentAt: e.chargesSentAt, changedSince: [] };
}

// ── The player page ──────────────────────────────────────────────────────

/** Events they're invited to or answered, until the day after each ends. */
function myEvents(req: DemoRequest): { events: MyEvent[] } {
  const p = req.persona;
  const now = Date.now();
  const events = EVENTS.filter((e) => e.details.status !== 'draft' && Date.parse(e.details.endsAt ?? e.details.startsAt) >= now - DAY).flatMap((e): MyEvent[] => {
    const d = e.details;
    const rows = rowsOf(e);
    const mine = rows.find((r) => r.name === p.name);
    const signedUp = rows.filter((r) => r.signedUpBy?.name === p.name);
    const invited = invitedTo(e, p);
    if (!mine && !signedUp.length && !invited) return [];
    const bill = billed(d.paymentMode) ? chargeList(e).payers.find((c) => c.name === p.name) : undefined;
    return [
      {
        ...d,
        invited,
        open: d.status === 'published' && now < Date.parse(d.respondBy ?? d.startsAt),
        manager: managesEvent(p, e),
        mine: mine ? answerOf(mine) : null,
        signedUp: signedUp.map((r) => ({ personId: r.personId, name: r.name, ...answerOf(r) })),
        bill: bill ? { lines: bill.lines, total: bill.total, payment: bill.payment } : null,
      },
    ];
  });
  return { events };
}

type Named = { name: string; team: string };
const EVERYONE: Named[] = [...SQUAD_PLAYERS.map((s) => ({ name: s.name, team: s.team })), ...OTHERS.map(([name, team]) => ({ name, team }))];

/** Invited people matching a name search, with any answer so far. */
function eventPeople(req: DemoRequest): { people: EventPerson[] } {
  const e = byId(req.params.id);
  const q = (req.query.get('q') ?? '').trim().toLowerCase();
  if (!e || q.length < 2) return { people: [] };
  const rows = rowsOf(e);
  const pool = e.details.team ? EVERYONE.filter((x) => x.team === e.details.team) : EVERYONE;
  return {
    people: pool
      .filter((x) => x.name.toLowerCase().includes(q))
      .slice(0, 12)
      .map((x) => {
        const r = rows.find((y) => y.name === x.name);
        return { personId: personIdOf(x.name), name: x.name, team: x.team, answer: r ? { status: r.status, signedUpBy: r.signedUpBy?.name ?? null } : null };
      }),
  };
}

/** Anyone in the directory by name (naming a team's social secretaries). */
function findPeople(req: DemoRequest): { people: { personId: string; name: string; team: string | null }[] } {
  const q = (req.query.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return { people: [] };
  return { people: EVERYONE.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 10).map((x) => ({ personId: personIdOf(x.name), name: x.name, team: x.team })) };
}

/** What someone who scanned the check-in QR code sees: them and anyone they signed up. */
function checkInView(req: DemoRequest): CheckInView | Refusal {
  const e = byId(req.params.id);
  if (!e) return notFound();
  const d = e.details;
  const rows = rowsOf(e);
  const me = rows.find((r) => r.name === req.persona.name);
  const now = Date.now();
  if (req.variants?.has('checkin-open')) {
    // Tonight's drinks, open for check-in whatever the time.
    const start = Date.parse(at(0, 19));
    const going = (extra: Partial<ResponseDetails>) => ({ ...resp('going'), ...extra });
    return {
      event: { ...d, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3 * HOUR).toISOString() },
      open: true,
      people: [
        { personId: req.persona.id, name: req.persona.name, self: true, response: going({ guests: [{ name: 'Mia Carter', age: 'adult' }] }) },
        { personId: idOf('Leo Carter'), name: 'Leo Carter', self: false, response: going({ signedUpBy: by(req.persona.name) }) },
      ],
    };
  }
  return {
    event: d,
    open: d.status === 'published' && now >= Date.parse(d.startsAt) - HOUR && now <= Date.parse(d.endsAt ?? d.startsAt) + HOUR,
    people: [
      { personId: req.persona.id, name: req.persona.name, self: true, response: me ? answerOf(me) : null },
      ...rows.filter((r) => r.signedUpBy?.name === req.persona.name).map((r) => ({ personId: r.personId, name: r.name, self: false, response: answerOf(r) })),
    ],
  };
}

// ── Routes ───────────────────────────────────────────────────────────────

const ok = { ok: true as const };

export const routes: Routes = {
  'GET /api/events/mine': (req): { events: MyEvent[] } => myEvents(req),
  'GET /api/events/manage': (req): ManageView | Refusal => manageView(req),
  'GET /api/events/find-people': (req) => findPeople(req),
  'POST /api/events/audience': (req): { count: number } => {
    const team = typeof req.body?.team === 'string' && req.body.team ? req.body.team : null;
    const ticked = Object.values((req.body?.audience ?? {}) as Selection).reduce((n, v) => n + (v?.length ?? 0), 0);
    return { count: team ? 14 : Math.max(9, 130 - ticked * 11) };
  },
  'POST /api/events/social-secretaries': () => ok,
  'POST /api/events': (req): { id: string } => ({ id: typeof req.body?.id === 'string' ? req.body.id : 'demoEv6' }),
  'GET /api/events/:id/responses': (req): EventResponses | Refusal => responses(req),
  'GET /api/events/:id/people': (req) => eventPeople(req),
  'GET /api/events/:id/charges': (req): ChargeList | Refusal => {
    const e = byId(req.params.id);
    return e ? chargeList(e, req.variants) : notFound();
  },
  'GET /api/events/:id/checkin-link': (req): { url: string } => ({ url: `https://app.eddy.global/checkin/${req.params.id}?c=demo3f9a1c7e5b2d` }),
  'GET /api/events/:id/checkin': (req): CheckInView | Refusal => checkInView(req),
  'POST /api/events/:id/checkin': (req): { ok: true; checkedIn: number } => ({ ok: true, checkedIn: Array.isArray(req.body?.people) ? req.body.people.length : 1 }),
  'POST /api/events/:id/respond': () => ok,
  'POST /api/events/:id/status': () => ok,
  'POST /api/events/:id/delete': () => ok,
  'POST /api/events/:id/poster': (): { url: string } => ({ url: '/demo-assets/christmas.svg' }),
  'POST /api/events/:id/charges-sent': () => ok,
  'POST /api/events/:id/payment-proof': (): PaymentInfo => proof(560, 560, { uploadedAt: new Date().toISOString() }),
  'POST /api/events/:id/confirm-payment': () => ok,
  'POST /api/events/:id/attendance': () => ok,
  'POST /api/events/:id/tick-everyone': (req): { ticked: number } => ({
    ticked: (ROWS[req.params.id] ?? []).filter((r) => r.status === 'going' && !r.attended).length,
  }),
  'POST /api/events/:id/register-taken': () => ok,
  'POST /api/events/:id/waive': () => ok,
};
