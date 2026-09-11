/**
 * One definition of "the same email address", for the browser and the
 * Worker alike.
 *
 * Every store in this system disagrees about case. Supabase holds whatever
 * the account was created with, Airtable holds whatever an administrator
 * typed, and a phone keyboard will happily capitalise the first letter of
 * an address as it is entered. Comparing any two of those directly fails
 * for reasons nobody can see, and the failure looks like "the app is
 * broken" rather than "your J is a capital".
 *
 * So every comparison, lookup and sign-in call goes through this, and
 * whitespace goes with it: a trailing space from autofill or a paste is
 * just as invisible and just as fatal.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
