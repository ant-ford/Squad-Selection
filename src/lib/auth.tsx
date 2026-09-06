import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  loginWithEmail: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The actual sign-out call, exported standalone so non-component code
 * (apiClient's 401 handling) can trigger it without needing a hook. The
 * AuthProvider's single onAuthStateChange subscription picks up the
 * resulting session change and AuthGate re-renders Login - no other caller
 * needs to touch `user` state or navigate anywhere.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** One getSession() + one onAuthStateChange subscription for the whole app. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // 1. Initial load: getSession() parses the magic link hash and establishes the session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setUser(session?.user ?? null);
      setLoading(false);

      // Safety net: manually clean up the URL hash if Supabase didn't clear it
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });

    // 2. Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  // Sends the sign-in email. The Supabase template carries BOTH a magic link
  // and a 6-digit code, so either route signs the same person in. The code
  // exists because corporate mail scanners (Outlook Safe Links, Mimecast,
  // Proofpoint) pre-fetch links to inspect them, which burns the single-use
  // magic-link token before the recipient ever clicks it.
  const loginWithEmail = async (email: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  // Code path of the same sign-in. On success Supabase persists the session
  // and fires onAuthStateChange, so the listener above picks the user up and
  // callers don't need to set any state themselves.
  const verifyEmailOtp = async (email: string, token: string): Promise<void> => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  };

  const logout = async (): Promise<void> => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: loading, loginWithEmail, verifyEmailOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
