import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { DirectoryPerson } from "../shared/emailLists";
import { matches } from "../shared/emailLists";
import { EVENT_ROLES, MEETING_PRESETS } from "../shared/events";

const entries: DirectoryPerson[] = ["captain", "section", "director", "convenor", "member", "kit", "retired-team", "interest"].map((id) => ({
  id, name: id, surname: id, values: { active: ["Not an active player"], captaincyInterest: ["Yes"] },
  emails: [], emailSource: "none", under18: false,
}));
vi.mock("../worker/src/chairman", () => ({
  getChairmanDirectory: async () => ({ people: entries }),
  getDirectoryPerson: async (_env: unknown, id: string) => entries.find((p) => p.id === id) ?? null,
}));
import { eventDirectory, eventDirectoryPerson } from "../worker/src/events/audience";

const env = { DATA_SUPABASE_URL: "https://example.supabase.co", DATA_SUPABASE_SECRET_KEY: "test" } as Env;
const office = (id: string, role: string) => ({ people: { api_id: id }, role });
const link = (id: string, role: string, active: boolean) => ({ ...office(id, role), teams: { active } });
afterEach(() => vi.unstubAllGlobals());

describe("current meeting appointments", () => {
  it("matches actual offices and active team captains, deduplicates holders and leaves interests out", async () => {
    const queries: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      queries.push(url);
      const all = url.pathname.endsWith("/offices")
        ? [office("section", "section_captain"), office("director", "assistant_director"), office("convenor", "hockey_convenor"), office("member", "membership_officer"), office("kit", "kit_convenor")]
        : [link("captain", "team_captain", true), link("captain", "team_captain", true), link("section", "section_captain", false), link("retired-team", "team_captain", false)];
      const id = url.searchParams.get("people.api_id")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(id ? all.filter((r) => r.people.api_id === id) : all));
    });
    const dir = await eventDirectory(env);
    expect(dir.filter((p) => matches(p, MEETING_PRESETS[0].audience)).map((p) => p.id)).toEqual(["captain", "section", "director"]);
    expect(dir.filter((p) => matches(p, MEETING_PRESETS[1].audience)).map((p) => p.id)).toEqual(["section", "convenor", "member"]);
    expect(dir.find((p) => p.id === "captain")?.values.eventRoles).toEqual([EVENT_ROLES.team_captain]);
    expect(queries.find((q) => q.pathname.endsWith("/offices"))?.searchParams.get("status")).toBe("eq.Active");
    expect((await eventDirectoryPerson(env, "captain"))?.values.eventRoles).toEqual([EVENT_ROLES.team_captain]);
    expect(queries.slice(-2).every((q) => q.searchParams.get("people.api_id") === "eq.captain")).toBe(true);
    expect(await eventDirectoryPerson(env, "missing")).toBeNull();
  });
});
