import { AuthClient } from '@supabase/auth-js';
import { authClientOptions } from './authClientOptions';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Sign-in only: app data comes from the Worker, so the rest of supabase-js
// (database, storage, realtime) is not bundled.
export const supabase = { auth: new AuthClient(authClientOptions(supabaseUrl, supabaseAnonKey)) };
