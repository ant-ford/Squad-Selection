import type { CSSProperties } from 'react';

/**
 * One set of class strings per status tone, built on the tokens in
 * src/styles/status-tokens.css (that file must be imported by index.css for
 * these classes to have any colour).
 *
 * The strings are written out in full, not assembled from `${tone}`, because
 * Tailwind only generates classes it can find literally in the source.
 */

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * How a tone is applied. None of these sets a border width: the caller keeps
 * its own `border`, `border-2` or `border-l-4`, so swapping a hand-written
 * colour string for one of these does not move anything. `dashed` is the one
 * exception, because the dashed border is the whole look.
 *
 *  soft    tinted pill or cell: tint + readable text
 *  chip    soft, plus a border colour (for elements that already have `border`)
 *  solid   strong fill: solid + its foreground (active segment, legend swatch)
 *  dashed  "not confirmed": page background, coloured text, dashed coloured border
 *  faint   lighter tint for past or secondary cells
 *  card    tinted card: tint + solid border colour
 *  edge    tinted row with a solid left bar (caller sets `border-l-4`)
 *  dot     a small coloured dot or swatch, no text
 *  text    coloured text or icon on a light surface
 */
export type ToneStyle = 'soft' | 'chip' | 'solid' | 'dashed' | 'faint' | 'card' | 'edge' | 'dot' | 'text';

const TONE_CLASSES: Record<StatusTone, Record<ToneStyle, string>> = {
  success: {
    soft: 'bg-success-soft text-success-soft-foreground',
    chip: 'bg-success-soft text-success-soft-foreground border-success/40',
    solid: 'bg-success text-success-foreground',
    dashed: 'bg-background text-success-soft-foreground border border-dashed border-success',
    faint: 'bg-success-soft/40 text-success-soft-foreground',
    card: 'bg-success-soft border-success',
    edge: 'bg-success-soft border-l-success',
    dot: 'bg-success',
    text: 'text-success-soft-foreground',
  },
  warning: {
    soft: 'bg-warning-soft text-warning-soft-foreground',
    chip: 'bg-warning-soft text-warning-soft-foreground border-warning/60',
    solid: 'bg-warning text-warning-foreground',
    dashed: 'bg-background text-warning-soft-foreground border border-dashed border-warning',
    faint: 'bg-warning-soft/40 text-warning-soft-foreground',
    card: 'bg-warning-soft border-warning',
    edge: 'bg-warning-soft border-l-warning',
    dot: 'bg-warning',
    text: 'text-warning-soft-foreground',
  },
  danger: {
    soft: 'bg-danger-soft text-danger-soft-foreground',
    chip: 'bg-danger-soft text-danger-soft-foreground border-danger/40',
    solid: 'bg-danger text-danger-foreground',
    dashed: 'bg-background text-danger-soft-foreground border border-dashed border-danger',
    faint: 'bg-danger-soft/40 text-danger-soft-foreground',
    card: 'bg-danger-soft border-danger',
    edge: 'bg-danger-soft border-l-danger',
    dot: 'bg-danger',
    text: 'text-danger-soft-foreground',
  },
  info: {
    soft: 'bg-info-soft text-info-soft-foreground',
    chip: 'bg-info-soft text-info-soft-foreground border-info/40',
    solid: 'bg-info text-info-foreground',
    dashed: 'bg-background text-info-soft-foreground border border-dashed border-info',
    faint: 'bg-info-soft/40 text-info-soft-foreground',
    card: 'bg-info-soft border-info',
    edge: 'bg-info-soft border-l-info',
    dot: 'bg-info',
    text: 'text-info-soft-foreground',
  },
  // No answer / unknown: the app's existing greys, so nothing changes there.
  neutral: {
    soft: 'bg-muted text-muted-foreground',
    chip: 'bg-muted text-muted-foreground border-border',
    solid: 'bg-secondary text-secondary-foreground',
    dashed: 'bg-background text-muted-foreground border border-dashed border-border',
    faint: 'bg-muted/50 text-muted-foreground',
    card: 'bg-card border-border',
    edge: 'border-l-transparent',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
};

/** The class string for a tone in a given style (default: `soft`). */
export function toneClasses(tone: StatusTone, style: ToneStyle = 'soft'): string {
  return TONE_CLASSES[tone][style];
}

/**
 * Diagonal hatching in the tone's solid colour, for a cell that is the tone
 * "but not quite" (AttendanceGrid's "available, not picked"). Inline style,
 * because the stripe colour comes from the token.
 */
export function toneHatch(tone: StatusTone): CSSProperties {
  const colour = tone === 'neutral' ? 'hsl(var(--muted-foreground) / 0.35)' : `hsl(var(--${tone}) / 0.55)`;
  return { backgroundImage: `repeating-linear-gradient(135deg, ${colour} 0 2px, transparent 2px 6px)` };
}
