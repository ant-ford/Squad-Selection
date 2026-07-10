import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';

const CONFIG: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  Available: {
    icon: CheckCircle2,
    className: 'text-green-600',
    label: 'Going'
  },
  Maybe: {
    icon: HelpCircle,
    className: 'text-amber-600',
    label: 'Maybe'
  },
  Unavailable: {
    icon: XCircle,
    className: 'text-red-600',
    label: 'No'
  },
};

export function AvailabilityChip({ status }: { status: string }) {
  const cfg = CONFIG[status] ?? CONFIG.Available;
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}