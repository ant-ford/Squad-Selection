import { describe, it, expect } from "vitest";
import worker from "../legacy-redirect/index";

// Deployed to the OLD Cloudflare account to rescue anyone still holding the
// retired workers.dev address. A plain redirect only reaches half of them:
// players who installed the app have a service worker answering navigations
// from its own cache, so the network is never asked and no redirect lands.

const call = (path: string) =>
  worker.fetch(new Request(`https://hkfc-squad-selection.squad-selections.workers.dev${path}`));

describe("legacy redirect worker", () => {
  it("sends the bare hostname to the new app", async () => {
    const res = await call("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.eddy.global/");
  });

  it("keeps the path, so a deep link still lands where it meant to", async () => {
    const res = await call("/coach/ranking");
    expect(res.headers.get("location")).toBe("https://app.eddy.global/coach/ranking");
  });

  it("keeps the query string", async () => {
    const res = await call("/coach?team=A&past=1");
    expect(res.headers.get("location")).toBe("https://app.eddy.global/coach?team=A&past=1");
  });

  // 302, not 301: a permanent redirect is cached hard by browsers and this
  // hostname has already changed hands once.
  it("redirects temporarily rather than permanently", async () => {
    expect((await call("/")).status).toBe(302);
  });

  describe("/sw.js - the part that rescues an installed app", () => {
    it("is served as JavaScript, or the browser will not run it", async () => {
      const res = await call("/sw.js");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/javascript");
    });

    it("is never cached, since it only works when actually fetched", async () => {
      const res = await call("/sw.js");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("takes over immediately, clears the caches and unregisters itself", async () => {
      const body = await (await call("/sw.js")).text();
      expect(body).toContain("skipWaiting");
      expect(body).toContain("caches.delete");
      expect(body).toContain("registration.unregister");
    });

    it("sends any window still open to the new address", async () => {
      const body = await (await call("/sw.js")).text();
      expect(body).toContain("https://app.eddy.global/");
      expect(body).toContain("client.navigate");
    });

    it("is not itself redirected away", async () => {
      const res = await call("/sw.js");
      expect(res.status).not.toBe(302);
    });
  });
});
