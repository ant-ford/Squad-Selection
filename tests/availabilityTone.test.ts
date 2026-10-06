import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  availabilityClasses,
  availabilityHatch,
  availabilityLabel,
  availabilityTone,
} from "../src/lib/availabilityTone";
import { toneClasses, type StatusTone, type ToneStyle } from "../src/lib/statusTone";

// One colour per availability answer, everywhere: Available is the success
// tone (it was green in some files and emerald in others), Maybe warning,
// Unavailable danger, anything else neutral.

describe("availabilityTone", () => {
  it("maps each answer to its tone", () => {
    expect(availabilityTone("Available")).toBe("success");
    expect(availabilityTone("Maybe")).toBe("warning");
    expect(availabilityTone("Unavailable")).toBe("danger");
  });

  it("treats no answer or an unknown value as neutral", () => {
    expect(availabilityTone("")).toBe("neutral");
    expect(availabilityTone(undefined)).toBe("neutral");
    expect(availabilityTone(null)).toBe("neutral");
    expect(availabilityTone("available")).toBe("neutral");
    expect(availabilityTone("Going")).toBe("neutral");
  });
});

describe("availabilityClasses", () => {
  it("defaults to the soft pill", () => {
    expect(availabilityClasses("Available")).toBe("bg-success-soft text-success-soft-foreground");
    expect(availabilityClasses("Maybe")).toBe("bg-warning-soft text-warning-soft-foreground");
    expect(availabilityClasses("Unavailable")).toBe("bg-danger-soft text-danger-soft-foreground");
  });

  it("keeps the app's greys for no answer", () => {
    expect(availabilityClasses("")).toBe("bg-muted text-muted-foreground");
    expect(availabilityClasses(undefined, "card")).toBe("bg-card border-border");
    expect(availabilityClasses(undefined, "edge")).toBe("border-l-transparent");
  });

  it("gives each style for an answer", () => {
    expect(availabilityClasses("Unavailable", "solid")).toBe("bg-danger text-danger-foreground");
    expect(availabilityClasses("Maybe", "chip")).toContain("border-warning/");
    expect(availabilityClasses("Available", "dashed")).toContain("border-dashed");
    expect(availabilityClasses("Unavailable", "edge")).toBe("bg-danger-soft border-l-danger");
    expect(availabilityClasses("Available", "dot")).toBe("bg-success");
    expect(availabilityClasses("Maybe", "text")).toBe("text-warning-soft-foreground");
  });

  it("only sets a border width in the dashed style", () => {
    const tones: StatusTone[] = ["success", "warning", "danger", "info", "neutral"];
    const styles: ToneStyle[] = ["soft", "chip", "solid", "faint", "card", "edge", "dot", "text"];
    for (const tone of tones) {
      for (const style of styles) {
        expect(toneClasses(tone, style).split(" ")).not.toContain("border");
      }
    }
  });

  it("uses no raw Tailwind palette colours", () => {
    const palette = /\b(red|green|emerald|amber|yellow|orange|blue|sky|rose)-\d{2,3}\b/;
    for (const status of ["Available", "Maybe", "Unavailable", ""]) {
      for (const style of ["soft", "chip", "solid", "dashed", "faint", "card", "edge", "dot", "text"] as ToneStyle[]) {
        expect(availabilityClasses(status, style)).not.toMatch(palette);
      }
    }
  });

  it("only uses colours that status-tokens.css defines", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/styles/status-tokens.css"), "utf8");
    const defined = new Set([...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]));
    for (const tone of ["success", "warning", "danger", "info"] as const) {
      for (const style of ["soft", "chip", "solid", "dashed", "faint", "card", "edge", "dot", "text"] as ToneStyle[]) {
        for (const cls of toneClasses(tone, style).split(" ")) {
          const m = cls.match(new RegExp(`^(?:bg|text|border|border-l)-(${tone}(?:-[a-z-]+)?)(?:/\\d+)?$`));
          if (m) expect(defined.has(m[1]), `${cls} in ${tone}/${style}`).toBe(true);
        }
      }
    }
  });
});

describe("availabilityHatch", () => {
  it("stripes in the answer's solid colour", () => {
    expect(availabilityHatch("Available").backgroundImage).toContain("hsl(var(--success) / 0.55)");
  });
});

describe("availabilityLabel", () => {
  it("says No for Unavailable and Going once selected", () => {
    expect(availabilityLabel("Available")).toBe("Available");
    expect(availabilityLabel("Available", true)).toBe("Going");
    expect(availabilityLabel("Maybe")).toBe("Maybe");
    expect(availabilityLabel("Unavailable")).toBe("No");
    expect(availabilityLabel("")).toBe("—");
  });
});
