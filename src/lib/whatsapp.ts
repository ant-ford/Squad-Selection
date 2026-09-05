import { safeFormat } from './dateUtils';

/**
 * WhatsApp "click to chat" helpers.
 *
 * No WhatsApp Business account, API or approval is involved: a wa.me link
 * opens WhatsApp on the coach's own device with the message pre-filled and
 * the coach presses send. Nothing is sent by the app.
 */

export const HK_COUNTRY_CODE = '852';

/** Digits-only E.164 bounds (country code + subscriber number). */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Normalise a stored phone number into the digits-only international form
 * wa.me requires, e.g. "85291234567".
 *
 * Returns `null` whenever the number cannot be normalised with confidence.
 * That matters more than it looks: wa.me happily opens WhatsApp with an
 * unusable recipient, so a bad number looks to the coach exactly like a
 * message that went through. Callers must disable the action on null rather
 * than build a link anyway.
 *
 * Accepted shapes:
 *  - explicit international ("+852 9123 4567", "0085291234567")
 *  - already-international HK digits ("852 9123 4567")
 *  - bare 8-digit local HK numbers ("9123 4567") -> assumed +852
 */
export function toWhatsAppNumber(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const isExplicitInternational = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (isExplicitInternational) {
    // Already international; digits stand as-is.
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2); // the other international prefix
  } else if (digits.length === 8) {
    digits = HK_COUNTRY_CODE + digits; // local HK mobile
  } else if (digits.startsWith(HK_COUNTRY_CODE) && digits.length === 11) {
    // Stored international without a leading + or 00.
  } else {
    // Anything else (truncated, extension-laden, unknown country) is
    // ambiguous. Refuse rather than guess.
    return null;
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return digits;
}

export interface FixtureBrief {
  hkfcTeam: string;
  opponent: string;
  /** ISO date-time of the fixture. */
  date: string;
  venue?: string;
  kit?: 'Blue' | 'White' | '';
}

function fixtureLine(f: FixtureBrief): string {
  const when = `${safeFormat(f.date, 'EEE d MMM')} at ${safeFormat(f.date, 'HH:mm')}`;
  const where = f.venue ? `, ${f.venue}` : '';
  return `${f.hkfcTeam} vs ${f.opponent}, ${when}${where}`;
}

/** Message for one selected player. */
export function buildSelectionMessage(playerName: string, f: FixtureBrief): string {
  const kit = f.kit ? `\n${f.kit} kit.` : '';
  return (
    `Hi ${playerName}, you've been selected for ${fixtureLine(f)}.${kit}` +
    `\n\nPlease confirm you can play.`
  );
}

/**
 * Squad announcement for pasting into an existing team group chat. wa.me
 * addresses exactly one recipient, so there is no link that messages a whole
 * squad - the coach copies this and pastes it into the group they already
 * have.
 */
export function buildSquadAnnouncement(f: FixtureBrief, playerNames: string[]): string {
  const kit = f.kit ? `\n${f.kit} kit.` : '';
  const squad = playerNames.length
    ? `\n\nSquad:\n${playerNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
    : '';
  return `Squad for ${fixtureLine(f)}.${kit}${squad}`;
}

/**
 * wa.me link for one recipient. `number` must already have been through
 * toWhatsAppNumber.
 */
export function whatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
