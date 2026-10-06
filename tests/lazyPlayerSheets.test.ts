import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as season from "../shared/season";
import * as membershipInsights from "../shared/membershipInsights";

// The player page is in the entry chunk. The sheets it opens on demand are
// lazy, and the cards it always shows import their helpers from light
// modules, so none of these is pulled back into the first load by a static
// import.

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");
const staticImports = (src: string) =>
  [...src.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const kept: Record<string, RegExp[]> = {
  "src/pages/PlayerDashboard.tsx": [/SeasonStatsSheet/, /AvailabilityRulesSheet/, /CalendarSyncSheet/, /AttendanceGrid/],
  "src/components/events/EventsSection.tsx": [/EventSheet/],
  "src/components/HeaderMenus.tsx": [/InviteDialog/],
  "src/components/MyKitCard.tsx": [/HandOutSheet/, /kit\//],
  "src/components/MyVolunteeringLink.tsx": [/membershipInsights/],
  "src/lib/season.ts": [/membershipInsights/],
};

describe("player page first load", () => {
  for (const [file, banned] of Object.entries(kept)) {
    it(`${file} has no static import of an on-demand module`, () => {
      const imports = staticImports(read(file));
      expect(imports.length).toBeGreaterThan(0);
      for (const re of banned) expect(imports.filter((i) => re.test(i))).toEqual([]);
    });
  }
});

describe("seasonStartYear", () => {
  it("is the same function from shared/season and shared/membershipInsights", () => {
    expect(membershipInsights.seasonStartYear).toBe(season.seasonStartYear);
  });

  it("starts the season on 1 July", () => {
    expect(season.seasonStartYear("2026-06-30")).toBe(2025);
    expect(season.seasonStartYear("2026-07-01")).toBe(2026);
    expect(season.seasonStartYear("2027-01-15")).toBe(2026);
  });
});
