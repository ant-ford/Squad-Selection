/** Reusable section header with optional count badge. */
export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
      {title}{count !== undefined ? ` (${count})` : ''}
    </h2>
  );
}
