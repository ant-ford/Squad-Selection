import { describe, it, expect, vi } from "vitest";
import { logAuthPerf, logRequestPerf } from "../worker/src/perf";

/**
 * Captures console.log while `fn` runs and restores it reliably, even when
 * an assertion inside the test body fails afterwards.
 */
function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

describe("telemetry output", () => {
  it("logAuthPerf emits structured perf.auth JSON with timing and cache fields", () => {
    const lines = captureLog(() =>
      logAuthPerf({
        supabaseMs: 1,
        playerMs: 2,
        coachLinksMs: 3,
        coachLinksFromCache: true,
        personId: "recP1",
        role: "coach",
      }),
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("perf.auth");
    expect(parsed.supabaseMs).toBe(1);
    expect(parsed.playerMs).toBe(2);
    expect(parsed.coachLinksMs).toBe(3);
    expect(parsed.coachLinksFromCache).toBe(true);
    expect(parsed.personId).toBe("recP1");
    expect(parsed.role).toBe("coach");
  });

  it("logRequestPerf emits structured perf.request JSON with all request fields", () => {
    const lines = captureLog(() =>
      logRequestPerf({
        method: "GET",
        path: "/api/my-profile",
        status: 200,
        totalMs: 42,
        airtableCalls: 5,
      }),
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("perf.request");
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/api/my-profile");
    expect(parsed.status).toBe(200);
    expect(parsed.totalMs).toBe(42);
    expect(parsed.airtableCalls).toBe(5);
  });
});
