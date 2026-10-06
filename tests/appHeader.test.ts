import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { backTarget, canSwitchView, coachScreen, currentView, documentTitle, phoneControls } from "../src/lib/header";
import { mainMenuGroups } from "../src/components/headerItems";

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

describe("back arrow", () => {
  it("goes back in history when the visit came from another Eddy screen", () => {
    expect(backTarget("k3j2h1", "/coach")).toBe(-1);
  });
  it("goes to the parent screen on a first visit (a link from an email, a reload of a fresh tab)", () => {
    expect(backTarget("default", "/coach")).toBe("/coach");
    expect(backTarget(undefined, "/membership")).toBe("/membership");
    expect(backTarget("", "/quizzes")).toBe("/quizzes");
  });
});

describe("Player view / Coach view switch", () => {
  it("shows for coaches and Section Captains only", () => {
    expect(canSwitchView({ isCoach: true })).toBe(true);
    expect(canSwitchView({ isCoach: false, isSectionCaptain: true })).toBe(true);
    expect(canSwitchView({ isCoach: false, isSectionCaptain: false })).toBe(false);
    expect(canSwitchView(undefined)).toBe(false);
  });
  it("never shows for an applicant", () => {
    expect(canSwitchView({ isCoach: true, applicant: true })).toBe(false);
  });
  it("knows which side the current screen is on", () => {
    expect(currentView("/")).toBe("player");
    expect(currentView("/coach")).toBe("coach");
    expect(currentView("/coach/match/m1")).toBe("coach");
    expect(currentView("/coaching")).toBe(null);
    expect(currentView("/kit")).toBe(null);
  });
});

describe("header buttons on a phone", () => {
  const combos = [true, false].flatMap((back) =>
    [true, false].flatMap((canSwitch) => [true, false].map((applicant) => ({ back, canSwitch, applicant }))),
  );
  it.each(combos)("at most four, menus always there (%o)", (c) => {
    const controls = phoneControls(c);
    expect(controls.length).toBeLessThanOrEqual(4);
    expect(controls).toContain("profile");
    if (!c.applicant) expect(controls).toContain("menu");
  });
  it("a child screen's back arrow takes the switch's place", () => {
    expect(phoneControls({ back: true, canSwitch: true })).toEqual(["back", "menu", "profile"]);
    expect(phoneControls({ back: false, canSwitch: true })).toEqual(["menu", "player", "coach", "profile"]);
  });
});

describe("coach area headers", () => {
  it("names each screen; only a match is a child screen", () => {
    expect(coachScreen("/coach")).toEqual({ title: "Coach view", child: false });
    expect(coachScreen("/coach/ranking")).toEqual({ title: "Ranking", child: false });
    expect(coachScreen("/coach/match/m1")).toEqual({ title: "Squad selection", child: true });
  });
  it("titles the browser tab after the screen", () => {
    expect(documentTitle("Kit")).toBe("Kit · Eddy");
    expect(documentTitle("")).toBe("Eddy");
  });
});

describe("burger menu", () => {
  const labels = (groups: { label: string }[][]) => groups.map((g) => g.map((e) => e.label));
  it("has Ranking for coaches and Umpire view for umpires only", () => {
    expect(labels(mainMenuGroups({ isCoach: false })).flat()).not.toContain("Ranking");
    expect(labels(mainMenuGroups({ isCoach: false })).flat()).not.toContain("Umpire view");
    expect(labels(mainMenuGroups({ isCoach: true, umpiring: "umpire" }))[0]).toEqual(["Ranking", "Umpire view"]);
    expect(labels(mainMenuGroups({ umpiring: "coordinator" })).flat()).toContain("Umpire view");
  });
  it("puts the screen's own actions first", () => {
    const page = [{ label: "Active members CSV", icon: (() => null) as never }];
    expect(labels(mainMenuGroups({ sections: ["membership"] }, page))[0]).toEqual(["Active members CSV"]);
  });
  it("still lists Stats before the profile has loaded", () => {
    expect(labels(mainMenuGroups(undefined))).toEqual([["Stats"]]);
  });
});

describe("one header on every signed-in screen", () => {
  // Public screens, and the coach screens that CoachLayout gives its header.
  const exempt = new Set(["Login.tsx", "Join.tsx", "CoachDashboard.tsx", "SquadSelection.tsx", "PlayerRanking.tsx", "FixtureList.tsx"]);
  const pages = readdirSync(path.join(__dirname, "..", "src/pages")).filter((f) => f.endsWith(".tsx") && !exempt.has(f));

  it.each(pages)("%s uses AppHeader with a title", (f) => {
    const src = read(`src/pages/${f}`);
    expect(src).toMatch(/<AppHeader\s[^>]*title=/);
    expect(src).not.toMatch(/<header\b/);
  });
  it("the coach area's layout uses it too", () => {
    expect(read("src/components/CoachLayout.tsx")).toMatch(/<AppHeader\s[^>]*title=/);
  });
  it("uses the glossary's words", () => {
    for (const f of [...pages.map((p) => `src/pages/${p}`), "src/components/AppHeader.tsx", "src/components/HeaderMenus.tsx", "src/components/headerItems.ts", "src/App.tsx"]) {
      expect(read(f), f).not.toMatch(/Player View|Coach View|Umpire View|Log Out|Sign Out/);
    }
  });
});

describe("routes", () => {
  const app = read("src/App.tsx");
  it("sends an unknown signed-in address to the player page", () => {
    expect(app).toMatch(/\{\s*path:\s*'\*',\s*element:\s*<Navigate to="\/" replace \/>\s*\}/);
    // Inside the signed-in routes (after the AuthGate), not before /join.
    expect(app.indexOf("path: '*'")).toBeGreaterThan(app.indexOf("element: <AuthGate />"));
  });
  it("offers Player view on the error screen", () => {
    const error = app.slice(app.indexOf("function RouteError"), app.indexOf("const router"));
    expect(error).toMatch(/href="\/"[^>]*>\s*Player view\s*</);
  });
});
