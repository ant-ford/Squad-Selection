import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';

const CONFIG: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  Available:   { icon: CheckCircle2, className: 'text-muted-foreground',        label: 'Available' },
  Maybe:       { icon: HelpCircle,   className: 'text-secondary-foreground',    label: 'Maybe' },
  Unavailable: { icon: XCircle,      className: 'text-destructive',             label: 'Unavailable' },
};

/** Reusable availability chip — used on both player and coach dashboards. */
export function AvailabilityChip({ status }: { status: string }) {
  const cfg = CONFIG[status] ?? CONFIG.Available;
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 text-xs ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
