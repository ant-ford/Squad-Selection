import { describe, it, expect } from 'vitest';
import {
  buildAvailabilityRequest,
  buildNotSeenNudge,
  buildSelectionMessage,
  buildSquadAnnouncement,
  fixtureLink,
  toWhatsAppNumber,
  whatsAppLink,
  type FixtureBrief,
} from '../src/lib/whatsapp';
import { fillMessage } from '../shared/messageTemplates';

// A wa.me link built from a bad number opens WhatsApp with no usable
// recipient, which looks to the coach exactly like a message that sent. The
// normaliser must therefore refuse anything ambiguous rather than guess.
describe('toWhatsAppNumber', () => {
  it('adds the HK country code to a bare 8-digit local number', () => {
    expect(toWhatsAppNumber('91234567')).toBe('85291234567');
    expect(toWhatsAppNumber('9123 4567')).toBe('85291234567');
    expect(toWhatsAppNumber('9123-4567')).toBe('85291234567');
  });

  it('accepts explicit international numbers', () => {
    expect(toWhatsAppNumber('+852 9123 4567')).toBe('85291234567');
    expect(toWhatsAppNumber('+44 7700 900123')).toBe('447700900123');
    expect(toWhatsAppNumber('0085291234567')).toBe('85291234567');
  });

  it('accepts HK numbers already stored international without a plus', () => {
    expect(toWhatsAppNumber('852 9123 4567')).toBe('85291234567');
  });

  it('refuses anything it cannot place with confidence', () => {
    expect(toWhatsAppNumber('12345')).toBeNull(); // too short, no country code
    expect(toWhatsAppNumber('9123456')).toBeNull(); // 7 digits: truncated
    expect(toWhatsAppNumber('912345678')).toBeNull(); // 9 digits: not HK-local, no code
    expect(toWhatsAppNumber('abc')).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber('   ')).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });

  it('rejects numbers beyond E.164 length', () => {
    expect(toWhatsAppNumber(`+${'9'.repeat(16)}`)).toBeNull();
  });
});

const FIXTURE: FixtureBrief = {
  hkfcTeam: 'HKFC B',
  opponent: 'Kowloon',
  date: '2026-09-12T15:00:00.000Z',
  venue: 'KP',
  kit: 'Blue',
};

describe('message building', () => {
  it('names the player, the fixture and the kit', () => {
    const msg = buildSelectionMessage('Sam', FIXTURE);
    expect(msg).toContain('Hi Sam');
    expect(msg).toContain('HKFC B vs Kowloon');
    expect(msg).toContain('KP');
    expect(msg).toContain('Blue kit');
    expect(msg).toContain('Please confirm');
  });

  it('omits the kit line when no colour has been chosen', () => {
    const msg = buildSelectionMessage('Sam', { ...FIXTURE, kit: '' });
    expect(msg).not.toContain('kit');
  });

  it('omits the venue when there is none', () => {
    const msg = buildSelectionMessage('Sam', { ...FIXTURE, venue: '' });
    expect(msg).not.toContain(', ,');
  });

  it('lays the squad out by position with shirt numbers, keeping the given order within a position', () => {
    const msg = buildSquadAnnouncement(FIXTURE, [
      { name: 'Zed', shirtNo: '9', position: 'Forward' },
      { name: 'Lee', position: 'Flexible/Varies' },
      { name: 'Alex', shirtNo: '4', position: 'Defender' },
      { name: 'Jo', shirtNo: '5', position: 'Defender' },
      { name: 'Kit', shirtNo: '8', position: 'Midfielder' },
      { name: 'Sam', shirtNo: '1', position: 'Goalkeeper' },
      { name: 'Pat', shirtNo: ' ' },
    ]);
    expect(msg).toContain(
      'Squad (7):\n\n' +
        '*GK*\n#1 Sam\n\n' +
        '*DEF*\n#4 Alex\n#5 Jo\n\n' +
        '*MID*\n#8 Kit\n\n' +
        '*FWD*\n#9 Zed\n\n' +
        '*FLEX*\nLee\n\n' +
        '*Other*\nPat',
    );
  });

  it('still produces an announcement with an empty squad', () => {
    const msg = buildSquadAnnouncement(FIXTURE, []);
    expect(msg).toContain('HKFC B vs Kowloon');
    expect(msg).not.toContain('Squad (');
  });

  it('ends the announcement with the fixture link when there is one', () => {
    const link = fixtureLink('https://eddy.example', 'rec123');
    const msg = buildSquadAnnouncement({ ...FIXTURE, link }, [{ name: 'Sam' }]);
    expect(msg.endsWith(`\n\nConfirm or say you can't make it: ${link}`)).toBe(true);
    expect(buildSquadAnnouncement(FIXTURE, [{ name: 'Sam' }])).not.toContain('http');
  });

  it('swaps "Please confirm" for the link in the player message', () => {
    const link = fixtureLink('https://eddy.example', 'rec123');
    const msg = buildSelectionMessage('Sam', { ...FIXTURE, link });
    expect(msg).toContain(link);
    expect(msg).not.toContain('Please confirm');
  });
});

describe('buildAvailabilityRequest', () => {
  it('asks for availability with the fixture and its link, and no squad', () => {
    const link = fixtureLink('https://eddy.example', 'rec123');
    const msg = buildAvailabilityRequest({ ...FIXTURE, link });
    expect(msg.startsWith('Availability for HKFC B vs Kowloon')).toBe(true);
    expect(msg.endsWith(`Please mark whether you can play in Eddy: ${link}`)).toBe(true);
    expect(msg).not.toContain('Squad');
  });

  it('still reads cleanly without a link', () => {
    expect(buildAvailabilityRequest(FIXTURE)).toContain('Please mark whether you can play in Eddy.');
  });
});

describe('buildNotSeenNudge', () => {
  it('keeps {first name} for the list sheet to fill, and ends with the link', () => {
    const link = fixtureLink('https://eddy.example', 'rec123');
    const msg = buildNotSeenNudge({ ...FIXTURE, link });
    expect(msg.startsWith('Hi {first name}, can you play in HKFC B vs Kowloon')).toBe(true);
    expect(msg.endsWith(`Please answer in Eddy: ${link}`)).toBe(true);
    expect(fillMessage(msg, { name: 'Sam Lee' }).startsWith('Hi Sam, ')).toBe(true);
  });
});

describe('fixtureLink', () => {
  it("opens the fixture on the player's page at the given address", () => {
    expect(fixtureLink('https://eddy.example', 'rec123')).toBe('https://eddy.example/?fixture=rec123');
  });
});

describe('whatsAppLink', () => {
  it('percent-encodes the message so newlines survive', () => {
    const link = whatsAppLink('85291234567', 'Hi Sam\nBlue kit');
    expect(link.startsWith('https://wa.me/85291234567?text=')).toBe(true);
    expect(link).toContain('%0A'); // newline
    expect(link).not.toContain(' ');
  });
});
