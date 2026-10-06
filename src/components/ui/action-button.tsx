import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The app's button. Replaces the class strings pasted per page (kitUi's
 * primaryButton/secondaryButton, MyKitCard's button/quiet, Umpiring's
 * primaryBtn/plainBtn, steps.tsx's primary, CommitmentReview's primary) and,
 * later, the bare ui/button.tsx.
 *
 * - variant: primary (blue fill), secondary (grey fill), outline (bordered,
 *   the app's usual "plain" button), ghost (no fill until hover), danger.
 * - size: sm is 40 px tall, md 44 px. Nothing smaller: these are tap targets.
 * - iconOnly: a square button showing just `icon`. It must have an
 *   `aria-label`; the types refuse one without.
 * - loading: spinner in place of the icon, disabled, aria-busy.
 * - fullWidth: w-full.
 *
 * `type` defaults to "button" so a button inside a form never submits it by
 * accident; pass type="submit" when it should.
 *
 * The danger variant uses the danger token (src/styles/status-tokens.css),
 * which is --destructive.
 */

export type ActionButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ActionButtonSize = 'sm' | 'md';

type CommonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  fullWidth?: boolean;
};

type TextButtonProps = CommonProps & {
  iconOnly?: false;
  /** Shown before the text. */
  icon?: ReactNode;
  children: ReactNode;
  'aria-label'?: string;
};

type IconOnlyButtonProps = CommonProps & {
  iconOnly: true;
  icon: ReactNode;
  /** Required: an icon-only button has no other name. */
  'aria-label': string;
  children?: never;
};

export type ActionButtonProps = TextButtonProps | IconOnlyButtonProps;

const BASE =
  'inline-flex items-center justify-center gap-1.5 shrink-0 rounded-md text-sm font-medium transition-colors select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:opacity-50 disabled:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

const VARIANTS: Record<ActionButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-muted text-foreground hover:bg-muted/80',
  outline: 'border border-border bg-background text-foreground hover:bg-muted',
  ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'bg-danger text-danger-foreground hover:bg-danger/90',
};

const SIZES: Record<ActionButtonSize, string> = {
  sm: 'h-10 px-3',
  md: 'h-11 px-4',
};

const ICON_SIZES: Record<ActionButtonSize, string> = {
  sm: 'h-10 w-10',
  md: 'h-11 w-11',
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  {
    variant = 'primary',
    size = 'sm',
    loading = false,
    fullWidth = false,
    iconOnly = false,
    icon,
    children,
    className = '',
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  const shown = loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${iconOnly ? ICON_SIZES[size] : SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {shown && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {shown}
        </span>
      )}
      {!iconOnly && children}
    </button>
  );
});
