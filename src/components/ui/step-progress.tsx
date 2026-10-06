/**
 * Where a long form is: "Step 4 of 16 · Contact" over a thin bar. Replaces
 * the cloud of step chips on My details and the application.
 */
export function StepProgress({ step, total, title, className = '' }: { step: number; total: number; title: string; className?: string }) {
  const pct = total > 0 ? Math.round((Math.min(step, total) / total) * 100) : 0;
  const label = `Step ${step} of ${total} · ${title}`;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
