import { fixtureChangeText, type FixtureChange } from '@shared/fixtureChange';
import { safeFormat } from './dateUtils';
import { POS_SHORT } from './format';
import { positionRank } from './squadSort';

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
  /**
   * Link that opens this fixture on the player's own page (see fixtureLink),
   * where they answer for it. Optional so a message can still be built
   * before the match id is known.
   */
  link?: string;
  /** Moved, venue changed, postponed or cancelled in the last 7 days. */
  change?: FixtureChange;
}

/**
 * Shareable link to one fixture: it opens the player's page with that
 * fixture's availability sheet up, the same way ?event= opens an event.
 * Built on whichever address the app is open at, so preview links stay on
 * preview.
 */
export function fixtureLink(origin: string, matchId: string): string {
  return `${origin}/?fixture=${encodeURIComponent(matchId)}`;
}

function linkLine(f: FixtureBrief): string {
  return f.link ? `\n\nConfirm or say you can't make it: ${f.link}` : '';
}

function fixtureLine(f: FixtureBrief): string {
  const when = `${safeFormat(f.date, 'EEE d MMM')} at ${safeFormat(f.date, 'HH:mm')}`;
  const where = f.venue ? `, ${f.venue}` : '';
  return `${f.hkfcTeam} vs ${f.opponent}, ${when}${where}`;
}

/** Message for a player taken out of the squad after it was sent. */
export function buildDroppedMessage(playerName: string, f: FixtureBrief): string {
  return `Hi ${playerName}, the squad for ${fixtureLine(f)} has changed and you're not in it this time. Thanks for being available.`;
}

/**
 * The team-group message about a fixture that moved or was called off
 * (NotifySquadSheet), or null when nothing changed.
 */
export function buildChangeMessage(f: FixtureBrief): string | null {
  if (!f.change) return null;
  const game = `${f.hkfcTeam} vs ${f.opponent} on ${safeFormat(f.date, 'EEE d MMM')}`;
  if (f.change.kind === 'postponed') return `${game} is postponed. The new date will follow.`;
  if (f.change.kind === 'cancelled') return `${game} is cancelled.`;
  const was = fixtureChangeText(f.change, f.date);
  return `Change: ${fixtureLine(f)} (${was[0].toLowerCase()}${was.slice(1)}).`;
}

/** Message for one selected player. */
export function buildSelectionMessage(playerName: string, f: FixtureBrief): string {
  const kit = f.kit ? `\n${f.kit} kit.` : '';
  return (
    `Hi ${playerName}, you've been selected for ${fixtureLine(f)}.${kit}` +
    (f.link ? linkLine(f) : `\n\nPlease confirm you can play.`)
  );
}

/**
 * Squad announcement for pasting into an existing team group chat. wa.me
 * addresses exactly one recipient, so there is no link that messages a whole
 * squad - the coach copies this and pastes it into the group they already
 * have. The fixture link at the end is the group's "poll": each player taps
 * it and answers in Eddy, against their own name.
 *
 * The squad is grouped like a team sheet (GK, DEF, MID, FWD, FLEX, then
 * anyone without a position) with shirt numbers. Within a position players
 * keep the order they arrive in, which on the squad screen is the coach's
 * strongest-first order.
 */
export function buildSquadAnnouncement(f: FixtureBrief, players: AnnouncedPlayer[]): string {
  const kit = f.kit ? `\n${f.kit} kit.` : '';
  return `Squad for ${fixtureLine(f)}.${kit}${squadBlock(players)}${linkLine(f)}`;
}

/**
 * Availability request for the team group, for before anyone is selected:
 * the fixture and its link, no squad. Players answer in Eddy, and the coach
 * then picks from those who said yes.
 */
export function buildAvailabilityRequest(f: FixtureBrief): string {
  const ask = f.link
    ? `Please mark whether you can play in Eddy: ${f.link}`
    : 'Please mark whether you can play in Eddy.';
  return `Availability for ${fixtureLine(f)}.\n\n${ask}`;
}

/**
 * A nudge for one player who hasn't opened Eddy for weeks ("not seen" on the
 * squad screen). It goes through WhatsAppListSheet, which fills in
 * {first name} for each person.
 */
export function buildNotSeenNudge(f: FixtureBrief): string {
  const ask = f.link ? `Please answer in Eddy: ${f.link}` : 'Please answer in Eddy.';
  return `Hi {first name}, can you play in ${fixtureLine(f)}? ${ask}`;
}

export interface AnnouncedPlayer {
  name: string;
  shirtNo?: string;
  /** People."Playing Position" as stored, e.g. "Defender". */
  position?: string;
}

function squadBlock(players: AnnouncedPlayer[]): string {
  if (!players.length) return '';
  // sort() is stable, so the caller's order survives within a position.
  const sorted = [...players].sort(
    (a, b) => positionRank(a.position ?? '') - positionRank(b.position ?? ''),
  );
  const groups: { label: string; lines: string[] }[] = [];
  for (const p of sorted) {
    const label = POS_SHORT[p.position ?? ''] ?? 'Other';
    const number = p.shirtNo?.trim();
    const line = number ? `#${number} ${p.name}` : p.name;
    const last = groups[groups.length - 1];
    if (last?.label === label) last.lines.push(line);
    else groups.push({ label, lines: [line] });
  }
  // *...* is WhatsApp bold.
  const body = groups.map((g) => `*${g.label}*\n${g.lines.join('\n')}`).join('\n\n');
  return `\n\nSquad (${players.length}):\n\n${body}`;
}

/**
 * wa.me link for one recipient. `number` must already have been through
 * toWhatsAppNumber.
 */
export function whatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
