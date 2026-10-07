import { ClipboardCheck, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MyTask } from '@/api/getMyTasks';
import { useMyTasks } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { hkSeasonLabel } from '@/lib/season';

/** "sponsor" / "Chairman" / "Membership Officer", as said in a sentence. */
const as = (role: MyTask['role']) => (role === 'Sponsor' ? 'sponsor' : role ?? '');

export function taskTitle(task: MyTask): string {
  const who = task.subject ?? 'an applicant';
  switch (task.key) {
    case 'system':
      return 'System check failed';
    case 'joiner':
      return 'Complete your New Joiner Form';
    case 'statement':
      return 'Complete your Player Statement';
    case 'waivers':
      return "Complete this season's Waivers & Declarations";
    case 'details':
      return `Check your details for ${hkSeasonLabel()}`;
    case 'application':
      return task.role === 'Sponsor'
        ? `Support ${who}'s membership application`
        : `Sign ${who}'s membership application as ${as(task.role)}`;
    case 'send':
      return `Check and send ${who}'s application`;
    case 'accept':
      return `Accept ${who} as a member`;
    case 'review':
      return `Complete ${who}'s Player Statement as ${as(task.role)}`;
    case 'kit':
      return `Kit for ${task.subject ?? 'a new joiner'}`;
    case 'registration':
      return `Register ${task.subject ?? 'a new joiner'} with HockeyHK`;
    case 'reactivate':
      return `${task.subject ?? 'A member'} asks to be reactivated`;
    case 'duty':
      return task.subject ?? 'One of your umpiring duties changed';
    case 'event':
      return `${task.subject ?? 'An event'}: are you coming?`;
    case 'register':
      return `Take the register for ${task.subject ?? 'your event'}`;
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
            {task.due && <p className="text-xs text-muted-foreground mt-0.5">Answer by {safeFormat(task.due, 'EEE d MMM, HH:mm')}</p>}
          </div>
          {task.url &&
            // Eddy's own screens open in place; the Fillout forms in a new tab.
            (task.url.startsWith('/') ? (
              <Link
                to={task.url}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Open
              </Link>
            ) : (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Open form <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ))}
        </div>
      ))}
    </section>
  );
}
