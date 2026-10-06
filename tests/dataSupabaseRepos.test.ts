import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { people } from "../worker/src/data/people";
import { matches } from "../worker/src/data/matches";
import { matchCards } from "../worker/src/data/matchCards";
import { availabilityExceptions } from "../worker/src/data/availabilityExceptions";
import { officers } from "../worker/src/data/officers";
import { fileLink, verifyFileLink } from "../worker/src/data/supabase/files";
import { handleFileRequest } from "../worker/src/files";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  API_ORIGIN: "https://api.test",
} as Env;

type Call = { url: URL; method: string; body: any };
function postgrest(respond: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const c = { url: new URL(input), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return new Response(JSON.stringify(respond(c) ?? []), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const playerRow = {
  id: "recP1", preferred_name: "Al", given_names: "Alex", surname: "Test", shirt_no_value: "7", email: "al@x.com",
  mobile_no: null, active: true, registered_team: "HKFC C", selected_team_sos: null, selected_team_eos: null,
  playing_position: "Defender", playing_ability: null, is_visiting_player: false, is_suspended: false, matches_to_serve: null,
  ever_registered_to_premier: false, u21_eligible: false, player_coach: [], section_rank: 12, rank_updated_at: null,
  status: "Member", applicant_stage: null, sports_background: null, selection_comments: null, opt_in_only: false,
  date_of_birth: "1990-05-17", photo_file_id: "11111111-2222-3333-4444-555555555555",
};

describe("Supabase repositories", () => {
  it("maps api_players rows as the Airtable mapper does, with the photo's file id (signed only where shown)", async () => {
    const calls = postgrest(() => [playerRow]);
    const [p] = await people(env).listActive();
    expect(calls[0].url.pathname).toBe("/rest/v1/api_players");
    expect(calls[0].url.searchParams.get("active")).toBe("is.true");
    expect(p).toMatchObject({ id: "recP1", preferredName: "Al", shirtNoValue: "7", sectionRank: 12, playingAbility: undefined, birthday: "05-17" });
    expect(p.photoFileId).toBe("11111111-2222-3333-4444-555555555555");
    expect(p.photo).toBeUndefined();
    expect(p.teamRank).toBeUndefined();
  });

  it("looks people up by lower-cased email", async () => {
    const calls = postgrest(() => [playerRow]);
    await people(env).findByEmail("  Al@X.COM ");
    expect(calls[0].url.searchParams.get("email_lower")).toBe("eq.al@x.com");
  });

  it("treats a blank stage or status as not Rejected / not Resigned, as Airtable's != does", async () => {
    const calls = postgrest(() => []);
    await people(env).listRankingPool();
    expect(calls[0].url.searchParams.get("and")).toBe(
      "(or(active.is.true,status.eq.Applicant),or(applicant_stage.is.null,applicant_stage.neq.Rejected),or(status.is.null,status.neq.Resigned))",
    );
  });

  it("writes a reorder as one transaction", async () => {
    const calls = postgrest(() => null);
    await people(env).updateMany([{ id: "recA", patch: { sectionRank: 1, rankUpdatedAt: "2026-09-29T00:00:00.000Z" } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/update_people_ranks");
    expect(calls[0].body).toEqual({ p: [{ id: "recA", sectionRank: 1, rankUpdatedAt: "2026-09-29T00:00:00.000Z" }] });
  });

  it("saves kit directly (blank as null) and selections through set_match_selection", async () => {
    const calls = postgrest((c) => (c.method === "PATCH" ? [{ id: "m" }] : null));
    await matches(env).update("recM1", { homeKit: "", selectedPlayersAway: ["recA", "recB"] });
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { home_kit: null } });
    expect(calls[0].url.searchParams.get("api_id")).toBe("eq.recM1");
    expect(calls[1].url.pathname).toBe("/rest/v1/rpc/set_match_selection");
    expect(calls[1].body).toEqual({ p_match: "recM1", p_side: "away", p_people: ["recA", "recB"] });
  });

  it("answers availability in one set_availability call and returns what it did", async () => {
    const outcome = {
      updated: 1,
      results: [{ matchId: "recM", exceptionId: "uuid-new" }],
      before: [],
      seasons: ["2026-2027"],
    };
    const calls = postgrest(() => outcome);
    const out = await availabilityExceptions(env).set({ matchIds: ["recM"], playerId: "recP", status: "Maybe", updatedById: "recC" });
    expect(out).toEqual(outcome);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/set_availability");
    expect(calls[0].body).toEqual({ p_player: "recP", p_matches: ["recM"], p_status: "Maybe", p_notes: null, p_updated_by: "recC" });
  });

  it("answers a whole day in one set_availability_for_date call", async () => {
    const calls = postgrest(() => ({ updated: 0, results: [], before: [], seasons: [] }));
    const out = await availabilityExceptions(env).setForDate({ playerId: "recP", date: "2026-10-10", status: "Unavailable", notes: "Away" });
    expect(out.results).toEqual([]);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/set_availability_for_date");
    expect(calls[0].body).toEqual({ p_player: "recP", p_date: "2026-10-10", p_status: "Unavailable", p_notes: "Away" });
  });

  it("returns offices in the order they were asked for", async () => {
    postgrest(() => [
      { id: "o2", office: "sectionChair", designation: "Chairman", status: "Active", member: "recB" },
      { id: "o1", office: "membershipOfficer", designation: null, status: "Active", member: "recA" },
    ]);
    const rows = await officers(env).listActive(["membershipOfficer", "sectionChair"]);
    expect(rows).toEqual([
      { office: "membershipOfficer", designation: "", memberIds: ["recA"] },
      { office: "sectionChair", designation: "Chairman", memberIds: ["recB"] },
    ]);
  });

  // Ported from airtableAccess.test.ts ("keeps Active rows only"): a Retired
  // office row grants nothing, but an application still names its signer.
  it("asks for Active office rows for access, and every row for who signs", async () => {
    const calls = postgrest(() => []);
    await officers(env).listActive(["membershipOfficer"]);
    await officers(env).listAllMembers(["membershipOfficer"]);
    expect(calls[0].url.searchParams.get("status")).toBe("eq.Active");
    expect(calls[1].url.searchParams.has("status")).toBe(false);
  });

  // Ported from airtableAccess.test.ts ("reads only carded appearances from
  // the previous season"): the suspension input needs only carded rows.
  it("narrows a season's match cards to carded appearances when asked", async () => {
    const calls = postgrest(() => []);
    await matchCards(env).listForSeason("2025-2026", { cardedOnly: true });
    await matchCards(env).listForSeason("2026-2027");
    expect(calls[0].url.searchParams.get("season")).toBe("eq.2025-2026");
    expect(calls[0].url.searchParams.get("cards")).toBe("neq.{}");
    expect(calls[1].url.searchParams.has("cards")).toBe(false);
  });
});

describe("signed file links", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("verifies its own links, and refuses expired or altered ones", async () => {
    const now = Date.UTC(2026, 8, 29, 10, 15);
    const url = new URL(await fileLink(env, id, now));
    const exp = url.searchParams.get("exp")!;
    const sig = url.searchParams.get("sig")!;
    expect(Number(exp) * 1000 - now).toBeGreaterThan(60 * 60 * 1000);
    expect(Number(exp) * 1000 - now).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
    expect(await verifyFileLink(env, id, exp, sig, now)).toBe(true);
    expect(await verifyFileLink(env, id, exp, sig, Number(exp) * 1000 + 1)).toBe(false);
    expect(await verifyFileLink(env, id, String(Number(exp) + 3600), sig, now)).toBe(false);
    expect(await verifyFileLink(env, "22222222-2222-3333-4444-555555555555", exp, sig, now)).toBe(false);
    expect(await verifyFileLink({ ...env, DATA_SUPABASE_SECRET_KEY: "other" }, id, exp, sig, now)).toBe(false);
  });

  it("serves the file for a valid link and a bare 404 otherwise", async () => {
    postgrest(() => [{ r2_key: "files/airtable/att1", content_type: "image/jpeg", filename: "Zoë Photo.jpg" }]);
    const files = { get: vi.fn(async () => ({ body: new Blob(["jpeg-bytes"]).stream() })) };
    const e = { ...env, FILES: files } as unknown as Env;
    const good = new URL(await fileLink(e, id));
    const ok = await handleFileRequest(e, id, good);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("Content-Disposition")).toBe('inline; filename="Zoe Photo.jpg"');
    expect(await ok.text()).toBe("jpeg-bytes");
    expect(files.get).toHaveBeenCalledWith("files/airtable/att1");

    good.searchParams.set("sig", "0".repeat(64));
    const bad = await handleFileRequest(e, id, good);
    expect(bad.status).toBe(404);
  });
});
