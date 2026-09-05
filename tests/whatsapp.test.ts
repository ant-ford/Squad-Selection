import { describe, it, expect } from 'vitest';
import {
  buildSelectionMessage,
  buildSquadAnnouncement,
  toWhatsAppNumber,
  whatsAppLink,
  type FixtureBrief,
} from '../src/lib/whatsapp';

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

  it('numbers the squad in the announcement', () => {
    const msg = buildSquadAnnouncement(FIXTURE, ['Sam', 'Alex', 'Jo']);
    expect(msg).toContain('1. Sam');
    expect(msg).toContain('2. Alex');
    expect(msg).toContain('3. Jo');
  });

  it('still produces an announcement with an empty squad', () => {
    const msg = buildSquadAnnouncement(FIXTURE, []);
    expect(msg).toContain('HKFC B vs Kowloon');
    expect(msg).not.toContain('Squad:');
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
