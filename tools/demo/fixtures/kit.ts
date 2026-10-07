// Kit: the Kit Convenor's board (orders, sets, people) and a player's own kit.
import type { KitBoard, KitMove, KitMoveResult, KitOrder, KitPerson, KitSet, KitSizes, MyKit } from '@shared/kit';
import type { Persona } from '../personas.mjs';
import type { Routes } from './routing';
import { PERSONAS, TEAMS, at, day } from './data';

const ORDER: KitOrder = { id: 'demoOrder1', supplier: 'Kukri', name: 'Kukri order 1', orderedOn: day(-50), receivedOn: day(-4), expectedOn: null };
const NEXT_ORDER: KitOrder = { id: 'demoOrder2', supplier: 'Kukri', name: 'Kukri order 2 (new joiners)', orderedOn: day(-6), receivedOn: null, expectedOn: day(24) };

const sz = (shirt: string, shorts: string, socks: string, goalieSmock: string | null = null, goalieSmockStyle: string | null = null): KitSizes =>
  ({ shirt, shorts, socks, goalieSmock, goalieSmockStyle });
const range = (n: number) => (n <= 30 ? 'HKFC A' : n <= 60 ? 'HKFC B' : n <= 100 ? 'HKFC C' : 'HKFC D');
const idOf = (name: string) => (name === PERSONAS.player.name ? PERSONAS.player.id : `demo${name.replace(/\W/g, '')}`);
const HELD_SINCE = at(-4, 19, 40);

// [number, owner, team, sizes ordered, who has it ('owner' = handed out), sizes the owner now wants]
type Row = [number, string | null, string | null, KitSizes, string | null, Partial<KitSizes>?];
const ROWS: Row[] = [
  [3, 'Kenji Tanaka', 'HKFC A', sz('M', 'S', 'Large'), 'owner'],
  [5, 'Marcus Leung', 'HKFC A', sz('L', 'M', 'Large'), null],
  [8, 'Oliver Grant', 'HKFC A', sz('XL', 'L', 'X-Large'), null],
  [11, null, null, sz('L', 'XL', 'Large'), null],
  [12, 'Felix Moreau', 'HKFC A', sz('M', 'M', 'Medium'), 'Leo Barros'],
  [31, 'Priya Nair', 'HKFC B', sz('S', 'S', 'Medium'), 'owner'],
  [34, 'Ravi Patel', 'HKFC B', sz('L', 'M', 'Large'), null],
  [36, 'Jamie Wong', 'HKFC B', sz('M', 'M', 'Large'), null],
  [40, null, null, sz('XL', 'L', 'X-Large'), null],
  [61, 'Ben Hughes', 'HKFC C', sz('XL', 'L', 'X-Large'), null],
  [62, 'Tom Fletcher', 'HKFC C', sz('L', 'M', 'Large', 'L', 'Long Sleeve'), null],
  [64, 'Harry Lam', 'HKFC C', sz('M', 'S', 'Medium'), null],
  [65, 'Ethan Chan', 'HKFC C', sz('L', 'L', 'Large'), null],
  [66, 'Noah Singh', 'HKFC C', sz('M', 'M', 'Large'), null, { shorts: 'XL' }],
  [68, 'Luca Rossi', 'HKFC C', sz('2XL', 'XL', 'X-Large'), null],
  [70, 'Kai Morgan', 'HKFC C', sz('L', 'M', 'Large'), null],
  [72, 'Sam Carter', 'HKFC C', sz('L', 'M', 'Large'), 'Ben Hughes'],
  [101, 'Arjun Mehta', 'HKFC D', sz('M', 'M', 'Large'), 'owner'],
  [103, 'Dylan Cheung', 'HKFC D', sz('L', 'L', 'Large'), 'Charlie Dunn'],
  [105, 'Max Keller', 'HKFC D', sz('XL', 'L', 'X-Large', 'XL', 'Short Sleeve'), 'Charlie Dunn'],
  [108, 'Isaac Ho', 'HKFC D', sz('L', 'XL', 'Large'), 'Charlie Dunn', { shorts: 'M' }],
  [110, 'Omar Haddad', 'HKFC D', sz('M', 'S', 'Medium'), 'Charlie Dunn'],
  [112, 'Wesley Tsang', 'HKFC D', sz('L', 'M', 'Large'), 'Charlie Dunn', { socks: 'X-Large' }],
];

const ITEMS: [keyof KitSizes, string][] = [['shirt', 'Shirt'], ['shorts', 'Shorts'], ['socks', 'Socks'], ['goalieSmock', 'Smock']];

function sets(): KitSet[] {
  return ROWS.map(([no, owner, team, sizes, holder, want]) => {
    const wanted = owner ? { ...sizes, ...(want ?? {}) } : null;
    const holderName = holder === 'owner' ? owner : holder;
    return {
      id: `demoKit${no}`,
      shirtNo: no,
      teamRange: range(no),
      sizes,
      orderedForName: owner ?? (no === 11 ? 'Chris Doyle' : 'Adam Price'),
      owner: owner && team ? { id: idOf(owner), name: owner, team, status: 'Member' } : null,
      numberHeldBy: !owner && no === 11 ? { name: 'Chris Doyle', status: 'Applicant' } : null,
      holder: holderName ? { id: idOf(holderName), name: holderName } : null,
      heldSince: holderName ? HELD_SINCE : null,
      pendingTo: no === 103 && owner ? { id: idOf(owner), name: owner } : null,
      place: !holderName ? 'in_store' : holderName === owner ? 'with_owner' : 'with_holder',
      mismatches: owner && wanted ? ITEMS.filter(([k]) => wanted[k] && wanted[k] !== sizes[k]).map(([k, l]) => `${l}: ${sizes[k]}, wants ${wanted[k]}`) : [],
      wanted,
    };
  });
}

function people(): KitPerson[] {
  const owners: KitPerson[] = ROWS.filter((r) => r[1]).map(([no, name, team, sizes, , want]) => ({
    id: idOf(name!), name: name!, search: name!.toLowerCase(), team: team!, status: 'Member', active: true, shirtNo: no, sizes: { ...sizes, ...(want ?? {}) }, hasSet: true,
  }));
  const extra: (Partial<KitPerson> & Pick<KitPerson, 'name' | 'team' | 'shirtNo' | 'sizes' | 'hasSet'>)[] = [
    { name: 'Leo Barros', team: 'HKFC A', shirtNo: 14, sizes: sz('M', 'M', 'Large'), hasSet: true },
    { name: 'Charlie Dunn', team: 'HKFC D', shirtNo: 104, sizes: sz('L', 'M', 'Large'), hasSet: true },
    { name: 'Aaron Kwok', team: 'HKFC D', status: 'Applicant', shirtNo: null, sizes: sz('L', 'M', 'Large'), hasSet: false },
    { name: 'Jonah Price', team: 'HKFC B', status: 'Applicant', shirtNo: null, sizes: sz('XL', 'L', 'X-Large'), hasSet: false },
    { name: 'Rohan Das', team: 'HKFC C', shirtNo: 74, sizes: sz('M', 'S', 'Medium'), hasSet: false },
    { name: 'Tim Walsh', team: 'HKFC D', shirtNo: 115, sizes: sz('2XL', 'XL', 'X-Large'), hasSet: false },
    { name: 'Chris Doyle', team: '', status: 'Applicant', active: false, shirtNo: 11, sizes: sz('L', 'XL', 'Large'), hasSet: true },
  ];
  return [
    ...owners,
    ...extra.map((p) => ({ id: idOf(p.name), search: p.name.toLowerCase(), status: 'Member', active: true, ...p })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function board(orderId: string | null): KitBoard {
  const order = orderId === NEXT_ORDER.id ? NEXT_ORDER : ORDER;
  const all = sets();
  const onOrder = all.slice(0, 3).map((s, i): KitSet => ({
    ...s, id: `demoNext${i}`, shirtNo: 120 + i, teamRange: 'HKFC D', place: 'on_order', holder: null, heldSince: null, pendingTo: null,
  }));
  return { orders: [NEXT_ORDER, ORDER], order, sets: order === NEXT_ORDER ? onOrder : all, people: people(), teams: TEAMS };
}

function myKit(p: Persona): MyKit {
  const all = sets();
  const holding = all
    .filter((s) => s.holder?.name === p.name && s.owner?.name !== p.name)
    .map(({ id, shirtNo, owner, heldSince, sizes, pendingTo }) => ({ id, shirtNo, owner, heldSince, sizes, pendingTo }));
  const own = all.find((s) => s.owner?.name === p.name);
  return {
    personId: p.id,
    mine: own
      ? { id: own.id, shirtNo: own.shirtNo, sizes: own.sizes, holder: own.holder, heldSince: own.heldSince, place: own.place, pendingTo: own.pendingTo, supplier: 'Kukri', expectedOn: null }
      : null,
    holding,
    incoming: [],
    convenors: [PERSONAS['kit-convenor'].name],
  };
}

const HISTORY: KitMove[] = [
  { kind: 'handed', from: null, to: 'Ben Hughes', by: PERSONAS['kit-convenor'].name, note: null, at: HELD_SINCE },
];

const MOVED: KitMoveResult = { moved: [], offered: [], conflicts: [] };

export const routes: Routes = {
  'GET /api/kit/board': ({ query }) => board(query.get('order')),
  'GET /api/kit/me': ({ persona }) => myKit(persona),
  'GET /api/kit/sets/:id/history': (): KitMove[] => HISTORY,
  'POST /api/kit/move': () => MOVED,
};
