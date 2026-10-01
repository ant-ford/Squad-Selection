import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { setAccessDenied } from '@/lib/accessDenied';
import { ApiError } from '@/lib/apiClient';
import { registerInterest } from '@/api/trials';
import Login from '@/pages/Login';

const REF_KEY = 'join:ref';
const PENDING_KEY = 'join:pending';

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows: the link's ref just isn't remembered across the sign-in email.
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The link a member shares with someone who'd like to join (/join?ref=<the
 * member>). They confirm their email with a code, which signs them up at
 * "1. Trial Application", then fill in their details on the applicant page.
 * The ref and "signing up" are remembered so a magic link that lands on the
 * home page comes back here (App.tsx AuthGate).
 */
export default function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();
  const [done, setDone] = useState<null | 'member'>(null);

  useEffect(() => {
    const ref = params.get('ref');
    if (ref) store(REF_KEY, ref);
    store(PENDING_KEY, '1');
  }, [params]);

  const register = useMutation({
    mutationFn: () => registerInterest(read(REF_KEY)),
    onSuccess: (r) => {
      store(PENDING_KEY, null);
      store(REF_KEY, null);
      if (r.status === 'member') {
        setDone('member');
        return;
      }
      // They have a People record now: the app's earlier "not authorised" no longer holds.
      setAccessDenied(null);
      void queryClient.invalidateQueries();
      navigate('/apply', { replace: true });
    },
  });

  useEffect(() => {
    if (user && register.isIdle) register.mutate();
  }, [user, register]);

  if (isLoading) return null;
  if (!user) {
    return (
      <Login
        title="Join HKFC Hockey"
        intro="Interested in playing hockey with us? Enter your email and we'll send you a code, then tell us about yourself."
        redirectTo={`${window.location.origin}/join`}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded-lg border border-border shadow-lg space-y-3 text-center">
        {done === 'member' ? (
          <>
            <p className="text-sm text-foreground">You're already in Eddy, so there's nothing to register.</p>
            <button className="text-sm text-primary underline" onClick={() => navigate('/', { replace: true })}>
              Go to the app
            </button>
          </>
        ) : register.isError ? (
          <>
            <p className="text-sm text-foreground">{register.error instanceof ApiError ? register.error.message : "Couldn't sign you up just now."}</p>
            <button className="text-sm text-primary underline" onClick={() => register.mutate()}>
              Try again
            </button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you up…</p>
        )}
      </div>
    </div>
  );
}
