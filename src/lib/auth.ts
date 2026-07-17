import { supabase } from './supabase';

export async function getCurrentSupabaseUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
