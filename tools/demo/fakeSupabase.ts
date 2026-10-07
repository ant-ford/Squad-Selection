// Stand-in for src/lib/supabase.ts, swapped in by tools/demo/plugin.mjs.
// Always signed in, as the persona named by `?as=<persona>` in the address
// (remembered for the tab, so moving between screens keeps it). The persona
// rides in the access token, which the demo API reads, so two tabs can be two
// people at once. `?signedout` shows the sign-in screen instead.

const KEY = 'eddy-demo-persona';
const params = new URLSearchParams(location.search);
const asParam = params.get('as');
if (asParam) sessionStorage.setItem(KEY, asParam);
const persona = sessionStorage.getItem(KEY) ?? 'player';
const signedOut = params.has('signedout');

const session = signedOut
  ? null
  : {
      access_token: `demo.${persona}`,
      refresh_token: 'demo-refresh',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: `demo-${persona}`, email: `${persona}@example.com`, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
    };

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    refreshSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithOtp: async () => ({ data: {}, error: null }),
    verifyOtp: async () => ({ data: { session }, error: null }),
  },
} as any;
