import type { CSSProperties } from 'react';

/**
 * One hue per ability group, A (blue) round to H (pink), for the ranking
 * badges and the group-size bar. Eight groups need eight colours, more than
 * the four status tones, so they live here as one table instead of as
 * Tailwind palette classes spread over the ranking screen.
 *
 * Badge text is the hue at 24% lightness on a 92% tint: at least 7:1 for
 * every hue, so the grade reads outdoors on a phone.
 */
const HUE: Record<string, number> = { A: 217, B: 190, C: 172, D: 142, E: 45, F: 25, G: 0, H: 330 };

/** The ability group of a grade: "C+" -> "C". Unknown -> null. */
export function abilityGroupOf(value: string | undefined | null): string | null {
  const g = (value ?? '').trim().charAt(0).toUpperCase();
  return g in HUE ? g : null;
}

/** Tinted badge colours for a grade such as "B-"; empty for no grade. */
export function abilityBadgeStyle(value: string | undefined | null): CSSProperties {
  const g = abilityGroupOf(value);
  if (!g) return {};
  const h = HUE[g];
  return {
    backgroundColor: `hsl(${h} 85% 92%)`,
    color: `hsl(${h} 80% 24%)`,
    borderColor: `hsl(${h} 60% 78%)`,
  };
}

/** Solid fill for a group's slice of the group-size bar (white text on it). */
export function abilityFill(group: string): string {
  const h = HUE[group] ?? 0;
  return `hsl(${h} 70% 38%)`;
}
