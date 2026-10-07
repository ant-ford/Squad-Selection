import { afterEach, describe, expect, it, vi } from "vitest";
import { getFormsDue } from "../worker/src/formsDue";
import type { Env } from "../worker/src/env";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "k" } as Env;

function fake(people: unknown[]) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    calls.push(new URL(input));
    return new Response(JSON.stringify(people), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const row = (api_id: string, more: Record<string, unknown>) => ({
  api_id, preferred_name: null, given_names: null, surname: null, mobile_no: null, status: "Member", waivers_signed_at: null, profile_updated_at: null, ...more,
});

describe("forms due (Membership, Forms tab)", () => {
  it("lists Active people without this season's waivers, and members who haven't checked their details", async () => {
    const calls = fake([
      row("recA", { preferred_name: "Sam", surname: "Lee", mobile_no: "+852 9000 0001", waivers_signed_at: "2026-06-30T10:00:00Z", profile_updated_at: "2026-08-01T00:00:00Z" }),
      row("recB", { given_names: "Tom Ka", surname: "Wu", waivers_signed_at: "2026-07-02T00:00:00Z", profile_updated_at: "2026-05-01T00:00:00Z" }),
      row("recC", { preferred_name: "Al", surname: "Ng", status: "Applicant" }),
      row("recD", { preferred_name: "Done", surname: "Zed", waivers_signed_at: "2026-09-01T00:00:00Z", profile_updated_at: "2026-09-01T00:00:00Z" }),
    ]);
    const due = await getFormsDue(env, new Date("2026-10-07T04:00:00Z"));
    expect(due.waivers).toEqual([
      { id: "recC", name: "Al Ng", firstName: "Al", mobile: "" },
      { id: "recA", name: "Sam Lee", firstName: "Sam", mobile: "+852 9000 0001" },
    ]);
    // An applicant isn't asked to check member details.
    expect(due.details.map((p) => p.id)).toEqual(["recB"]);
    expect(due.details[0]).toMatchObject({ name: "Tom Ka Wu", firstName: "Tom" });
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get("active")).toBe("is.true");
  });
});
