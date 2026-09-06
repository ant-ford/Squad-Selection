import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Airtable client resilience (worker/src/airtable.ts)
//
// Bug fix: a 429 used to fail the request immediately. Now it retries,
// honouring Retry-After, up to a maximum of 2 retries before throwing.
// ---------------------------------------------------------------------------

import { airtableFindById, AirtableError } from "../worker/src/airtable";

const ENV = { AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "test-base" } as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("airtableFetch 429 retry", () => {
  it("retries once on 429 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(jsonResponse("Rate limited", 429, { "Retry-After": "1" }));
      }
      return Promise.resolve(jsonResponse({ id: "recX", fields: { Name: "ok" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = airtableFindById(ENV, "People", "recX");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(calls).toBe(2);
    expect(result).toMatchObject({ id: "recX" });
  });

  it("gives up after the maximum retries and throws AirtableError", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      return Promise.resolve(jsonResponse("Rate limited", 429, { "Retry-After": "0.001" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = airtableFindById(ENV, "People", "recX").catch((e) => e);
    // Up to 2 retries -> 3 attempts total, each waiting out its Retry-After.
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(calls).toBe(3);
    expect(result).toBeInstanceOf(AirtableError);
    expect((result as AirtableError).status).toBe(429);
  });

  it("does not retry non-429 failures", async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      return Promise.resolve(jsonResponse("Server error", 500));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(airtableFindById(ENV, "People", "recX")).rejects.toBeInstanceOf(AirtableError);
    expect(calls).toBe(1);
  });
});
