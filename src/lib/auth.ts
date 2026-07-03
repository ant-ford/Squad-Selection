import { supabase } from './supabase';
import { peopleRepository } from '@/repositories/peopleRepository';

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
 */
export async function getCurrentPeople() {
  const user = await getCurrentSupabaseUser();
  if (!user) throw new Error('Not authenticated');
  if (!user.email) throw new Error('User has no email address');

  const people = await peopleRepository.getByEmail(user.email);
  if (!people) throw new Error('Player record not found for this email');

  return people;
}