import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Home, RotateCw } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';

/**
 * "Something did not load" in one shape, replacing the four in use today
 * (dashed "Could not load X. Try again" box, the full-page route error,
 * red "Failed to load ...: <raw message>" with Retry, and a plain grey line).
 *
 * - box (default): the dashed box most pages already use.
 * - page: centred on a full-height screen, for route-level failures.
 * - inline: no box, left-aligned, for a failed section inside a card.
 *
 * role="alert", so a screen reader hears it when it replaces a loading
 * skeleton. Pass the message in words a player understands; keep raw error
 * text out of it.
 */
export function ErrorState({
  title = 'Could not load this',
  message,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  homeLink = false,
  variant = 'box',
  className = '',
}: {
  title?: ReactNode;
  message?: ReactNode;
  /** Shows a retry button that calls this (refetch, or a reload). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Spinner on the retry button while a refetch runs. */
  retrying?: boolean;
  /** Shows a "Player view" link to "/". */
  homeLink?: boolean;
  variant?: 'box' | 'page' | 'inline';
  className?: string;
}) {
  const layout =
    variant === 'page'
      ? 'min-h-screen flex flex-col items-center justify-center px-6 text-center bg-background'
      : variant === 'inline'
      ? 'py-2'
      : 'flex flex-col items-center text-center py-12 px-4 border border-dashed border-border rounded-xl';
  const actions = onRetry || homeLink;

  return (
    <div role="alert" className={`${layout} ${className}`}>
      <div className={variant === 'inline' ? 'flex items-start gap-2' : 'flex flex-col items-center gap-2'}>
        <AlertCircle
          className={`${variant === 'page' ? 'h-8 w-8' : 'h-5 w-5'} shrink-0 text-danger-soft-foreground`}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className={`${variant === 'page' ? 'text-lg' : 'text-sm'} font-semibold text-foreground`}>{title}</p>
          {message && <p className="text-sm text-muted-foreground max-w-sm">{message}</p>}
        </div>
      </div>
      {actions && (
        <div className={`mt-4 flex flex-wrap gap-2 ${variant === 'inline' ? '' : 'justify-center'}`}>
          {onRetry && (
            <ActionButton
              variant={variant === 'page' ? 'primary' : 'outline'}
              icon={<RotateCw />}
              loading={retrying}
              onClick={onRetry}
            >
              {retryLabel}
            </ActionButton>
          )}
          {homeLink && (
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Player view
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
