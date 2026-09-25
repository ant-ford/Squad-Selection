import { ClipboardCheck, ExternalLink } from 'lucide-react';
import type { MyTask } from '@/api/getMyTasks';
import { useMyTasks } from '@/lib/queries';

/** "sponsor" / "Chairman" / "Membership Officer", as said in a sentence. */
const as = (role: MyTask['role']) => (role === 'Sponsor' ? 'sponsor' : role ?? '');

export function taskTitle(task: MyTask): string {
  const who = task.subject ?? 'an applicant';
  switch (task.key) {
    case 'joiner':
      return 'Complete your New Joiner Form';
    case 'statement':
      return 'Complete your Player Statement';
    case 'waivers':
      return "Complete this season's Waivers & Declarations";
    case 'invite':
      return `Invite ${who} to apply`;
    case 'application':
      return task.role === 'Sponsor'
        ? `Support ${who}'s membership application`
        : `Sign ${who}'s membership application as ${as(task.role)}`;
    case 'review':
      return `Complete ${who}'s Player Statement as ${as(task.role)}`;
  }
}

function noLinkHint(task: MyTask): string {
  if (task.key === 'statement') return 'Use the Commitment Form link in your review email.';
  return 'Ask the Membership Officer for the form link.';
}

/**
 * Forms the person still owes, at the top of their player page: their own,
 * and whatever the New Joiner and Statements processes are waiting on them
 * for. A heading and a button per form (owner request, 2026-09-26), and no
 * close button on purpose: each line goes once the base shows it done. The
 * query rechecks when the tab regains focus, so coming back from the form
 * is usually enough.
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
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-3 p-3">
          <ClipboardCheck className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{taskTitle(task)}</p>
            {/* Only when there is no button to press. */}
            {!task.url && <p className="text-xs text-muted-foreground mt-0.5">{noLinkHint(task)}</p>}
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
      ))}
    </section>
  );
}
