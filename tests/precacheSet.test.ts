import { describe, expect, it } from "vitest";
import { filterPrecacheManifest, precacheSet, type PrecacheChunk, type PrecacheGraph } from "../scripts/precache-set";

// A hand-made bundle shaped like Eddy's: an entry chunk holding main.tsx,
// App.tsx and the static player pages, vendor chunks, lazy routes imported
// from App.tsx, and sheets the player page opens with import().
const APP = "/src/App.tsx";
const LOGIN = "/src/pages/Login.tsx";
const PLAYER = "/src/pages/PlayerDashboard.tsx";
const ACCESS = "/src/components/AccessNotActive.tsx";
const rules = { roots: [LOGIN, PLAYER, ACCESS], routeTable: APP };

function chunk(fileName: string, moduleIds: string[], more: Partial<PrecacheChunk> = {}): PrecacheChunk {
  return { fileName, isEntry: false, moduleIds, imports: [], css: [], ...more };
}

function bundle(): PrecacheGraph {
  return {
    chunks: [
      chunk("assets/index-aaaa1111.js", ["/src/main.tsx", APP, LOGIN, PLAYER, ACCESS, "/src/components/HeaderMenus.tsx"], {
        isEntry: true,
        imports: ["assets/vendor-react-bbbb2222.js", "assets/vendor-router-cccc3333.js"],
        css: ["assets/index-dddd4444.css"],
      }),
      chunk("assets/vendor-react-bbbb2222.js", ["/node_modules/react/index.js"]),
      chunk("assets/vendor-router-cccc3333.js", ["/node_modules/react-router/index.js"], {
        imports: ["assets/vendor-react-bbbb2222.js"],
      }),
      // Officer and coach screens, lazy routes in App.tsx.
      chunk("assets/PlayerRanking-eeee5555.js", ["/src/pages/PlayerRanking.tsx"], {
        imports: ["assets/vendor-dnd-ffff6666.js"],
        css: ["assets/PlayerRanking-gggg7777.css"],
      }),
      chunk("assets/vendor-dnd-ffff6666.js", ["/node_modules/@dnd-kit/core/index.js"]),
      chunk("assets/MembershipBoard-hhhh8888.js", ["/src/pages/MembershipBoard.tsx"]),
      // Lazy inside a route that is left out, so left out too.
      chunk("assets/StatementsBoard-iiii9999.js", ["/src/components/membership/StatementsBoard.tsx"]),
      // Sheets the player page opens.
      chunk("assets/SeasonStatsSheet-jjjj0000.js", ["/src/components/SeasonStatsSheet.tsx"], {
        imports: ["assets/chevron-right-kkkk1111.js"],
      }),
      chunk("assets/chevron-right-kkkk1111.js", ["/node_modules/lucide-react/icons/chevron-right.mjs"]),
      chunk("assets/HeaderDropMenu-llll2222.js", ["/src/components/HeaderDropMenu.tsx"], {
        imports: ["assets/dropdown-menu-mmmm3333.js"],
      }),
      chunk("assets/dropdown-menu-mmmm3333.js", ["/node_modules/@radix-ui/react-dropdown-menu/index.mjs"]),
    ],
    dynamicImports: new Map([
      [APP, ["/src/pages/PlayerRanking.tsx", "/src/pages/MembershipBoard.tsx"]],
      ["/src/pages/MembershipBoard.tsx", ["/src/components/membership/StatementsBoard.tsx"]],
      [PLAYER, ["/src/components/SeasonStatsSheet.tsx"]],
      ["/src/components/HeaderMenus.tsx", ["/src/components/HeaderDropMenu.tsx"]],
    ]),
  };
}

describe("precacheSet", () => {
  it("includes the entry chunk, its CSS and its static imports, transitively", () => {
    const set = precacheSet(bundle(), rules);
    expect(set).toContain("assets/index-aaaa1111.js");
    expect(set).toContain("assets/index-dddd4444.css");
    expect(set).toContain("assets/vendor-react-bbbb2222.js");
    expect(set).toContain("assets/vendor-router-cccc3333.js");
  });

  it("leaves out the screens App.tsx imports lazily, and what only they load", () => {
    const set = precacheSet(bundle(), rules);
    for (const file of [
      "assets/PlayerRanking-eeee5555.js",
      "assets/PlayerRanking-gggg7777.css",
      "assets/vendor-dnd-ffff6666.js",
      "assets/MembershipBoard-hhhh8888.js",
      "assets/StatementsBoard-iiii9999.js",
    ]) {
      expect(set).not.toContain(file);
    }
  });

  it("includes sheets and menus the player view loads with import(), with their imports", () => {
    const set = precacheSet(bundle(), rules);
    expect(set).toContain("assets/SeasonStatsSheet-jjjj0000.js");
    expect(set).toContain("assets/chevron-right-kkkk1111.js");
    expect(set).toContain("assets/HeaderDropMenu-llll2222.js");
    expect(set).toContain("assets/dropdown-menu-mmmm3333.js");
  });

  it("still includes Login and Player view when App.tsx imports them lazily", () => {
    const graph = bundle();
    const entry = graph.chunks[0];
    const chunks = [
      { ...entry, moduleIds: entry.moduleIds.filter((id) => id !== LOGIN && id !== PLAYER) },
      ...graph.chunks.slice(1),
      chunk("assets/Login-nnnn4444.js", [LOGIN], { css: ["assets/Login-oooo5555.css"] }),
      chunk("assets/PlayerDashboard-pppp6666.js", [PLAYER], { imports: ["assets/vendor-react-bbbb2222.js"] }),
    ];
    const dynamicImports = new Map(graph.dynamicImports);
    dynamicImports.set(APP, [...dynamicImports.get(APP)!, LOGIN, PLAYER]);

    const set = precacheSet({ chunks, dynamicImports }, rules);
    expect(set).toContain("assets/Login-nnnn4444.js");
    expect(set).toContain("assets/Login-oooo5555.css");
    expect(set).toContain("assets/PlayerDashboard-pppp6666.js");
    // ...and what Player view opens from there.
    expect(set).toContain("assets/SeasonStatsSheet-jjjj0000.js");
    expect(set).not.toContain("assets/PlayerRanking-eeee5555.js");
  });

  it("throws when there is no entry chunk", () => {
    const graph = bundle();
    const chunks = graph.chunks.map((c) => ({ ...c, isEntry: false }));
    expect(() => precacheSet({ ...graph, chunks }, rules)).toThrow(/entry chunk/);
    expect(() => precacheSet({ chunks: [], dynamicImports: new Map() }, rules)).toThrow(/entry chunk/);
  });

  it("throws when a player-view module is missing (renamed or moved)", () => {
    expect(() => precacheSet(bundle(), { ...rules, roots: [...rules.roots, "/src/pages/Gone.tsx"] })).toThrow(
      /Gone\.tsx is not in the bundle/,
    );
  });
});

describe("filterPrecacheManifest", () => {
  const manifest = [
    { url: "index.html", revision: "1" },
    { url: "registerSW.js", revision: "2" },
    { url: "manifest.webmanifest", revision: "3" },
    { url: "assets/favicon.svg", revision: "4" },
    { url: "assets/open-sans-latin-wght-normal-qqqq7777.woff2", revision: null },
    { url: "assets/index-aaaa1111.js", revision: null },
    { url: "assets/index-dddd4444.css", revision: null },
    { url: "assets/PlayerRanking-eeee5555.js", revision: null },
    { url: "assets/PlayerRanking-gggg7777.css", revision: null },
  ];
  const keep = new Set(["assets/index-aaaa1111.js", "assets/index-dddd4444.css"]);

  it("drops built JS and CSS outside the set and keeps everything else", () => {
    const urls = filterPrecacheManifest(manifest, keep, "assets/index-aaaa1111.js").map((e) => e.url);
    expect(urls).toEqual([
      "index.html",
      "registerSW.js",
      "manifest.webmanifest",
      "assets/favicon.svg",
      "assets/open-sans-latin-wght-normal-qqqq7777.woff2",
      "assets/index-aaaa1111.js",
      "assets/index-dddd4444.css",
    ]);
  });

  it("throws rather than precache nothing when no set was worked out", () => {
    expect(() => filterPrecacheManifest(manifest, undefined, undefined)).toThrow(/no player-view set/);
    expect(() => filterPrecacheManifest(manifest, new Set(), "assets/index-aaaa1111.js")).toThrow(/no player-view set/);
  });

  it("throws when the entry chunk is not in the manifest", () => {
    expect(() => filterPrecacheManifest(manifest, keep, "assets/index-zzzz9999.js")).toThrow(/entry chunk/);
  });
});
