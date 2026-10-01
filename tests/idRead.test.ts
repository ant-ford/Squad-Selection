import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { parseReply, readIdDocument, toSuggestions } from "../worker/src/idRead";

const env = { DATA_BACKEND: "supabase", OPENROUTER_API_KEY: "or_test", APP_ORIGIN: "https://app.eddy.global" } as Env;
const user = { email: "a@x.com", personId: "recA", officerRoles: [] } as unknown as AuthorizedUser;
afterEach(() => vi.unstubAllGlobals());

describe("reading an HKID or passport", () => {
  it("keeps only values that pass their checks", () => {
    expect(
      toSuggestions({
        surname: "Chan", givenNames: "Tai Man", chineseName: "陳 大文", dateOfBirth: "1990-02-03", gender: "M",
        hkidNo: "a1234563", passportNo: null, nationality: "british",
      }),
    ).toEqual({ surname: "Chan", givenNames: "Tai Man", chineseName: "陳大文", dateOfBirth: "1990-02-03", gender: "Male", hkidNo: "A123456(3)", nationality: "British" });
    // A wrong check digit, an impossible date, Latin letters as a Chinese name and "null" strings are dropped.
    expect(toSuggestions({ hkidNo: "A123456(7)", dateOfBirth: "1990-13-01", chineseName: "Chan", surname: "null", passportNo: "k 123 4567" })).toEqual({ passportNo: "K1234567" });
    expect(toSuggestions(null)).toEqual({});
    expect(parseReply('Here you go:\n```json\n{"surname": "Lee"}\n```')).toEqual({ surname: "Lee" });
    expect(parseReply("no json")).toBeNull();
  });

  it("sends the picture to a no-data-collection provider and takes only photos", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"surname":"Lee","passportNo":"K1234567"}' } }] }), { status: 200 });
    }));
    const out = await readIdDocument(env, user, { kind: "passport", dataUrl: "data:image/jpeg;base64,AAAA" });
    expect(out.suggestions).toEqual({ surname: "Lee", passportNo: "K1234567" });
    expect(calls[0].provider).toEqual({ data_collection: "deny" });
    expect(calls[0].messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    await expect(readIdDocument(env, user, { kind: "hkid", dataUrl: "data:application/pdf;base64,AAAA" })).rejects.toThrow(/photo/);
    await expect(readIdDocument(env, user, { kind: "other", dataUrl: "data:image/jpeg;base64,AAAA" })).rejects.toThrow(/Unknown/);
  });
});
