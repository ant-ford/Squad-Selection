import { afterEach, describe, expect, it, vi } from "vitest";
import { fillMessage } from "../shared/messageTemplates";
import { listTemplates, logMessage } from "../worker/src/messages";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "k" } as Env;
const coach = { personId: "recC", role: "coach", officerRoles: [] } as unknown as AuthorizedUser;
const player = { personId: "recP", role: "player", officerRoles: [] } as unknown as AuthorizedUser;

function fake(tables: Record<string, unknown>) {
  const calls: { url: URL; method: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const t = tables[url.pathname.split("/").pop()!];
    return new Response(JSON.stringify(t ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp these people", () => {
  it("fills in the person's name from either placeholder, and leaves others for the sender", () => {
    expect(fillMessage("Hi {first name}, see you", { firstName: "Sam" })).toBe("Hi Sam, see you");
    expect(fillMessage("Hey {{Preferred Name}}, trials {{17th: Start Pitch}}", { firstName: "Sam" })).toBe("Hey Sam, trials {{17th: Start Pitch}}");
    expect(fillMessage("Hi {first name}", { name: "Tom Wu" })).toBe("Hi Tom");
  });

  it("is for officers and coaches only", async () => {
    fake({});
    await expect(listTemplates(env, player)).rejects.toMatchObject({ status: 403 });
    await expect(logMessage(env, player, { personId: "recX", message: "hi" })).rejects.toMatchObject({ status: 403 });
  });

  it("logs the message with the mobile on record, not one from the browser", async () => {
    const calls = fake({ people: [{ id: "uuid-x", mobile_no: "+852 9000 0000" }] });
    await logMessage(env, coach, { personId: "recX", message: "Hi Sam", mobile: "+852 1111 1111", templateId: "not-a-uuid" });
    const insert = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/message_log"))!;
    expect(insert.body).toEqual([expect.objectContaining({ person_id: "uuid-x", message: "Hi Sam", mobile_no: "+852 9000 0000", template_id: null })]);
  });
});
