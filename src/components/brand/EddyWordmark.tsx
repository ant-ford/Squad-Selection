/**
 * The product name in the brand's lettering: Fairwater Script, the script in
 * the logo, as outlines (no font file). On screen the name is always this;
 * plain "Eddy" only where the device or another app draws the text (tab
 * title, manifest, push, emails, WhatsApp, calendar, CSV, PDF, alt and
 * aria-label). tests/brandWordmark.test.ts enforces it; index.html's boot
 * loader inlines the same path.
 */
export const WORDMARK_VIEWBOX = '0 0 541 276';
export const WORDMARK_PATH =
  'm58 217q-12 0-23-3-10-4-17-10-8-7-12-16-5-10-5-22 0-12 6-23 5-10 14-19 9-8 21-14 12-6 24-8-8-5-14-14-5-9-5-21 0-13 5-24 6-10 16-18 10-8 22-12 13-4 26-4 12 0 22 4 9-5 18-8 8-3 15-3 6 0 6 4 0 2-2 3-1 2-5 2-4 1-10 3-6 2-12 5 12 10 12 26 0 8-2 15-3 6-7 11-5 5-11 8-5 3-12 3-10 0-16-7-7-7-7-17 0-11 6-20 7-9 16-17-6-1-12-1-11 0-21 4-9 3-17 9-7 6-12 15-4 9-4 19 0 7 2 13 2 6 6 10 3 5 8 7 4 3 8 3 5-1 9-1 5 0 8 0 9 0 9 5 0 7-11 7-4 0-10-1-5 0-12 0-11 0-22 4-11 5-20 12-9 8-14 18-6 10-6 22 0 19 12 29 12 11 30 11 12 0 24-4 12-3 23-10 12-7 22-16 10-9 17-21 1-1 2-1 0-1 1-1 1-1 1-1 6 0 6 5 0 1-1 2 0 1 0 2-9 13-20 24-11 10-24 17-12 8-25 11-13 4-26 4zm80-191q-8 6-14 14-6 8-6 18 0 13 11 13 3 0 7-2 3-2 6-6 3-3 4-8 2-5 2-10 0-13-10-19zm97 172q5 0 11-4 5-3 11-9 6-6 11-14 6-8 11-16 2-3 5-3 2 0 3 2 2 1 2 3 0 2-1 4-6 9-13 17-6 9-13 15-6 7-14 11-7 4-15 4-9 0-16-7-7-7-7-19 0-2 0-3 1-1 1-3-5 7-10 12-5 6-10 10-5 5-11 7-6 3-12 3-12 0-20-8-8-8-8-23 0-14 6-28 7-13 17-24 10-10 22-17 12-6 24-6 8 0 14 3 6 2 10 8 3-7 6-16 3-8 7-17 3-8 6-16 4-7 6-13 4-8 9-8 3 0 5 1 2 2 2 5 0 9-15 34-2 4-6 12-3 8-7 18-4 9-8 20-4 10-7 19-3 10-5 18-2 7-2 12 0 8 3 12 3 4 8 4zm-7-72q-2-14-20-14-8 0-18 6-10 6-18 15-8 10-13 21-5 12-5 24 0 9 4 14 5 5 12 5 9 0 19-9 9-8 18-21 7-10 12-20 4-9 9-21zm142 72q5 0 11-4 5-3 11-9 6-6 11-14 6-8 11-16 2-3 5-3 2 0 3 2 2 1 2 3 0 2-1 4-6 9-13 17-6 9-13 15-6 7-14 11-7 4-15 4-9 0-16-7-7-7-7-19 0-2 0-3 1-1 1-3-5 7-10 12-5 6-10 10-5 5-11 7-6 3-12 3-12 0-20-8-8-8-8-23 0-14 6-28 7-13 17-24 10-10 22-17 12-6 24-6 8 0 14 3 6 2 10 8 3-7 6-16 3-8 7-17 3-8 6-16 4-7 6-13 4-8 9-8 3 0 5 1 2 2 2 5 0 9-15 34-2 4-6 12-3 8-7 18-4 9-8 20-4 10-7 19-3 10-5 18-2 7-2 12 0 8 3 12 3 4 8 4zm-7-72q-2-14-20-14-8 0-18 6-10 6-18 15-8 10-13 21-5 12-5 24 0 9 4 14 5 5 12 5 9 0 19-9 9-8 18-21 7-10 12-20 4-9 9-21zm120 55-9 24q16-6 30-19 15-13 26-31 1-1 1-1 1-1 2-1 0-1 1-1 5 0 5 5 0 1 0 2 0 1-1 2-12 19-28 33-16 14-40 24-5 12-11 22-6 11-13 18-7 8-15 12-7 5-16 5-10 0-18-6-7-6-7-16 0-8 4-14 5-6 14-11 9-4 21-9 13-4 30-8 4-11 6-18 3-8 5-14-9 12-18 20-10 9-20 9-10 0-17-7-6-6-6-20 0-6 2-13 2-8 4-15 3-8 6-16 4-7 7-14 6-11 9-16 4-5 6-5 4 0 5 1 2 2 2 5 0 6-11 23-3 6-6 13-3 7-5 13-2 7-4 13-1 7-1 12 0 8 3 11 3 4 7 4 9 0 17-9 9-8 18-21 6-9 12-22 7-13 12-25 4-10 7-14 3-4 6-4 3 0 5 1 2 2 2 5 0 3-3 9-3 5-9 14-2 5-4 12-3 6-5 13-2 7-5 14-2 6-3 11zm-28 41q-13 4-23 7-9 3-16 7-7 3-10 8-4 4-4 9 0 6 4 9 3 3 9 3 5 0 10-3 5-3 11-9 5-6 10-13 5-8 9-18z';

/** The viewBox has the baseline 205 of 276 down: the share of the height below it. */
const BELOW_BASELINE = 71 / 276;

/**
 * Sized in em, so it follows the text around it, with its baseline on the
 * text's. 1.2em suits running text; in text-xs lines use 1.5 so the script
 * stays about 18 px tall. Display places (loading screens) set a font size
 * on the parent.
 */
export default function EddyWordmark({ size = 1.2, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Eddy"
      viewBox={WORDMARK_VIEWBOX}
      className={`inline-block w-auto aspect-[541/276] shrink-0 ${className}`}
      style={{ height: `${size}em`, verticalAlign: `${(-size * BELOW_BASELINE).toFixed(3)}em` }}
    >
      <path fill="currentColor" d={WORDMARK_PATH} />
    </svg>
  );
}
