/**
 * "What's still missing" for a form whose submit button stays enabled:
 * tapping it lists the gaps by the button and jumps to the first one.
 *
 *   const gaps = formGaps([
 *     [!form.practices, { id: 'practices', label: 'Practices' }],
 *     [!sig, { id: 'signature', label: 'Your signature' }],
 *   ]);
 *   if (gaps.length) { setShown(gaps); focusGap(gaps[0]); return; }
 */

export interface Gap {
  /** The element to jump to: a control's id (Field sets it), or a wrapper's. */
  id: string;
  /** How the list names it: the field's label. */
  label: string;
}

/** The gaps whose condition is true, in form order. */
export function formGaps(checks: readonly (readonly [boolean, Gap])[]): Gap[] {
  return checks.filter(([missing]) => missing).map(([, gap]) => gap);
}

/** "Still needed: Practices and Sponsor." / "Still needed: A, B and C." */
export function gapSummary(gaps: readonly Gap[]): string {
  if (gaps.length === 0) return '';
  const labels = gaps.map((g) => g.label);
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `Still needed: ${list}.`;
}

/**
 * Scrolls the first gap into the middle of the screen and focuses it (or
 * the first control inside it, for a group such as a signature or ticks).
 */
export function focusGap(gap: Gap | undefined, doc: Pick<Document, 'getElementById'> | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!gap || !doc) return false;
  const el = doc.getElementById(gap.id);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  const target = el.matches?.('input,select,textarea,button,[tabindex]')
    ? el
    : (el.querySelector?.('input,select,textarea,button,[tabindex]') as HTMLElement | null) ?? el;
  target.focus?.({ preventScroll: true });
  return true;
}
