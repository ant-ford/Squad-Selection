import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What a crash report says about the error (src/lib/clientErrors.ts). A
// rejected value that isn't an Error can be anything, a request body
// included, so only its type is reported.

const getSession = vi.hoisted(() => vi.fn(async () => ({ data: { session: { access_token: 'test-session' } } })));
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

import { describeError } from "../src/lib/clientErrors";
import { browserInfo } from "../src/lib/browserInfo";

describe("describeError", () => {
  it("keeps an Error's name, message and stack", () => {
    const err = new TypeError("x is undefined");
    expect(describeError(err)).toEqual({ message: "TypeError: x is undefined", stack: err.stack });
  });

  it("keeps a string as it is", () => {
    expect(describeError("boom")).toEqual({ message: "boom", stack: "" });
  });

  it("names any other value by its type, never its contents", () => {
    const body = { email: "someone@hkfc.com", hkid: "A123456(7)", mobile: "91234567" };
    const { message } = describeError(body);
    expect(message).toBe("Non-Error Object");
    expect(message).not.toMatch(/hkfc|A123456|9123/);
    expect(describeError(new Map([["k", "v"]])).message).toBe("Non-Error Map");
    expect(describeError(42).message).toBe("Non-Error number");
    expect(describeError(Object.create(null)).message).toBe("Non-Error Object");
    expect(describeError(undefined).message).toBe("undefined");
  });
});

describe('browser metadata', () => {
  it.each([
    ['Mozilla/5.0 Version/17.6 Mobile/15 Safari/604.1', 'Safari 17'],
    ['Chrome/131.0.6778.1 Safari/537.36', 'Chrome 131'],
    ['Chrome/131.0 Safari/537.36 Edg/131.0', 'Edge 131'],
    ['Mozilla/5.0 FxiOS/132.0 Mobile/15 Safari/605.1', 'Firefox 132'],
    ['CriOS/131.0 Mobile/15 Safari/604.1', 'Chrome 131'],
    ['unknown device details', undefined],
  ])('retains only family and major version for %s', (ua, expected) => {
    expect(browserInfo(ua)).toBe(expected);
  });
});

describe('reporting a crash', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { pathname: '/coach' } });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Version/17.6 Mobile/15 Safari/604.1' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('includes the build and limited browser metadata', async () => {
    const { reportClientError } = await import('../src/lib/clientErrors');
    reportClientError('route', new Error('boom'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const request = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ build: 'dev', browser: 'Safari 17', route: '/coach' });
    expect(body).not.toHaveProperty('userAgent');
    expect(String(request.body)).not.toContain('Mobile/15');
  });

  it('skips recovering chunks but records an unrecovered failure once across listeners', async () => {
    const { reportClientError, reportUnrecoveredScreenLoad } = await import('../src/lib/clientErrors');
    const failure = new TypeError('Failed to fetch dynamically imported module');
    reportClientError('rejection', failure);
    expect(fetch).not.toHaveBeenCalled();
    reportUnrecoveredScreenLoad(failure);
    reportUnrecoveredScreenLoad(failure);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body)).message).toContain('Failed to fetch');
  });
});
