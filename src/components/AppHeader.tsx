import type { ReactNode } from 'react';

/**
 * The one title bar. Coach and player screens differ only in the actions they
 * hang on the right, so the logo, the wordmark and the spacing live here and
 * neither side gets to drift.
 */
export default function AppHeader({ subtitle, children }: { subtitle?: string; children?: ReactNode }) {
  return (
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 self-center">
            <img src="/assets/logo-plain.svg" alt="Eddy" className="h-full w-full object-contain" />
          </div>
          <p className="text-base sm:text-lg font-semibold text-foreground shrink-0">HKFC Squad</p>
          {/* Beside the wordmark rather than beneath it, so a header with a
              subtitle is the same height as one without. */}
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate hidden md:block">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">{children}</div>
      </div>
    </header>
  );
}

/** A labelled header action. `active` marks the current route. */
export function headerNavClass(active = false) {
  return `flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 rounded-md transition-colors ${
    active
      ? 'bg-secondary text-secondary-foreground'
      : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
  }`;
}

/** An icon-only header action (stats, settings, sign out). */
export const headerIconClass =
  'p-2 text-muted-foreground hover:text-foreground transition-colors';
