import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { askToBeReactivated, getReactivationStatus } from '@/api/reactivation';
import { safeFormat } from '@/lib/dateUtils';
import { setAccessDenied } from '@/lib/accessDenied';
import { signOut } from '@/lib/auth';

/**
 * Shown when the API says this person is authenticated but not authorised:
 * an email with no People record, or a record that is not Active and has no
 * coach link.
 *
 * This screen exists so the app no longer signs them out. Being refused
 * access is not a reason to throw away a valid session, and doing so meant
 * another trip through the email every single time - which is what players
 * reported as "I have to log in every time".
 *
 * Retry matters more than it looks: the People lookup is cached for 60
 * seconds, so the first attempt straight after an administrator ticks the
 * box will usually still fail.
 *
 * "Ask to be reactivated" puts a task in every Section Captain's My Tasks
 * (worker/src/reactivation.ts); the first to answer decides.
 */
export default function AccessNotActive({ message }: { message: string }) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const status = useQuery({ queryKey: ['reactivationStatus'], queryFn: getReactivationStatus, retry: false });
  const ask = useMutation({
    mutationFn: askToBeReactivated,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reactivationStatus'] }),
  });
  const askedAt = ask.data?.askedAt ?? status.data?.askedAt ?? null;
  const askProblem =
    ask.data?.status === 'nobody'
      ? 'There is no member record for this email. Register your interest below.'
      : ask.data?.status === 'no-captains'
        ? 'There is no Section Captain to ask. Email info@eddy.global.'
        : ask.isError
          ? 'Could not send. Try again.'
          : null;

  const retry = async () => {
    setRetrying(true);
    setAccessDenied(null);
    try {
      await queryClient.refetchQueries();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-amber-700" />
        </div>

        <h1 className="text-lg font-semibold text-foreground">Your access is not active</h1>

        <p className="mt-2 text-sm text-muted-foreground">{message}</p>

        <p className="mt-3 text-sm text-muted-foreground">
          You are signed in, so nothing is wrong with your email or your code. Your
          record just needs activating by the section captain.
        </p>

        <button
          onClick={retry}
          disabled={retrying}
          className="mt-6 w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
        >
          {retrying ? 'Checking…' : 'Try again'}
        </button>

        {askedAt ? (
          <p className="mt-3 text-sm text-muted-foreground">Asked to be reactivated on {safeFormat(askedAt, 'd MMM')}.</p>
        ) : (
          <button
            onClick={() => ask.mutate()}
            disabled={ask.isPending}
            className="mt-3 w-full py-2.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {ask.isPending ? 'Asking…' : 'Ask to be reactivated'}
          </button>
        )}
        {askProblem && <p className="mt-2 text-xs text-destructive">{askProblem}</p>}

        {/* Someone with no record yet may be here to join, not a lapsed member. */}
        <p className="mt-4 text-sm text-muted-foreground">
          Not a member yet?{' '}
          <a href="/join" className="text-primary underline">
            Register your interest in joining
          </a>
        </p>

        <p className="mt-2 text-xs text-muted-foreground">
          Just been activated? Give it a minute before trying, then tap above.
        </p>

        <div className="mt-6 flex flex-col gap-2 text-xs">
          <button
            onClick={() => void signOut()}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
