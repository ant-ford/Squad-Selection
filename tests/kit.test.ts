import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sectionsFor } from "../worker/src/auth";
import { getKitBoard, getMyKit, mismatches, moveKit, topUpCsv } from "../worker/src/kit";
import { suggestSpares, type KitSet, type KitSizes } from "../shared/kit";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const player = { email: "p@x.com", personId: "recPLAYER", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;
const convenor = { ...player, personId: "recCONVENOR", officerRoles: [{ office: "kitConvenor", designation: "" }] } as AuthorizedUser;

const sizes = (shirt: string | null, more: Partial<KitSizes> = {}): KitSizes => ({ shirt, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null, ...more });
const spare = (shirtNo: number, teamRange: string, s: KitSizes): KitSet => ({
  id: `s${shirtNo}`, shirtNo, teamRange, sizes: s, orderedForName: null, owner: null, holder: null, heldSince: null, place: "in_store", mismatches: [],
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
  it("opens the kit section to the Kit Convenor and Section Captains, on Supabase only", () => {
    expect(sectionsFor(convenor, env)).toEqual(["kit"]);
    const captain = { officerRoles: [{ office: "sectionCaptain" as const, designation: "" }] };
    expect(sectionsFor(captain, env)).toEqual(["membership", "chairman", "kit"]);
    expect(sectionsFor(captain, { ...env, DATA_BACKEND: "airtable" })).toEqual(["membership", "chairman"]);
    expect(sectionsFor(player, env)).toEqual([]);
  });

  it("suggests spares whose shirt fits, from the person's own team's range first, then lower numbers", () => {
    const spares = [spare(150, "HKFC D", sizes("L")), spare(45, "HKFC B", sizes("L")), spare(12, "HKFC A", sizes("L")), spare(40, "HKFC B", sizes("XL"))];
    expect(suggestSpares({ team: "HKFC B", sizes: sizes("L") }, spares, TEAMS).map((s) => s.shirtNo)).toEqual([45, 12, 150]);
    // More items that fit break a tie between two in the same range.
    const two = [spare(41, "HKFC B", sizes("L", { shorts: "S" })), spare(42, "HKFC B", sizes("L", { shorts: "M" }))];
    expect(suggestSpares({ team: "HKFC B", sizes: sizes("L", { shorts: "M" }) }, two, TEAMS)[0].shirtNo).toBe(42);
    // No shirt size on record: every spare, own range first.
    expect(suggestSpares({ team: "HKFC A", sizes: sizes(null) }, spares, TEAMS)[0].shirtNo).toBe(12);
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
      shirt_numbers: [{ id: "n1", shirt_no: 1, team_range: "HKFC A" }, { id: "n2", shirt_no: 2, team_range: "HKFC A" }, { id: "n3", shirt_no: 31, team_range: "HKFC B" }],
      people: [
        { id: "u1", api_id: "recA", preferred_name: "Al", given_names: "Alan", surname: "One", status: "Member", selected_team_sos: "HKFC A", shirt_number_id: "n1" },
        { id: "u2", api_id: "recB", preferred_name: null, given_names: "Bo", surname: "Two", status: "Applicant", selected_team_sos: "HKFC B", shirt_number_id: "n3" },
        { id: "u3", api_id: "recC", preferred_name: null, given_names: "Cy", surname: "Three", status: "Resigned", shirt_number_id: null },
      ],
      kit_sets_v: [
        { id: "k1", order_id: "o1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 1, team_range: "HKFC A", shirt: "L", shorts: "M", owner_id: "recA", owner_name: "Al One", holder_id: "recC", holder_name: "Cy Three" },
        { id: "k2", order_id: "o1", supplier: "Kukri", received_on: "2026-10-03", shirt_no: 2, team_range: "HKFC A", shirt: "XL", owner_id: null, holder_id: null },
      ],
      kit_sizes: [{ id: "z1", person_id: "u1", item: "shorts", size: "L" }],
    });
    const board = await getKitBoard(env, null);
    expect(board.teams).toEqual(["HKFC A", "HKFC B"]);
    expect(board.sets[0]).toMatchObject({ shirtNo: 1, owner: { id: "recA", name: "Al One", team: "HKFC A" }, holder: { name: "Cy Three" }, place: "with_holder", mismatches: ["Shorts: M, wants L"] });
    expect(board.sets[1]).toMatchObject({ shirtNo: 2, owner: null, place: "in_store" });
    // Members and applicants only; Bo has a number but nothing in this order.
    expect(board.people.map((p) => [p.name, p.shirtNo, p.hasSet])).toEqual([["Al One", 1, true], ["Bo Two", 31, false]]);
    const csv = await topUpCsv(env, null);
    expect(csv.count).toBe(1);
    expect(csv.csv.split("\r\n")[1]).toBe("Bo Two,Applicant,31,,,,,,HKFC B");
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
    expect(calls[0].url.searchParams.get("or")).toBe('(owner_id.eq."recPLAYER",holder_id.eq."recPLAYER")');
    // Nothing on Airtable, rather than an error on everyone's dashboard.
    expect(await getMyKit({ ...env, DATA_BACKEND: "airtable" }, player)).toMatchObject({ mine: null, holding: [] });
  });
});
