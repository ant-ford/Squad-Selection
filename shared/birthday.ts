/**
 * Birthdays as "MM-DD", with no year.
 *
 * The banner only needs the day. Keeping the year out of the Player shape
 * means no response, cache entry or log line built from a Player can reveal
 * someone's age.
 */

/** "MM-DD" from an Airtable date ("YYYY-MM-DD"), or undefined if there is none. */
export function birthdayKey(dateOfBirth: unknown): string | undefined {
  if (typeof dateOfBirth !== "string") return undefined;
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(dateOfBirth);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * True when `birthday` ("MM-DD") falls on `today` ("YYYY-MM-DD", a Hong Kong
 * calendar day from hkDateKey). A 29 February birthday is celebrated on
 * 28 February in years without one, rather than being skipped.
 */
export function isBirthdayOn(birthday: string | undefined, today: string): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const monthDay = today.slice(5);
  if (birthday === monthDay) return true;
  return birthday === "02-29" && monthDay === "02-28" && !isLeapYear(Number(today.slice(0, 4)));
}

/**
 * The day someone turns `age` ("YYYY-MM-DD"), from their date of birth. A
 * 29 February birthday falls on 28 February in a year without one.
 */
export function birthdayAtAge(dateOfBirth: unknown, age: number): string | undefined {
  if (typeof dateOfBirth !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!match) return undefined;
  const year = Number(match[1]) + age;
  const day = match[2] === "02" && match[3] === "29" && !isLeapYear(year) ? "28" : match[3];
  return `${year}-${match[2]}-${day}`;
}
