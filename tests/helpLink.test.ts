import { describe, expect, it } from "vitest";
import { GUIDE_URLS, officerGuide } from "../src/components/HelpLink";

const as = (...offices: string[]) => ({ officerRoles: offices.map((office) => ({ office, designation: "" })) }) as Parameters<typeof officerGuide>[0];

describe("Help opens the viewer's guide", () => {
  it("on the screens several offices open, picks the viewer's office", () => {
    expect(officerGuide(as("sectionCaptain"), "membership")).toBe("captains");
    expect(officerGuide(as("hockeyConvenor"), "membership")).toBe("convenor");
    expect(officerGuide(as("membershipOfficer"), "convenor")).toBe("membership");
  });
  it("prefers the Section Captains' guide, then the Men's Convenor's, for someone holding several", () => {
    expect(officerGuide(as("membershipOfficer", "sectionCaptain"), "membership")).toBe("captains");
    expect(officerGuide(as("membershipOfficer", "hockeyConvenor"), "membership")).toBe("convenor");
  });
  it("falls back to the screen's own guide", () => {
    expect(officerGuide(as("kitConvenor"), "convenor")).toBe("convenor");
    expect(officerGuide(undefined, "membership")).toBe("membership");
  });
  it("links every guide on eddy.global", () => {
    for (const url of Object.values(GUIDE_URLS)) expect(url).toMatch(/^https:\/\/eddy\.global\/guides\/[a-z]+\/$/);
  });
});
