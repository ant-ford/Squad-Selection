import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useMyProfile } from '@/lib/queries';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const CODE_LENGTH = 6;

// Which address we last sent a code to. Checking email means leaving the
// app - switching to the mail app on a phone, or reloading - and without
// this the player came back to the email form with a code and nowhere to
// type it. Session-scoped: it is a convenience, not a credential.
const PENDING_EMAIL_KEY = 'login:pendingEmail';

function readPendingEmail(): string {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function writePendingEmail(value: string | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_EMAIL_KEY, value);
    else sessionStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Blocked storage just means we lose the resume; the flow still works.
  }
}

export default function Login() {
  const [email, setEmail] = useState(() => readPendingEmail());
  const [code, setCode] = useState('');
  // 'request' collects the email; 'verify' accepts the code. We resume
  // straight into 'verify' when a send is already outstanding.
  const [step, setStep] = useState<'request' | 'verify'>(() =>
    readPendingEmail() ? 'verify' : 'request',
  );
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const { loginWithEmail, verifyEmailOtp, user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    // Wait for profile to resolve before deciding where to send them.
    if (profileLoading) return;
    if (profile?.isCoach) {
      navigate('/coach', { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [user, profile, profileLoading, navigate]);

  const sendEmail = async (): Promise<boolean> => {
    setSending(true);
    try {
      await loginWithEmail(email);
      toast.success('Email sent! Use the link or enter the code below.');
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to send email';
      toast.error(message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await sendEmail()) {
      writePendingEmail(email);
      setStep('verify');
    }
  };

  /** Cross-device case: the code arrived on a phone, the app is on a laptop. */
  const haveACode = () => {
    if (email.trim()) writePendingEmail(email.trim());
    setStep('verify');
  };

  const handleResend = async () => {
    setCode('');
    await sendEmail();
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setVerifying(true);
    try {
      // On success the auth listener picks up the session and the redirect
      // effect above takes over.
      await verifyEmailOtp(email, code.trim());
      writePendingEmail(null); // signed in; nothing outstanding to resume
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Invalid or expired code';
      toast.error(message);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const startOver = () => {
    writePendingEmail(null);
    setStep('request');
    setCode('');
  };

  if (user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded-lg border border-border shadow-lg">
        <div className="flex justify-center mb-6">
          <img
            src="/assets/logo-animated.svg"
            alt="Eddy"
            className="h-24 w-48 object-contain"
          />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-6 text-center">
          HKFC Squad Manager
        </h1>

        {step === 'request' ? (
          <>
            <p className="text-muted-foreground mb-6 text-center">
              Enter your email to sign in
            </p>
            <form onSubmit={handleRequest}>
              <input
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setEmail(e.target.value)
                }
                placeholder="your@email.com"
                autoComplete="email"
                required
                className="w-full p-2 border border-border rounded mb-4 bg-background text-foreground"
              />
              <button
                type="submit"
                disabled={sending}
                className="w-full bg-primary text-primary-foreground py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {sending ? 'Sending...' : 'Send Sign-In Email'}
              </button>
            </form>
            {/* Someone who already has a code — read on another device, or
                after this tab reloaded — needs a way back to the code box. */}
            <button
              type="button"
              onClick={haveACode}
              className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              I already have a code
            </button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground mb-2 text-center">
              We sent an email to{' '}
              <span className="font-medium text-foreground">{email || 'your address'}</span>
            </p>
            <p className="text-muted-foreground mb-4 text-center text-sm">
              Tap the link in that email, or type its {CODE_LENGTH}-digit code here.
            </p>
            {!email && (
              <input
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                required
                className="w-full p-2 border border-border rounded mb-3 bg-background text-foreground"
              />
            )}
            <form onSubmit={handleVerify}>
              <input
                type="text"
                value={code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                }
                placeholder={'0'.repeat(CODE_LENGTH)}
                // one-time-code lets iOS/Android offer the code straight from
                // the notification instead of making people switch apps.
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern={`\\d{${CODE_LENGTH}}`}
                maxLength={CODE_LENGTH}
                autoFocus
                required
                className="w-full p-2 border border-border rounded mb-4 bg-background text-foreground text-center text-2xl tracking-[0.4em] font-mono"
              />
              <button
                type="submit"
                disabled={verifying || code.length !== CODE_LENGTH}
                className="w-full bg-primary text-primary-foreground py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {verifying ? 'Verifying...' : 'Sign In'}
              </button>
            </form>
            <div className="flex justify-between mt-4 text-xs">
              <button
                type="button"
                onClick={startOver}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={sending}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
              >
                {sending ? 'Sending...' : 'Resend email'}
              </button>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Don't see the email? Please check your junk or spam folder.
        </p>
      </div>
    </div>
  );
}
