import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { toneClasses, type StatusTone } from '@/lib/statusTone';

/**
 * One small status pill: tinted background, readable text, optional icon.
 * Text is 12 px and shown as written: pass sentence case ("Not paid", not
 * "NOT PAID" or "Not Paid"). Colours come from src/styles/status-tokens.css.
 */
export function StatusChip({
  tone = 'neutral',
  icon: Icon,
  children,
  className = '',
  title,
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(
        tone,
        'soft',
      )} ${className}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}
