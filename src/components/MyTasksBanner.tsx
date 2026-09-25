import { ClipboardCheck, ExternalLink } from 'lucide-react';
import type { MyTask } from '@/api/getMyTasks';
import { useMyTasks } from '@/lib/queries';

const COPY: Record<MyTask['key'], { title: string; noLink: string }> = {
  statement: {
    title: 'Complete your Player Statement',
    noLink: 'Use the Commitment Form link in your review email.',
  },
  waivers: {
    title: "Complete this season's Waivers & Declarations",
    noLink: 'Ask the Membership Officer for your form link.',
  },
};

/**
 * Forms the member still owes, at the top of their player page: a heading
 * and a button per form (owner request, 2026-09-26). There is no close
 * button on purpose: each item goes once the base shows the form
 * submitted. The query rechecks when the tab regains focus, so coming back
 * from the form is usually enough.
 */
export default function MyTasksBanner() {
  const { data } = useMyTasks();
  const tasks = data?.tasks ?? [];
  if (tasks.length === 0) return null;

  return (
    <section
      aria-label="Forms to complete"
      className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 divide-y divide-amber-500/20"
    >
      {tasks.map((task) => {
        const copy = COPY[task.key];
        return (
          <div key={task.key} className="flex items-center gap-3 p-3">
            <ClipboardCheck className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{copy.title}</p>
              {/* Only when there is no button to press. */}
              {!task.url && <p className="text-xs text-muted-foreground mt-0.5">{copy.noLink}</p>}
            </div>
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Open form <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        );
      })}
    </section>
  );
}
