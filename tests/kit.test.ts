import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sectionsFor } from "../worker/src/auth";
import { confirmKit, getKitBoard, getMyKit, mismatches, moveKit, setOrderExpected, topUpCsv } from "../worker/src/kit";
import { suggestSpares, suggestSwaps, type KitSet, type KitSizes } from "../shared/kit";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const player = { email: "p@x.com", personId: "recPLAYER", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;
const convenor = { ...player, personId: "recCONVENOR", officerRoles: [{ office: "kitConvenor", designation: "" }] } as AuthorizedUser;

const sizes = (shirt: string | null, more: Partial<KitSizes> = {}): KitSizes => ({ shirt, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null, ...more });
const spare = (shirtNo: number, teamRange: string, s: KitSizes): KitSet => ({
  id: `s${shirtNo}`, shirtNo, teamRange, sizes: s, orderedForName: null, owner: null, numberHeldBy: null, wanted: null, holder: null, heldSince: null, pendingTo: null, place: "in_store", mismatches: [],
});

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const name = url.pathname.split("/").pop()!;
    const t = tables[name];
    return new Response(JSON.stringify(typeof t === "function" ? t(url) : t ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const TEAMS = ["HKFC A", "HKFC B", "HKFC C", "HKFC D"];

describe("kit", () => {
  it("opens the kit section to the Kit Convenor and Section Captains", () => {
    expect(sectionsFor(convenor)).toEqual(["kit"]);
    const captain = { officerRoles: [{ office: "sectionCaptain" as const, designation: "" }] };
    expect(sectionsFor(captain)).toEqual(["membership", "chairman", "kit", "planning", "trials"]);
    expect(sectionsFor(player)).toEqual([]);
  });

  it("suggests spares whose shirt fits, from the person's own team's range first, then lower numbers", () => {
    const spares = [spare(150, "HKFC D", sizes("L")), spare(45, "HKFC B", sizes("L")), spare(12, "HKFC A", sizes("L")), spare(40, "HKFC B", sizes("XL"))];
    expect(suggestSpares({ team: "HKFC B", sizes: sizes("L") }, spares, TEAMS).map((s) => s.shirtNo)).toEqual([45, 12, 150]);
    // More items that fit break a tie between two in the same range.
    const two = [spare(41, "HKFC B", sizes("L", { shorts: "S" })), spare(42, "HKFC B", sizes("L", { shorts: "M" }))];
    expect(suggestSpares({ team: "HKFC B", sizes: sizes("L", { shorts: "M" }) }, two, TEAMS)[0].shirtNo).toBe(42);
    // No shirt size on record: nothing, until they give one.
    expect(suggestSpares({ team: "HKFC A", sizes: sizes(null) }, spares, TEAMS)).toEqual([]);
  });

  it("suggests swapping shorts or socks with a spare, or with a player who wants the other size, never the shirt", () => {
    const owned = (shirtNo: number, s: KitSizes, wanted: KitSizes): KitSet => ({
      ...spare(shirtNo, "HKFC A", s), owner: { id: `r${shirtNo}`, name: `P${shirtNo}`, team: "HKFC A", status: "Member" }, wanted,
    });
    const me = owned(5, sizes("L", { shorts: "M", socks: "Large" }), sizes("XL", { shorts: "XL", socks: "Large" }));
    const sets = [
      me,
      spare(40, "HKFC B", sizes("L", { shorts: "XL" })),
      spare(12, "HKFC A", sizes("M", { shorts: "XL" })),
      owned(7, sizes("M", { shorts: "XL" }), sizes("M", { shorts: "M" })), // wants my M: one swap fixes both
      spare(13, "HKFC A", sizes("XL")), // the shirt I want, but shirts aren't swapped
    ];
    expect(suggestSwaps(me, sets).map((s) => [s.item, s.with.shirtNo, s.mutual])).toEqual([["shorts", 7, true], ["shorts", 12, false]]);
    expect(suggestSwaps(sets[1], sets)).toEqual([]); // a spare has no owner to suit
  });

  it("flags items where the owner's sizes differ from the set's", () => {
    expect(mismatches(sizes("L", { shorts: "M" }), sizes("L", { shorts: "XL", socks: "Large" }))).toEqual(["Shorts: M, wants XL", "Socks: wants Large, none ordered"]);
    expect(mismatches(sizes("L"), undefined)).toEqual([]);
  });

  it("hands a batch over in one call, telling the database whether the caller is an officer", async () => {
    const calls = fake({ kit_move: { moved: ["a"], conflicts: [] } });
    const ids = ["00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"];
    await moveKit(env, convenor, { setIds: ids, to: "recCAPTAIN", expected: { [ids[0]]: null, [ids[1]]: null, other: "x" } });
    await moveKit(env, player, { setIds: [ids[0]], to: "recOWNER" });
    const [asOfficer, asPlayer] = calls.map((c) => c.body);
    expect(asOfficer).toMatchObject({ p_actor: "recCONVENOR", p_officer: true, p_sets: ids, p_to: "recCAPTAIN", p_expected: { [ids[0]]: null, [ids[1]]: null } });
    expect(asPlayer).toMatchObject({ p_actor: "recPLAYER", p_officer: false });
    await expect(moveKit(env, player, { setIds: [], to: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(moveKit(env, player, { setIds: ids })).rejects.toMatchObject({ status: 400 });
  });

  it("shows a board: owners, holders, where each set is and who still needs kit", async () => {
    fake({
      kit_orders: [{ id: "o1", supplier: "Kukri", name: "2026-27 Kukri order 1", ordered_on: "2026-08-17", received_on: "2026-10-03" }],
      shirt_numbers: [{ id: "n1", shirt_no: 1, team_range: "HKFC A" }, { id: "n2", shirt_no: 2, team_range: "HKFC A" }, { id: "n3", shirt_no: 31, team_range: "HKFC B" }, { id: "n4", shirt_no: 32, team_range: "HKFC B" }],
      people: [
        { id: "u1", api_id: "recA", preferred_name: "Al", given_names: "Alan", surname: "One", status: "Member", active: true, selected_team_sos: "HKFC A", shirt_number_id: "n1" },
        { id: "u2", api_id: "recB", preferred_name: null, given_names: "Bo", surname: "Two", status: "Applicant", active: true, selected_team_sos: "HKFC B", shirt_number_id: "n3" },
        // Not Active: numbered, but gets no kit, so isn't on the top-up list.
        { id: "u4", api_id: "recD", preferred_name: null, given_names: "Di", surname: "Four", status: "Applicant", active: false, shirt_number_id: "n4" },
        { id: "u3", api_id: "recC", preferred_name: null, given_names: "Cy", surname: "Three", status: "Resigned", shirt_number_id: null },
      ],
      kit_sets_v: [
        { id: "k1", order_id: "o1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 1, team_range: "HKFC A", shirt: "L", shorts: "M", owner_id: "recA", owner_name: "Al One", holder_id: "recC", holder_name: "Cy Three" },
        { id: "k2", order_id: "o1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 2, team_range: "HKFC A", shirt: "XL", owner_id: null, holder_id: null, number_holder_name: "Ed Five", number_holder_status: "Applicant", number_holder_active: false },
      ],
      kit_sizes: [{ id: "z1", person_id: "u1", item: "shorts", size: "L" }],
    });
    const board = await getKitBoard(env, null);
    expect(board.teams).toEqual(["HKFC A", "HKFC B"]);
    expect(board.sets[0]).toMatchObject({ shirtNo: 1, owner: { id: "recA", name: "Al One", team: "HKFC A" }, holder: { name: "Cy Three" }, place: "with_holder", mismatches: ["Shorts: M, wants L"] });
    // A spare: its number is still held by someone who isn't Active.
    expect(board.sets[1]).toMatchObject({ shirtNo: 2, owner: null, place: "in_store", numberHeldBy: { name: "Ed Five", status: "Applicant" } });
    // Members and applicants only; Bo has a number but nothing in this order.
    expect(board.people.map((p) => [p.name, p.shirtNo, p.hasSet, p.active])).toEqual([["Al One", 1, true, true], ["Bo Two", 31, false, true], ["Di Four", 32, false, false]]);
    const csv = await topUpCsv(env, null);
    expect(csv.count).toBe(1);
    expect(csv.csv.split("\r\n")[1]).toBe("Bo Two,Applicant,31,,,,,,HKFC B");
  });

  it("asks the receiver of a passed-on set to confirm, and records their answer", async () => {
    const calls = fake({
      kit_confirm: null,
      kit_sets_v: [
        { id: "k1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 5, owner_id: "recPLAYER", holder_id: "recCAP", holder_name: "Cap Tain", pending_to_id: "recPLAYER", pending_to_name: "Pla Yer" },
        { id: "k2", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 6, owner_id: "recMATE", owner_name: "Mate", holder_id: "recPLAYER", pending_to_id: "recMATE", pending_to_name: "Mate" },
      ],
    });
    const kit = await getMyKit(env, player);
    expect(kit.incoming).toMatchObject([{ id: "k1", shirtNo: 5, mine: true, holder: { name: "Cap Tain" } }]);
    expect(kit.holding).toMatchObject([{ shirtNo: 6, pendingTo: { name: "Mate" } }]);
    await confirmKit(env, player, { setId: "00000000-0000-0000-0000-00000000000a", accept: true });
    expect(calls.at(-1)!.body).toEqual({ p_actor: "recPLAYER", p_set: "00000000-0000-0000-0000-00000000000a", p_accept: true });
    await expect(confirmKit(env, player, { setId: "00000000-0000-0000-0000-00000000000a" })).rejects.toMatchObject({ status: 400 });
  });

  it("tells a player where their kit is and what they're holding for others", async () => {
    const calls = fake({
      kit_sets_v: [
        { id: "k1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 5, owner_id: "recPLAYER", holder_id: "recCAP", holder_name: "Cap Tain", held_since: "2026-10-03T10:00:00Z" },
        { id: "k2", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 6, owner_id: "recMATE", owner_name: "Mate", holder_id: "recPLAYER" },
      ],
    });
    const kit = await getMyKit(env, player);
    expect(kit.mine).toMatchObject({ shirtNo: 5, place: "with_holder", holder: { name: "Cap Tain" } });
    expect(kit.holding).toMatchObject([{ shirtNo: 6, owner: { name: "Mate" } }]);
    expect(calls[0].url.searchParams.get("or")).toBe('(owner_id.eq."recPLAYER",holder_id.eq."recPLAYER",pending_to_id.eq."recPLAYER")');
  });

  it("tells a player when kit on order is expected, and only while it's on order", async () => {
    const row = { id: "k1", supplier: "Kukri", shirt_no: 92, owner_id: "recPLAYER", holder_id: null, expected_on: "2026-10-15" };
    fake({ kit_sets_v: [{ ...row, received_on: null }] });
    expect((await getMyKit(env, player)).mine).toMatchObject({ shirtNo: 92, place: "on_order", expectedOn: "2026-10-15" });
    fake({ kit_sets_v: [{ ...row, received_on: "2026-10-14" }] });
    expect((await getMyKit(env, player)).mine).toMatchObject({ place: "in_store", expectedOn: null });
  });

  it("saves or clears an order's expected delivery date", async () => {
    const calls = fake({ kit_orders: [{ id: "o1" }] });
    const id = "00000000-0000-0000-0000-00000000000a";
    await setOrderExpected(env, id, { expectedOn: "2026-10-15" });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { expected_on: "2026-10-15" } });
    await setOrderExpected(env, id, { expectedOn: null });
    expect(calls.at(-1)!.body).toEqual({ expected_on: null });
    await expect(setOrderExpected(env, id, { expectedOn: "15 Oct" })).rejects.toMatchObject({ status: 400 });
  });
});
