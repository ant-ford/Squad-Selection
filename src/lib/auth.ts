import { supabase } from './supabase';
import { apiGet } from './apiClient';
import type { Player } from '@/generated/domainTypes';

/**
 * Get the current authenticated Supabase user.
 * Returns null if not logged in.
 */
export async function getCurrentSupabaseUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the People record linked to the current Supabase user via email.
 * Throws if not found.
 *
 * Previously called peopleRepository.getByEmail() directly against
 * Airtable from the browser. Now goes through the Worker's
 * GET /api/player-by-email endpoint instead.
 */
export async function getCurrentPeople(): Promise<Player> {
  const user = await getCurrentSupabaseUser();
  if (!user) throw new Error('Not authenticated');
  if (!user.email) throw new Error('User has no email address');

  return apiGet<Player>('/api/player-by-email', { email: user.email });
}
