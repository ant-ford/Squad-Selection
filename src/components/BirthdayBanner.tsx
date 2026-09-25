import { useEffect, useState } from 'react';
import { Cake, X } from 'lucide-react';
import { hkDateKey } from '@shared/hkDateKey';

/**
 * Happy-birthday card for the player dashboard, with one burst of confetti.
 *
 * The Worker decides whether today is the birthday, so this only renders
 * when it already is. The confetti library is imported here, on the day,
 * so it stays off the dashboard's first load (vite.config.ts keeps it out
 * of the shared vendor chunk). It fires once per day per device, never for
 * someone who has asked for reduced motion, and the card can be dismissed
 * for the rest of the day. Storage can be missing (private mode); without
 * it the card simply shows and the confetti fires on each visit.
 */
export default function BirthdayBanner({ name }: { name: string }) {
  const today = hkDateKey(new Date().toISOString());
  const dismissKey = `birthday-dismissed:${today}`;
  const confettiKey = `birthday-confetti:${today}`;
  const [dismissed, setDismissed] = useState(() => readFlag(dismissKey));

  useEffect(() => {
    if (dismissed || readFlag(confettiKey)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    writeFlag(confettiKey);
    let cancelled = false;
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return;
      const burst = (x: number) =>
        confetti({ particleCount: 70, spread: 70, startVelocity: 45, origin: { x, y: 0.3 } });
      burst(0.25);
      setTimeout(() => burst(0.75), 250);
    }).catch(() => {
      // A failed chunk load costs the confetti, never the card.
    });
    return () => {
      cancelled = true;
    };
  }, [dismissed, confettiKey]);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4"
    >
      <Cake className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground">Happy birthday, {name}!</p>
        <p className="text-sm text-muted-foreground">Have a great day from everyone at HKFC Hockey.</p>
      </div>
      <button
        onClick={() => {
          writeFlag(dismissKey);
          setDismissed(true);
        }}
        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss birthday message"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Quieter card telling a player it is a teammate's birthday: same Selected
 * Team, names from the Worker, no confetti. Dismissible for the day.
 */
export function TeamBirthdayBanner({ names, team }: { names: string[]; team: string }) {
  const dismissKey = `birthday-team-dismissed:${hkDateKey(new Date().toISOString())}`;
  const [dismissed, setDismissed] = useState(() => readFlag(dismissKey));
  if (dismissed || names.length === 0) return null;

  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    <div role="status" className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <Cake className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-sm text-foreground">
        {names.length === 1 ? (
          <>It's <span className="font-semibold">{list}</span>'s birthday today.</>
        ) : (
          <>Birthdays in {team || 'your team'} today: <span className="font-semibold">{list}</span>.</>
        )}{' '}
        <span className="text-muted-foreground">Wish them a happy birthday!</span>
      </p>
      <button
        onClick={() => {
          writeFlag(dismissKey);
          setDismissed(true);
        }}
        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss team birthday message"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage unavailable: nothing to remember it in.
  }
}
