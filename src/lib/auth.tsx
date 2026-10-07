import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/auth-js';
import { supabase } from './supabase';
import { queryClient, queryPersister } from './queryClient';
import { setAccessDenied } from './accessDenied';
import { clearAllDrafts } from './drafts';
import { authClientOptions } from './authClientOptions';
import { savedSessionUser, startupOutcome } from './savedSession';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  loginWithEmail: (email: string, redirectTo?: string, captchaToken?: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The actual sign-out call, exported standalone so non-component code
 * (apiClient's 401/403 handling) can trigger it without needing a hook. The
 * AuthProvider's single onAuthStateChange subscription picks up the
 * resulting session change and AuthGate re-renders Login - no other caller
 * needs to touch `user` state or navigate anywhere.
 *
 * The query cache is dropped here, not left to expire. Sign-out is soft (no
 * page reload), so without this the next person to sign in on a shared phone
 * inherits the previous user's cached responses - and ['myProfile'] is
 * staleTime: Infinity, so they would keep someone else's coach status until
 * the tab was reloaded.
 *
 * THIS DEVICE ONLY (scope: 'local'). Without a scope Supabase signs the user
 * out everywhere - revoking the refresh token their phone relies on - so one
 * late 401 on a laptop, or pressing Log out on a shared machine, signed them
 * out of the app on every device (2026-09-23). Signing out here should never
 * cost them anything anywhere else.
 *
 * The copy of their profile, fixtures and tasks kept on the phone goes first,
 * whatever Supabase answers (Log out, a refused refresh, Delete my profile).
 */
export async function signOut(): Promise<void> {
  void queryPersister.clear();
  await supabase.auth.signOut({ scope: 'local' });
  queryClient.clear();
  // A denial belongs to the session that earned it. Left set, the next
  // person to sign in on a shared phone would meet someone else's refusal.
  setAccessDenied(null);
}

/** The person in the session auth-js saved on this device, if it can still be refreshed. Read only. */
function readSavedSessionUser(): User | null {
  try {
    const { storageKey } = authClientOptions(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
    return savedSessionUser(localStorage.getItem(storageKey!));
  } catch {
    return null;
  }
}

/** One getSession() + one onAuthStateChange subscription for the whole app. */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Opens as the person whose session is saved here, without waiting for
  // getSession() to refresh their token over the network (savedSession.ts).
  // Their own kept fixtures show at once; getSession() confirms behind them.
  const [openedAs] = useState(readSavedSessionUser);
  const [user, setUser] = useState<User | null>(openedAs);
  const [loading, setLoading] = useState(openedAs === null);

  useEffect(() => {
    let isMounted = true;

    // 1. Initial load: getSession() parses the magic link hash, refreshes an
    // expired token and establishes the session.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!isMounted) return;
      const outcome = startupOutcome(openedAs, { session, error });
      if (outcome.kind === 'signed-in') {
        // Someone other than the person the app opened as: what's on screen
        // was theirs. setOwner wipes the kept copy; the in-memory cache goes here.
        if (outcome.clearCache) queryClient.clear();
        queryPersister.setOwner(outcome.user.id);
        setUser(outcome.user);
      } else if (outcome.kind === 'signed-out') {
        // Signed out: a refresh Supabase refused while starting up lands
        // here, not in the listener. The kept copy goes, and so does anything
        // shown from it.
        void queryPersister.clear();
        if (outcome.clearCache) queryClient.clear();
        setUser(null);
      } else {
        // No connection: nothing is known yet. Stay as the app opened (the
        // kept copy keeps showing); requests refresh or sign out as they go.
        setUser(outcome.user);
      }
      setLoading(false);

      // Safety net: manually clean up the URL hash if Supabase didn't clear it
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });

    // 2. Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      // The first answer is getSession()'s to handle (above). Taking it here
      // too would drop the person the app opened as whenever starting up
      // couldn't reach Supabase.
      if (event === 'INITIAL_SESSION') return;
      // What's kept on the phone belongs to whoever is signed in. A lapsed
      // session (Supabase refused the refresh) wipes it like Log out does; a
      // different person signing in wipes the last one's.
      if (event === 'SIGNED_OUT') void queryPersister.clear();
      else queryPersister.setOwner(session?.user?.id ?? null);
      // Whoever just arrived deserves a clean slate; the refusal that was on
      // screen was about the previous session.
      setAccessDenied(null);
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
  // `redirectTo` brings the magic link back to a page (the join page); the
  // code works wherever they are. `captchaToken` is the Turnstile token
  // (components/Turnstile.tsx), which Supabase Auth requires once CAPTCHA
  // protection is on.
  const loginWithEmail = async (email: string, redirectTo?: string, captchaToken?: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo ?? window.location.origin, captchaToken },
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
    // Log out (not a lapsed session) also drops form drafts kept on this
    // device, so the next person on a shared phone can't see them.
    clearAllDrafts();
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
