import { describe, it, expect } from "vitest";
import { foldLine, formatSquadLines, calendarWorthy } from "../worker/src/calendar";

// RFC 5545 §3.1: content lines are at most 75 octets; longer ones are folded
// with CRLF followed by a single space, which counts towards the next line.
const octetLength = (s: string) => new TextEncoder().encode(s).length;

function physicalLines(folded: string): string[] {
  return folded.split("\r\n");
}

function unfold(folded: string): string {
  return folded.replace(/\r\n /g, "");
}

describe("ICS line folding", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:F vs Opponent")).toBe("SUMMARY:F vs Opponent");
  });

  it("folds a long ASCII line into 75-octet pieces that unfold to the original", () => {
    const line = "DESCRIPTION:" + "x".repeat(300);
    const folded = foldLine(line);
    for (const l of physicalLines(folded)) expect(octetLength(l)).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(line);
  });

  it("counts octets, not characters, so a line of emoji still fits the limit", () => {
    // Each of these is four octets; 75 UTF-16 code units of them would be
    // 150 octets, twice the limit the old code let through.
    const line = "SUMMARY:" + "🔵".repeat(60);
    const folded = foldLine(line);
    for (const l of physicalLines(folded)) expect(octetLength(l)).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(line);
  });

  it("never splits a character across the fold", () => {
    // Positioned so that a code-unit split at 75 would land inside the
    // surrogate pair of the first emoji.
    const line = "SUMMARY:" + "a".repeat(66) + "🔵🔵";
    const folded = foldLine(line);
    for (const l of physicalLines(folded)) {
      expect(l).not.toMatch(/[\uD800-\uDBFF]$/); // no dangling high surrogate
      expect(l.replace(/^ /, "")).not.toMatch(/^[\uDC00-\uDFFF]/); // no leading low surrogate
    }
    expect(unfold(folded)).toBe(line);
  });

  it("handles the mixed-width text a real description has", () => {
    const line = "DESCRIPTION:F vs Opponent\\nSaturday 4 October, 15:00 HKT\\n\\nSent by Eddy · HKFC Men's Hockey squad management ✅ ❌ ❓ 🟦 " + "y".repeat(120);
    const folded = foldLine(line);
    for (const l of physicalLines(folded)) expect(octetLength(l)).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(line);
  });
});

describe("squad lines", () => {
  it("reads like a team sheet: number, name, and a Maybe flag", () => {
    expect(
      formatSquadLines([
        { name: "Jonny" },
        { name: "Tom", shirtNo: "7" },
        { name: "Raj", shirtNo: "23", availabilityStatus: "Maybe" },
        { name: "Sam", availabilityStatus: "Maybe" },
        { name: "Bob", shirtNo: "", availabilityStatus: "Unavailable" },
      ]),
    ).toEqual(["Jonny", "#7 Tom", "#23 Raj (Maybe)", "Sam (Maybe)", "Bob"]);
  });
});

describe("which dashboard fixtures reach the calendar", () => {
  it("keeps own and support fixtures, and play-ups only once picked", () => {
    const fixtures = [
      { id: "own", fixtureCategory: "own", selectionStatus: "" },
      { id: "own-declined", fixtureCategory: "own", selectionStatus: "", availabilityStatus: "Unavailable" },
      { id: "support", fixtureCategory: "support", selectionStatus: "" },
      { id: "playup", fixtureCategory: "play-up", selectionStatus: "" },
      { id: "playup-picked", fixtureCategory: "play-up", selectionStatus: "Selected" },
    ];
    expect(calendarWorthy(fixtures).map((f) => f.id)).toEqual(["own", "own-declined", "support", "playup-picked"]);
  });
});
