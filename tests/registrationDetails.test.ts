import { afterEach, describe, expect, it, vi } from "vitest";
import { signedIn } from "./helpers/factories";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getRegistrationBoard, parseDetailsChange, saveRegistrationDetails } from "../worker/src/registration";
import { missingDetails, suggestRegisteredName, tidyRegisteredName, type RegistrationPlayer } from "../shared/registration";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  API_ORIGIN: "https://api.example",
} as Env;
const convenor = {
  email: "c@x.com", personId: "recCONVENOR", personUuid: "00000000-0000-4000-8000-000000000009", role: "player", coachTeams: [], isSectionCaptain: false,
  officerRoles: [{ office: "hockeyConvenor", designation: "" }],
} as unknown as AuthorizedUser;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Call = { url: URL; method: string; body: any };
/** PostgREST over fetch: answers come from `answer(table, method, url)`; anything unanswered is an empty list. */
function fake(answer: (table: string, method: string, url: URL) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const body = answer(url.pathname.split("/").pop()!, method, url) ?? [];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const calls = (all: Call[], table: string, method: string) => all.filter((c) => c.url.pathname.endsWith(`/${table}`) && c.method === method);

/** People reads: the player being saved, the actor, and whoever else holds a name. */
const people = (me: Record<string, unknown> | null, holders: unknown[] = []) => (method: string, url: URL) => {
  if (method !== "GET") return [];
  if (url.searchParams.get("api_id") === "eq.recCONVENOR") return [{ id: U(9) }];
  if (url.searchParams.has("registered_name")) return holders;
  return me ? [me] : [];
};
const sam = { id: U(1), registered_name: null, is_visiting_player: false };

describe("Registered Name suggestion", () => {
  it("is SURNAME Given Names, as existing ones are", () => {
    expect(suggestRegisteredName("Lee", "Sam")).toBe("LEE Sam");
    expect(suggestRegisteredName("van  Zundert ", " Jonas Luca")).toBe("VAN ZUNDERT Jonas Luca");
    expect(suggestRegisteredName("Lee", null)).toBe("LEE");
    expect(suggestRegisteredName(null, "Sam")).toBeNull();
    expect(suggestRegisteredName("  ", "Sam")).toBeNull();
  });

  it("tidies spaces the way hkha-sync stores a card's name", () => {
    expect(tidyRegisteredName("  LEE  Sam  Tak ")).toBe("LEE Sam Tak");
  });

  it("flags a shared name among the missing details", () => {
    const p = {
      id: "rec1", name: "Sam Lee", team: "HKFC C", previousEos: "HKFC C", shirtNo: 5, registeredName: "LEE Sam", surname: "Lee", givenNames: "Sam",
      chineseName: null, hkidNo: "A123456(7)", passportNo: null, dateOfBirth: "1990-01-01", nationality: "British", mobileNo: null, email: null,
      files: { photo: "https://f/1", hkid: "https://f/2", passport: null, u18Form: null }, registeredAt: null, reason: null, reasonDetail: null,
    } satisfies RegistrationPlayer;
    expect(missingDetails({ ...p, nameShared: true }, "2026-10-06")).toEqual(["Unique registered name"]);
    expect(missingDetails({ ...p, registeredName: null, nameShared: true }, "2026-10-06")).toEqual(["Registered name"]);
  });
});

describe("saving registration details", () => {
  it("validates what the screen sends", () => {
    expect(parseDetailsChange({ id: "rec1", registeredName: "  LEE Sam ", visiting: true })).toEqual({ id: "rec1", registeredName: "LEE Sam", visiting: true });
    expect(parseDetailsChange({ id: "rec1", registeredName: "" })).toEqual({ id: "rec1", registeredName: null });
    expect(parseDetailsChange({ id: "rec1", registeredName: null })).toEqual({ id: "rec1", registeredName: null });
    expect(parseDetailsChange({ id: "rec1", registeredName: "O'NEILL Seán-Paul (Jr.)" }).registeredName).toBe("O'NEILL Seán-Paul (Jr.)");
    expect(parseDetailsChange({ id: "rec1", registeredName: "陳 大文" }).registeredName).toBe("陳 大文");
    for (const bad of ["LEE*", "LEE%", "LEE_Sam", "LEE 7", "=LEE", "-LEE"]) {
      expect(() => parseDetailsChange({ id: "rec1", registeredName: bad }), bad).toThrow(/letters/);
    }
    expect(() => parseDetailsChange({ id: "rec1", registeredName: "A".repeat(81) })).toThrow(/at most 80/);
    expect(() => parseDetailsChange({ id: "rec1", registeredName: 7 })).toThrow(/text/);
    expect(() => parseDetailsChange({ id: "rec1", visiting: "yes" })).toThrow(/on or off/);
    expect(() => parseDetailsChange({ id: "rec1" })).toThrow(/Nothing to save/);
    expect(() => parseDetailsChange({ id: "bad id!", visiting: true })).toThrow(/Choose a player/);
  });

  it("saves a name, links this season's cards that carry it, and logs the field name only", async () => {
    const all = fake((table, method, url) =>
      table === "people" ? people(sam)(method, url) : table === "link_match_cards_by_name" ? 3 : [],
    );
    const r = await saveRegistrationDetails(env, convenor, { id: "rec1", registeredName: "LEE  Sam" });
    expect(r).toEqual({ ok: true, linked: 3 });
    const clash = calls(all, "people", "GET").find((c) => c.url.searchParams.has("registered_name"))!;
    expect(clash.url.searchParams.get("registered_name")).toBe("ilike.LEE Sam");
    expect(clash.url.searchParams.get("id")).toBe(`neq.${U(1)}`);
    const patch = calls(all, "people", "PATCH")[0];
    expect(patch.url.searchParams.get("id")).toBe(`eq.${U(1)}`);
    expect(patch.body).toEqual({ registered_name: "LEE Sam" });
    expect(calls(all, "link_match_cards_by_name", "POST")[0].body).toEqual({ p_name: "LEE Sam" });
    const log = calls(all, "activity_log", "POST")[0].body;
    expect(log).toEqual([{ actor_person_id: U(9), action: "registration-details", entity: "people", entity_id: U(1), fields: ["registered_name"] }]);
  });

  it("only touches Active players", async () => {
    fake((table, method, url) => (table === "people" ? people(null)(method, url) : []));
    await expect(saveRegistrationDetails(env, convenor, { id: "rec1", visiting: true })).rejects.toMatchObject({ status: 404 });
    const all = fake((table, method, url) => (table === "people" ? people(sam)(method, url) : []));
    await saveRegistrationDetails(env, convenor, { id: "rec1", visiting: true });
    expect(calls(all, "people", "GET")[0].url.searchParams.get("active")).toBe("is.true");
  });

  it("refuses a name another person already has, and saves nothing", async () => {
    const holder = { id: U(2), preferred_name: "Sammy", given_names: "Sam", surname: "Lee", active: false };
    const all = fake((table, method, url) => (table === "people" ? people(sam, [holder])(method, url) : []));
    await expect(saveRegistrationDetails(env, convenor, { id: "rec1", registeredName: "LEE Sam" })).rejects.toMatchObject({
      status: 409,
      message: "Sammy Lee (not active) already has this registered name.",
    });
    expect(calls(all, "people", "PATCH")).toHaveLength(0);
    expect(calls(all, "link_match_cards_by_name", "POST")).toHaveLength(0);
  });

  it("changes only the case of his own name without a clash check", async () => {
    const all = fake((table, method, url) => (table === "people" ? people({ ...sam, registered_name: "Lee Sam" })(method, url) : table === "link_match_cards_by_name" ? 0 : []));
    expect(await saveRegistrationDetails(env, convenor, { id: "rec1", registeredName: "LEE Sam" })).toEqual({ ok: true, linked: 0 });
    expect(calls(all, "people", "GET").some((c) => c.url.searchParams.has("registered_name"))).toBe(false);
    expect(calls(all, "people", "PATCH")[0].body).toEqual({ registered_name: "LEE Sam" });
  });

  it("sets the visiting flag on its own: no name check, no card linking", async () => {
    const all = fake((table, method, url) => (table === "people" ? people(sam)(method, url) : []));
    expect(await saveRegistrationDetails(env, convenor, { id: "rec1", visiting: true })).toEqual({ ok: true, linked: 0 });
    expect(calls(all, "people", "PATCH")[0].body).toEqual({ is_visiting_player: true });
    expect(calls(all, "link_match_cards_by_name", "POST")).toHaveLength(0);
    expect(calls(all, "activity_log", "POST")[0].body[0].fields).toEqual(["is_visiting_player"]);
  });

  it("clears a name without linking anything", async () => {
    const all = fake((table, method, url) => (table === "people" ? people({ ...sam, registered_name: "LEE Sam" })(method, url) : []));
    await saveRegistrationDetails(env, convenor, { id: "rec1", registeredName: "" });
    expect(calls(all, "people", "PATCH")[0].body).toEqual({ registered_name: null });
    expect(calls(all, "link_match_cards_by_name", "POST")).toHaveLength(0);
  });

  it("writes nothing when nothing changed", async () => {
    const all = fake((table, method, url) => (table === "people" ? people({ ...sam, registered_name: "LEE Sam", is_visiting_player: true })(method, url) : []));
    expect(await saveRegistrationDetails(env, convenor, { id: "rec1", registeredName: "LEE Sam", visiting: true })).toEqual({ ok: true, linked: 0 });
    expect(all.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
});

describe("the board", () => {
  it("carries the visiting flag and marks names two Active players share", async () => {
    const person = (n: number, more: Record<string, unknown>) => ({
      id: U(n), api_id: `rec${n}`, preferred_name: null, given_names: "Sam", surname: `S${n}`, registered_name: null, chinese_name: null,
      date_of_birth: null, hkid_no: null, passport_no: null, nationality: null, mobile_no: null, email: null, registered_team: "HKFC B",
      previous_eos: "HKFC B", shirt: null, ...more,
    });
    fake((table) =>
      table === "people"
        ? [
            person(1, { registered_name: "LEE Sam", is_visiting_player: true }),
            person(2, { registered_name: " lee sam" }),
            person(3, { registered_name: "CHAN Sam" }),
          ]
        : [],
    );
    const board = await getRegistrationBoard(env);
    expect(board.players.map((p) => [p.id, p.nameShared, p.visiting])).toEqual([
      ["rec1", true, true],
      ["rec2", true, false],
      ["rec3", false, false],
    ]);
  });
});
