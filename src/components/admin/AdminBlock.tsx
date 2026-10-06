import type { ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import { toneClasses } from '@/lib/statusTone';
import type { SaveRefusal } from '@/lib/peopleAdmin';

/** One block of the person page: a card with a heading. */
export function AdminBlock({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label={title}>
      <div className="flex items-center gap-2 min-h-6">
        <h2 className="flex-1 text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A refused save in plain words. "changed": someone saved first, so Reload.
 * "shared": the membership number is someone else's too; `onAcknowledge`
 * saves it anyway. Anything else: the message alone.
 */
export function RefusalNote({
  refusal,
  onReload,
  onAcknowledge,
  busy = false,
}: {
  refusal: SaveRefusal;
  onReload?: () => void;
  onAcknowledge?: () => void;
  busy?: boolean;
}) {
  const tone = refusal.kind === 'shared' ? 'warning' : 'danger';
  return (
    <div role="alert" className={`rounded-lg border px-3 py-2 space-y-2 ${toneClasses(tone, 'card')}`}>
      <p className={`text-sm ${toneClasses(tone, 'text')}`}>{refusal.message}</p>
      {refusal.kind === 'changed' && onReload && (
        <ActionButton variant="outline" icon={<RotateCw />} onClick={onReload}>
          Reload
        </ActionButton>
      )}
      {refusal.kind === 'shared' && onAcknowledge && (
        <ActionButton variant="primary" loading={busy} onClick={onAcknowledge}>
          Save as shared
        </ActionButton>
      )}
    </div>
  );
}
