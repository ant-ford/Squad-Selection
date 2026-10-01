/**
 * Phone numbers as the forms take them: a country code chosen from a list and
 * the number typed after it. Stored as Airtable kept them, "+852 9123 4567"
 * for Hong Kong and "+44 7911123456" elsewhere, so existing answers read back.
 */

/** Common codes first (Hong Kong, then the section's usual nationalities), then the rest by name. */
export const COUNTRY_CODES: { code: string; name: string }[] = [
  { code: "+852", name: "Hong Kong" },
  { code: "+853", name: "Macau" },
  { code: "+86", name: "China" },
  { code: "+44", name: "United Kingdom" },
  { code: "+61", name: "Australia" },
  { code: "+64", name: "New Zealand" },
  { code: "+27", name: "South Africa" },
  { code: "+91", name: "India" },
  { code: "+92", name: "Pakistan" },
  { code: "+1", name: "USA / Canada" },
  { code: "+353", name: "Ireland" },
  { code: "+31", name: "Netherlands" },
  { code: "+49", name: "Germany" },
  { code: "+33", name: "France" },
  { code: "+32", name: "Belgium" },
  { code: "+41", name: "Switzerland" },
  { code: "+54", name: "Argentina" },
  { code: "+358", name: "Finland" },
  { code: "+65", name: "Singapore" },
  { code: "+60", name: "Malaysia" },
  { code: "+81", name: "Japan" },
  { code: "+82", name: "South Korea" },
  { code: "+63", name: "Philippines" },
  { code: "+66", name: "Thailand" },
  { code: "+62", name: "Indonesia" },
  { code: "+84", name: "Vietnam" },
  { code: "+886", name: "Taiwan" },
  { code: "+971", name: "United Arab Emirates" },
  { code: "+34", name: "Spain" },
  { code: "+39", name: "Italy" },
  { code: "+351", name: "Portugal" },
  { code: "+45", name: "Denmark" },
  { code: "+46", name: "Sweden" },
  { code: "+47", name: "Norway" },
];

const HK = "+852";

/** A stored number split into its code and the rest (digits and spaces). Hong Kong when it has no code. */
export function splitPhone(value: string | null | undefined): { code: string; number: string } {
  const v = (value ?? "").trim();
  if (!v.startsWith("+")) return { code: HK, number: v };
  const compact = v.replace(/\s/g, "");
  // The longest code that fits: "+852..." isn't "+8...".
  const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length).find((c) => compact.startsWith(c.code));
  if (!match) return { code: v.split(/\s/)[0], number: v.split(/\s/).slice(1).join(" ") };
  return { code: match.code, number: compact.slice(match.code.length) };
}

/** A code and a typed number as stored: "+852 9123 4567", or "+44 7911123456". */
export function joinPhone(code: string, number: string): string {
  const digits = number.replace(/\D/g, "");
  if (!digits) return "";
  if (code === HK && digits.length === 8) return `${HK} ${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${code} ${digits}`;
}

/** Why a stored phone number isn't right, or null. Hong Kong numbers are 8 digits. */
export function phoneProblem(value: string): string | null {
  const { code, number } = splitPhone(value);
  const digits = number.replace(/\D/g, "");
  if (!/^\+\d{1,4}$/.test(code)) return "choose the country code";
  if (code === HK) return digits.length === 8 ? null : "a Hong Kong number has 8 digits";
  return digits.length >= 6 && digits.length <= 14 ? null : "that doesn't look like a phone number";
}

/**
 * Hong Kong identity card numbers: one or two letters, six digits and a check
 * digit (0-9 or A), written A123456(7). The check digit is the card's own
 * (weights 9 down to 2 over the letters, A=10, and a space for a single
 * letter, then the digits; 11 minus the remainder of 11).
 */
export function hkidCheckDigit(letters: string, digits: string): string {
  const two = letters.length === 1 ? ` ${letters}` : letters;
  const v = (ch: string) => (ch === " " ? 36 : ch.charCodeAt(0) - 55);
  let sum = 9 * v(two[0]) + 8 * v(two[1]);
  for (let i = 0; i < 6; i++) sum += (7 - i) * Number(digits[i]);
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "A" : String(r);
}

/** An HKID number written the standard way, A123456(7), or null if it isn't a valid one. */
export function normaliseHkid(value: string): string | null {
  const m = /^([A-Z]{1,2})([0-9]{6})\(?([0-9A])\)?$/.exec(value.toUpperCase().replace(/[\s-]/g, ""));
  if (!m) return null;
  return hkidCheckDigit(m[1], m[2]) === m[3] ? `${m[1]}${m[2]}(${m[3]})` : null;
}
