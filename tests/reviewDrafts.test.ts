import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { cleanDraft, DEFAULT_DRAFT_MODEL, draftContext, generateDrafts, type DraftSource } from "../worker/src/reviewDrafts";
import { draftsFor } from "../worker/src/reviews";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  OPENROUTER_API_KEY: "or_test",
  APP_ORIGIN: "https://app.test",
} as Env;

const source: DraftSource = {
  matches_played: 18, matches_team_played: 22, matches_not_available: 3, teams_played: ["HKFC D"],
  playing_position: "Defender", qualified_umpire: "Yes", games_umpired: "2", practices: "Moderate 50-70%",
  social_functions: ["End of Season"], other_contributions: "Team captain", section_service_member: "Coaching",
  hkfc_service_member: "Easter 5s", low_participation_reason: null,
  section_service_sponsor: "sponsor-view", hkfc_service_sponsor: null, recommendation_sponsor: "Supports",
};

type Call = { url: URL; method: string; body: any };
function fake(opts: { reply?: (i: number) => string; fail?: boolean } = {}) {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.host === "openrouter.ai") {
      if (opts.fail) return json({ error: { message: "no provider" } }, 404);
      return json({ choices: [{ message: { content: opts.reply?.(n++) ?? `Draft ${n++}` } }] });
    }
    if (url.pathname.endsWith("/api_reviews")) return json([source]);
    return json([]);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("review drafts", () => {
  it("builds the context from the review alone: attendance worked out, no names or emails", () => {
    const sponsorCtx = draftContext(source, false);
    expect(sponsorCtx).toContain("Match attendance (the requirement is 70% minimum):\n82%");
    expect(sponsorCtx).toContain("Team captain");
    expect(sponsorCtx).not.toContain("sponsor-view"); // the sponsor's own inputs are for the officer only
    expect(draftContext(source, true)).toContain("sponsor-view");
    expect(sponsorCtx).not.toMatch(/@|Name/);
  });

  it("asks the paid model, through providers that do not collect data, and stores the sponsor's three drafts", async () => {
    const calls = fake();
    expect(await generateDrafts(env, "recREVIEW00000000", "sponsor")).toBe(3);
    const asks = calls.filter((c) => c.url.host === "openrouter.ai");
    expect(asks).toHaveLength(3);
    expect(asks[0].body).toMatchObject({ model: DEFAULT_DRAFT_MODEL, provider: { data_collection: "deny" } });
    expect(asks[0].body.messages[0].content).toMatch(/You are a sponsor/);
    const saved = calls.find((c) => c.method === "PATCH" && c.url.pathname.endsWith("/commitments"))!;
    expect(saved.url.search).toContain("api_id=eq.recREVIEW00000000");
    expect(Object.keys(saved.body).sort()).toEqual(["drafts_generated_at", "drafts_model", "hkfc_service_draft", "recommendation_draft", "section_service_draft"]);
  });

  it("does nothing without a key, and writes nothing when the model fails", async () => {
    const calls = fake();
    expect(await generateDrafts({ ...env, OPENROUTER_API_KEY: undefined }, "recREVIEW00000000", "officer")).toBe(0);
    expect(calls).toHaveLength(0);
    const failing = fake({ fail: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await generateDrafts(env, "recREVIEW00000000", "officer")).toBe(0);
    expect(failing.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("sends an answer over its word limit back once, and keeps the shorter", async () => {
    const long = "Reliable defender with strong attendance, captaincy experience, and junior coaching availability strengthening the Section.";
    const calls = fake({ reply: (i) => (i === 0 ? long : i === 3 ? "Reliable defender and captain; strengthens the Section." : `Draft ${i}`) });
    await generateDrafts(env, "recREVIEW00000000", "officer");
    const asks = calls.filter((c) => c.url.host === "openrouter.ai");
    expect(asks).toHaveLength(4); // three drafts, one sent back
    const retry = asks.find((a) => a.body.messages.length === 4)!;
    expect(retry.body.messages[3].content).toMatch(/^That is 14 words\. Rewrite it as one sentence of 12 words or fewer\.$/);
    const saved = calls.find((c) => c.method === "PATCH")!;
    expect(saved.body.is_player_needed_draft).toBe("Reliable defender and captain; strengthens the Section.");
  });

  it("cleans the model's answer to fit the field", () => {
    expect(cleanDraft("<think>hmm</think> \"Strong contributor.\"", 260)).toBe("Strong contributor.");
    expect(cleanDraft("Nothing", 260)).toBe("");
    const long = "One sentence here. " + "word ".repeat(80);
    expect(cleanDraft(long, 60).length).toBeLessThanOrEqual(61);
  });

  it("gives each reviewer only their own step's drafts, by form field", () => {
    const row = { section_service_draft: "a", hkfc_service_draft: "", recommendation_draft: "c", is_player_needed_draft: "d" } as any;
    expect(draftsFor(row, "sponsor")).toEqual({ sectionService: "a", recommendation: "c" });
    expect(draftsFor(row, "officer")).toEqual({ isPlayerNeeded: "d" });
  });
});
