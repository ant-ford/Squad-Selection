import { CheckCircle2 } from 'lucide-react';

/** Reusable selection-status badge. Empty string or falsy = no render. */
export function StatusBadge({ status }: { status: string }) {
  if (!status) return null;
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground shrink-0">
      <CheckCircle2 className="h-3 w-3" />
      {status}
    </span>
  );
}
