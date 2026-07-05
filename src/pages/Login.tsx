import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithEmail, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();

    // TypeScript: ensure the event target is the form
    const form = e.target as HTMLFormElement | null;
    if (!form) return;

    setLoading(true);

    try {
      await loginWithEmail(email);
      toast.success('Magic link sent! Check your email.');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to send link';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded-lg border border-border">
        <h1 className="text-2xl font-bold text-foreground mb-6">HKFC Hockey</h1>
        <p className="text-muted-foreground mb-6">
          Enter your email to receive a magic link
        </p>

        {/* Modern React 19: use native DOM event type */}
        <form onSubmit={(e) => handleSubmit(e as unknown as SubmitEvent)}>
          <input
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEmail(e.target.value)
            }
            placeholder="your@email.com"
            required
            className="w-full p-2 border border-border rounded mb-4 bg-background text-foreground"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2 rounded hover:bg-primary/90 transition-colors"
          >
            {loading ? 'Sending...' : 'Send Magic Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
