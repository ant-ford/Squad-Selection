import type { GoTrueClientOptions } from '@supabase/auth-js';

/**
 * What supabase-js's createClient(url, key) hands its auth client, so the
 * standalone AuthClient reads the session supabase-js saved: same storage key
 * in localStorage, same auth URL and apikey, same refresh and magic-link
 * handling. Change nothing here without tests/authClientOptions.test.ts.
 */
export function authClientOptions(supabaseUrl: string, supabaseKey: string): GoTrueClientOptions {
  const trimmed = supabaseUrl.trim();
  const baseUrl = new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`);
  return {
    url: new URL('auth/v1', baseUrl).href,
    headers: { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey },
    storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    hasCustomAuthorizationHeader: false,
  };
}
