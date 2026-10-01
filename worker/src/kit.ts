/**
 * Kit in Eddy (Supabase backend): the orders, where every set is, handing
 * kit out (a captain may collect a whole team's at once, and several people
 * may be handing out at the same time), and the spares for new joiners.
 * The rules live in the database functions (migration 20260930210000_kit);
 * this module shapes the screens and decides who counts as an officer: the
 * Kit Convenor and the Section Captains (the "kit" section, auth.ts).
 */
import type { Env } from "./env";
import { sectionsFor, type AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq, SupabaseError } from "./data/supabase";
import { invalidateForTables } from "./airtableWebhook";
import { TABLES } from "../../shared/schema/tableNames";
import {
  KIT_ITEMS,
  SWAPPABLE,
  type KitBoard,
  type KitMove,
  type KitMoveResult,
  type KitOrder,
  type KitPerson,
  type KitPlace,
  type KitSet,
  type KitSizes,
  type MyKit,
} from "../../shared/kit";

interface SetRow {
  id: string;
  order_id: string;
  supplier: string;
  received_on: string | null;
  shirt_no: number;
  team_range: string | null;
  ordered_for_name: string | null;
  shirt: string | null;
  shorts: string | null;
  socks: string | null;
  goalie_smock: string | null;
  goalie_smock_style: string | null;
  owner_id: string | null;
  owner_name: string | null;
  holder_id: string | null;
  holder_name: string | null;
  held_since: string | null;
  number_holder_name: string | null;
  number_holder_status: string | null;
  number_holder_active: boolean | null;
  pending_to_id: string | null;
  pending_to_name: string | null;
}

interface OrderRow {
  id: string;
  supplier: string;
  name: string;
  ordered_on: string | null;
  received_on: string | null;
}

interface PersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  status: string | null;
  active: boolean | null;
  registered_team: string | null;
  selected_team_sos: string | null;
  selected_team_eos: string | null;
  shirt_number_id: string | null;
}

const SET_COLUMNS =
  "id,order_id,supplier,received_on,shirt_no,team_range,ordered_for_name,shirt,shorts,socks,goalie_smock,goalie_smock_style,owner_id,owner_name,holder_id,holder_name,held_since,number_holder_name,number_holder_status,number_holder_active,pending_to_id,pending_to_name";

/** Kit sizes rows use the database's item names. */
const ITEM_COLUMN: Record<keyof KitSizes, string> = {
  shirt: "shirt",
  shorts: "shorts",
  socks: "socks",
  goalieSmock: "goalie_smock",
  goalieSmockStyle: "goalie_smock_style",
};

const EMPTY_SIZES: KitSizes = { shirt: null, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null };

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Kit moves into Eddy at the switch-over.", 409, "NOT_YET");
  }
}

export const isKitOfficer = (env: Env, user: AuthorizedUser) => sectionsFor(user, env).includes("kit");

const personName = (p: Pick<PersonRow, "preferred_name" | "given_names" | "surname">) =>
  [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
const personTeam = (p: PersonRow) => p.selected_team_eos || p.selected_team_sos || p.registered_team || "";

function placeOf(r: SetRow): KitPlace {
  if (!r.received_on) return "on_order";
  if (!r.holder_id) return "in_store";
  return r.holder_id === r.owner_id ? "with_owner" : "with_holder";
}

const pendingOf = (r: SetRow) => (r.pending_to_id ? { id: r.pending_to_id, name: r.pending_to_name ?? "" } : null);

const sizesOf = (r: SetRow): KitSizes => ({
  shirt: r.shirt,
  shorts: r.shorts,
  socks: r.socks,
  goalieSmock: r.goalie_smock,
  goalieSmockStyle: r.goalie_smock_style,
});

/** Items where the owner's own sizes differ from what the set was ordered in. */
export function mismatches(set: KitSizes, wanted: KitSizes | undefined): string[] {
  if (!wanted) return [];
  return KIT_ITEMS.filter(({ key }) => key !== "goalieSmockStyle" && wanted[key] && set[key] !== wanted[key]).map(
    ({ key, label }) => (set[key] ? `${label}: ${set[key]}, wants ${wanted[key]}` : `${label}: wants ${wanted[key]}, none ordered`),
  );
}

async function loadSizes(env: Env, supplier: string): Promise<Map<string, KitSizes>> {
  const rows = await db(env).select<{ person_id: string; item: string; size: string | null }>(
    "kit_sizes",
    `select=id,person_id,item,size&supplier=${eq(supplier)}`,
  );
  const byPerson = new Map<string, KitSizes>();
  for (const r of rows) {
    const key = (Object.keys(ITEM_COLUMN) as (keyof KitSizes)[]).find((k) => ITEM_COLUMN[k] === r.item);
    if (!key) continue;
    const sizes = byPerson.get(r.person_id) ?? { ...EMPTY_SIZES };
    sizes[key] = r.size;
    byPerson.set(r.person_id, sizes);
  }
  return byPerson;
}

const toOrder = (o: OrderRow): KitOrder => ({
  id: o.id,
  supplier: o.supplier,
  name: o.name,
  orderedOn: o.ordered_on,
  receivedOn: o.received_on,
});

export async function getKitBoard(env: Env, orderId: string | null): Promise<KitBoard> {
  requireSupabase(env);
  const d = db(env);
  const [orderRows, peopleRows, numbers] = await Promise.all([
    d.select<OrderRow>("kit_orders", "select=id,supplier,name,ordered_on,received_on&order=ordered_on.desc.nullslast"),
    d.select<PersonRow>(
      "people",
      "select=id,api_id,preferred_name,given_names,surname,status,active,registered_team,selected_team_sos,selected_team_eos,shirt_number_id",
    ),
    d.select<{ id: string; shirt_no: number; team_range: string | null }>("shirt_numbers", "select=id,shirt_no,team_range&order=shirt_no"),
  ]);
  const teams = [...new Set(numbers.map((n) => n.team_range).filter((t): t is string => !!t))];
  const orders = orderRows.map(toOrder);
  const order = orders.find((o) => o.id === orderId) ?? orders[0] ?? null;
  if (!order) return { orders, order: null, sets: [], people: [], teams };

  const [setRows, sizes] = await Promise.all([
    d.select<SetRow>("kit_sets_v", `select=${SET_COLUMNS}&order_id=${eq(order.id)}&order=shirt_no`),
    loadSizes(env, order.supplier),
  ]);
  const byApiId = new Map(peopleRows.map((p) => [p.api_id, p]));
  const shirtNo = new Map(numbers.map((n) => [n.id, n.shirt_no]));
  const setNumbers = new Set(setRows.map((r) => r.shirt_no));

  const sets: KitSet[] = setRows.map((r) => {
    const owner = r.owner_id ? byApiId.get(r.owner_id) : undefined;
    return {
      id: r.id,
      shirtNo: r.shirt_no,
      teamRange: r.team_range,
      sizes: sizesOf(r),
      orderedForName: r.ordered_for_name,
      owner: owner ? { id: owner.api_id, name: personName(owner), team: personTeam(owner), status: owner.status ?? "" } : null,
      numberHeldBy:
        !r.owner_id && r.number_holder_name ? { name: r.number_holder_name, status: r.number_holder_status ?? "" } : null,
      holder: r.holder_id ? { id: r.holder_id, name: r.holder_name ?? "" } : null,
      heldSince: r.held_since,
      pendingTo: pendingOf(r),
      place: placeOf(r),
      mismatches: owner ? mismatches(sizesOf(r), sizes.get(owner.id)) : [],
      wanted: owner ? sizes.get(owner.id) ?? null : null,
    };
  });

  const people: KitPerson[] = peopleRows
    .filter((p) => p.status === "Member" || p.status === "Applicant")
    .map((p) => {
      const no = p.shirt_number_id ? shirtNo.get(p.shirt_number_id) ?? null : null;
      return {
        id: p.api_id,
        name: personName(p),
        search: [p.preferred_name, p.given_names, p.surname].filter(Boolean).join(" ").toLowerCase(),
        team: personTeam(p),
        status: p.status ?? "",
        active: p.active === true,
        shirtNo: no,
        sizes: sizes.get(p.id) ?? { ...EMPTY_SIZES },
        hasSet: no !== null && setNumbers.has(no),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { orders, order, sets, people, teams };
}

export async function getMyKit(env: Env, user: AuthorizedUser): Promise<MyKit> {
  // Shown on everyone's dashboard, so the Airtable backend answers "nothing"
  // rather than an error.
  if (backendFor(env, "people") !== "supabase") return { personId: user.personId, mine: null, holding: [], incoming: [], convenors: [] };
  const d = db(env);
  const me = encodeURIComponent(user.personId);
  const rows = await d.select<SetRow>(
    "kit_sets_v",
    `select=${SET_COLUMNS}&or=(owner_id.eq."${me}",holder_id.eq."${me}",pending_to_id.eq."${me}")&order=ordered_on.desc.nullslast,shirt_no`,
  );
  const own = rows.find((r) => r.owner_id === user.personId);
  const holding = rows
    .filter((r) => r.holder_id === user.personId && r.owner_id !== user.personId)
    .map((r) => ({
      id: r.id,
      shirtNo: r.shirt_no,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? "", team: "", status: "" } : null,
      heldSince: r.held_since,
      sizes: sizesOf(r),
      pendingTo: pendingOf(r),
    }));
  const incoming = rows
    .filter((r) => r.pending_to_id === user.personId)
    .map((r) => ({
      id: r.id,
      shirtNo: r.shirt_no,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? "", team: "", status: "" } : null,
      holder: r.holder_id ? { id: r.holder_id, name: r.holder_name ?? "" } : null,
      mine: r.owner_id === user.personId,
    }));
  let convenors: string[] = [];
  if (own && placeOf(own) === "in_store") {
    const offices = await d.select<{ member: string | null }>("api_offices", "select=id,member&office=eq.kitConvenor&status=eq.Active");
    const ids = offices.map((o) => o.member).filter((m): m is string => !!m);
    if (ids.length) {
      const people = await d.select<PersonRow>(
        "people",
        `select=id,preferred_name,given_names,surname&api_id=in.(${ids.map((i) => `"${encodeURIComponent(i)}"`).join(",")})`,
      );
      convenors = people.map(personName);
    }
  }
  return {
    personId: user.personId,
    mine: own
      ? {
          id: own.id,
          shirtNo: own.shirt_no,
          supplier: own.supplier,
          sizes: sizesOf(own),
          holder: own.holder_id ? { id: own.holder_id, name: own.holder_name ?? "" } : null,
          heldSince: own.held_since,
          place: placeOf(own),
          pendingTo: pendingOf(own),
        }
      : null,
    holding,
    incoming,
    convenors,
  };
}

/** A database error the person can act on becomes a 400/404 with its message. */
function asHttpError(err: unknown): never {
  if (err instanceof SupabaseError && (err.code === "22023" || err.code === "P0002")) {
    const message = err.message.replace(/^Supabase .*?failed \(\d+\): /, "");
    throw new HttpError(`${message}.`, err.code === "P0002" ? 404 : 400, err.code === "P0002" ? "NOT_FOUND" : "INVALID_INPUT");
  }
  throw err;
}

const ids = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, max) : [];

export async function moveKit(env: Env, user: AuthorizedUser, body: Record<string, unknown>): Promise<KitMoveResult> {
  requireSupabase(env);
  const setIds = ids(body.setIds);
  if (setIds.length === 0) throw new HttpError("Choose at least one kit set.", 400, "INVALID_INPUT");
  const to = body.to === null ? null : typeof body.to === "string" && body.to ? body.to : undefined;
  if (to === undefined) throw new HttpError("Say who the kit goes to.", 400, "INVALID_INPUT");
  const expected: Record<string, string | null> = {};
  if (body.expected && typeof body.expected === "object") {
    for (const [k, v] of Object.entries(body.expected as Record<string, unknown>)) {
      if (setIds.includes(k) && (v === null || typeof v === "string")) expected[k] = v;
    }
  }
  try {
    return await db(env).rpc<KitMoveResult>("kit_move", {
      p_actor: user.personId,
      p_officer: isKitOfficer(env, user),
      p_sets: setIds,
      p_to: to,
      p_expected: expected,
    });
  } catch (err) {
    asHttpError(err);
  }
}

/** The receiver of an offered set says whether they've got it. */
export async function confirmKit(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  if (typeof body.accept !== "boolean") throw new HttpError("Say whether you've got it.", 400, "INVALID_INPUT");
  try {
    await db(env).rpc("kit_confirm", { p_actor: user.personId, p_set: oneId(body.setId), p_accept: body.accept });
  } catch (err) {
    asHttpError(err);
  }
  return { ok: true };
}

const oneId = (v: unknown) => {
  const [id] = ids([v]);
  if (!id) throw new HttpError("Choose a kit set.", 400, "INVALID_INPUT");
  return id;
};
const personId = (v: unknown) => {
  if (typeof v !== "string" || !v) throw new HttpError("Choose a person.", 400, "INVALID_INPUT");
  return v;
};

/** Changing whose number is whose is a People change: drop the People caches. */
const peopleChanged = (env: Env) => invalidateForTables(env, [TABLES.player]);

export async function allocateSpare(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  try {
    await db(env).rpc("kit_allocate", { p_actor: user.personId, p_set: oneId(body.setId), p_person: personId(body.personId) });
  } catch (err) {
    asHttpError(err);
  }
  await peopleChanged(env);
  return { ok: true };
}

export async function releaseSet(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  try {
    await db(env).rpc("kit_release", { p_actor: user.personId, p_set: oneId(body.setId) });
  } catch (err) {
    asHttpError(err);
  }
  await peopleChanged(env);
  return { ok: true };
}

export async function giveNewNumber(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const id = personId(body.personId);
  const person = await db(env).one<PersonRow>(
    "people",
    `select=id,api_id,registered_team,selected_team_sos,selected_team_eos&api_id=${eq(id)}`,
  );
  if (!person) throw new HttpError("That person was not found.", 404, "NOT_FOUND");
  const team = typeof body.team === "string" && body.team ? body.team : personTeam(person);
  if (!team) throw new HttpError("They have no team yet, so choose the number range.", 400, "INVALID_INPUT");
  let shirtNo: number;
  try {
    shirtNo = await db(env).rpc<number>("kit_new_number", { p_actor: user.personId, p_person: id, p_team: team });
  } catch (err) {
    asHttpError(err);
  }
  await peopleChanged(env);
  return { shirtNo };
}

export async function editSizes(env: Env, user: AuthorizedUser, setId: string, body: Record<string, unknown>) {
  requireSupabase(env);
  const s = (body.sizes ?? {}) as Record<string, unknown>;
  const sizes = Object.fromEntries(
    KIT_ITEMS.map(({ key }) => [key, typeof s[key] === "string" ? (s[key] as string).trim().slice(0, 20) : ""]),
  );
  try {
    await db(env).rpc("kit_edit_sizes", { p_actor: user.personId, p_set: oneId(setId), p: sizes });
  } catch (err) {
    asHttpError(err);
  }
  return { ok: true };
}

/** Swaps one item (shorts, socks, smock) between two sets of the same order. */
export async function swapItem(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  requireSupabase(env);
  const item = SWAPPABLE.find((s) => s.key === body.item)?.key;
  if (!item) throw new HttpError("Only shorts, socks and smocks can be swapped.", 400, "INVALID_INPUT");
  try {
    await db(env).rpc("kit_swap", { p_actor: user.personId, p_set: oneId(body.setId), p_other: oneId(body.otherId), p_item: ITEM_COLUMN[item] });
  } catch (err) {
    asHttpError(err);
  }
  return { ok: true };
}

export async function setOrderReceived(env: Env, orderId: string, body: Record<string, unknown>) {
  requireSupabase(env);
  const on = body.receivedOn;
  if (on !== null && !(typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on))) {
    throw new HttpError("Give the date the kit arrived.", 400, "INVALID_INPUT");
  }
  const rows = await db(env).update("kit_orders", `id=${eq(oneId(orderId))}`, { received_on: on });
  if (rows.length === 0) throw new HttpError("That order was not found.", 404, "NOT_FOUND");
  return { ok: true };
}

export async function getSetHistory(env: Env, setId: string): Promise<KitMove[]> {
  requireSupabase(env);
  const d = db(env);
  const moves = await d.select<{ kind: KitMove["kind"]; from_id: string | null; to_id: string | null; by_id: string | null; note: string | null; at: string }>(
    "kit_moves_v",
    `select=id,kind,from_id,to_id,by_id,note,at&set_id=${eq(oneId(setId))}&order=at.desc`,
  );
  const named = [...new Set(moves.flatMap((m) => [m.from_id, m.to_id, m.by_id]).filter((x): x is string => !!x))];
  const people = named.length
    ? await d.select<PersonRow>(
        "people",
        `select=id,api_id,preferred_name,given_names,surname&api_id=in.(${named.map((i) => `"${encodeURIComponent(i)}"`).join(",")})`,
      )
    : [];
  const name = (id: string | null) => (id ? personName(people.find((p) => p.api_id === id) ?? { preferred_name: null, given_names: "Someone", surname: null }) : null);
  return moves.map((m) => ({ kind: m.kind, from: name(m.from_id), to: name(m.to_id), by: name(m.by_id), note: m.note, at: m.at }));
}

/** CSV cells, quoted where needed. */
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Who needs kit from this order's supplier: Active players with a number
 * but no set in the order, in the order file's layout, for the next
 * top-up order. People without a number are left off: they need a number
 * (or a spare) first.
 */
export async function topUpCsv(env: Env, orderId: string | null): Promise<{ filename: string; csv: string; count: number }> {
  const board = await getKitBoard(env, orderId);
  if (!board.order) throw new HttpError("There is no kit order yet.", 404, "NOT_FOUND");
  const need = board.people.filter((p) => p.active && p.shirtNo !== null && !p.hasSet).sort((a, b) => a.shirtNo! - b.shirtNo!);
  const header = ["Name", "Status", "Shirt No.", "Socks Size", "Shirt Size", "Shorts Size", "Goalie Smock Style", "Goalie Smock Size", "Team"];
  const lines = need.map((p) =>
    [p.name, p.status, p.shirtNo, p.sizes.socks, p.sizes.shirt, p.sizes.shorts, p.sizes.goalieSmockStyle, p.sizes.goalieSmock, p.team]
      .map(cell)
      .join(","),
  );
  return {
    filename: `${board.order.supplier} top-up (${new Date().toISOString().slice(0, 10)}).csv`,
    csv: [header.join(","), ...lines].join("\r\n") + "\r\n",
    count: need.length,
  };
}
