// ---------------------------------------------------------------------------
// The frontend Worker's front door.
//
// Static assets are matched and served before this script runs, so every
// request it sees is one that matched no file in dist/. Two very different
// things arrive that way and they must not be answered the same:
//
//   a missing hashed build file -> 404
//   a client-side route         -> the app shell
//
// Answering the first with index.html is what left the app stuck on its
// loading skeleton: the browser was handed HTML where it expected a
// JavaScript module, so the lazy route never resolved and nothing threw an
// error the app could act on.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import worker from "../web-shell/index";

const SHELL_HTML = "<!doctype html><html><body>app shell</body></html>";

/** Stands in for the ASSETS binding, recording what the Worker asked it for. */
function fakeAssets() {
  const requested: string[] = [];
  return {
    requested,
    binding: {
      fetch: async (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return new Response(SHELL_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

const call = (path: string, assets = fakeAssets()) => ({
  assets,
  response: worker.fetch(
    new Request(`https://app.eddy.global${path}`),
    { ASSETS: assets.binding } as never,
  ),
});

describe("frontend Worker front door", () => {
  describe("missing build output", () => {
    it("404s a hashed asset that no longer exists", async () => {
      const { response } = call("/assets/index-OldHash1.js");
      const res = await response;
      expect(res.status).toBe(404);
    });

    it("never answers a missing asset with HTML", async () => {
      const { response } = call("/assets/CoachDashboard-Gone1234.js");
      const res = await response;
      expect(res.headers.get("Content-Type")).not.toContain("text/html");
      expect(await res.text()).not.toContain("<!doctype html");
    });

    it("does not consult the assets binding at all for a missing asset", async () => {
      const { assets, response } = call("/assets/nope-12345678.js");
      await response;
      expect(assets.requested).toEqual([]);
    });

    it("does not let the 404 be cached, since a later deploy may create that file", async () => {
      const { response } = call("/assets/index-OldHash1.js");
      const res = await response;
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("covers CSS as well as JavaScript", async () => {
      const { response } = call("/assets/index-OldHash1.css");
      expect((await response).status).toBe(404);
    });
  });

  describe("client-side routes", () => {
    it("serves the app shell for a deep link", async () => {
      const { assets, response } = call("/coach/ranking");
      const res = await response;
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("app shell");
      expect(assets.requested).toEqual(["/index.html"]);
    });

    it("serves the app shell at the root", async () => {
      const { assets, response } = call("/");
      expect((await response).status).toBe(200);
      expect(assets.requested).toEqual(["/index.html"]);
    });

    it("serves the app shell for a match deep link", async () => {
      const { assets, response } = call("/coach/match/recABC123");
      expect((await response).status).toBe(200);
      expect(assets.requested).toEqual(["/index.html"]);
    });

    it("does not mistake a path merely containing 'assets' for build output", async () => {
      const { assets, response } = call("/coach/assets-report");
      expect((await response).status).toBe(200);
      expect(assets.requested).toEqual(["/index.html"]);
    });
  });

  it("passes the shell response through untouched", async () => {
    const assets = fakeAssets();
    const spy = vi.spyOn(assets.binding, "fetch");
    const res = await worker.fetch(
      new Request("https://app.eddy.global/coach"),
      { ASSETS: assets.binding } as never,
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});
