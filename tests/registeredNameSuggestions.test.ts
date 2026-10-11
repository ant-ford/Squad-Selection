import { describe, expect, it } from 'vitest';
import { rankRegisteredNames, type NameSuggestionCard, type NameSuggestionPerson } from '../shared/registeredNameSuggestions';

const sam: NameSuggestionPerson = {
  id: 'sam', preferred_name: 'Sam', given_names: 'Samuel', surname: 'Lee', registered_name: null, registered_team: 'HKFC C',
};
const card = (name: string, team = 'HKFC C', person_id: string | null = null): NameSuggestionCard => ({ raw_player_name: name, team, person_id });

describe('ranked HockeyHK registered-name suggestions', () => {
  it('ranks exact given/preferred names ahead of partial matches and unrelated names, irrespective of word order', () => {
    const names = rankRegisteredNames(sam, [card('LEE Samuel Kai'), card('LEE Samuel'), card('SAM LEE'), card('CHAN Peter')], []);
    expect(names.map((n) => n.name)).toEqual(['LEE Samuel', 'SAM LEE', 'LEE Samuel Kai']);
    expect(names.every((n) => n.source === 'matchCard')).toBe(true);
  });

  it('deduplicates case/spacing variants and shows how many cards and which teams support them', () => {
    const [name] = rankRegisteredNames(sam, [card(' LEE  Samuel '), card('lee Samuel', 'HKFC B'), card('LEE Samuel')], []);
    expect(name).toEqual({ name: 'LEE Samuel', source: 'matchCard', cards: 3, teams: ['HKFC B', 'HKFC C'] });
  });

  it('treats a card already linked to this person as stronger evidence than a fuzzy match', () => {
    const names = rankRegisteredNames(sam, [card('LEE Samuel'), card('LEE Man Tak', 'HKFC B', 'sam')], []);
    expect(names[0].name).toBe('LEE Man Tak');
  });

  it('never offers another person’s claimed registered name or linked card', () => {
    const names = rankRegisteredNames(sam, [card('LEE Samuel'), card('LEE Sam', 'HKFC C', 'someoneElse')], [{ id: 'inactivePerson', registered_name: ' lee samuel ' }]);
    expect(names).toEqual([]);
  });

  it('labels a generated surname/given-name format as unconfirmed when there are no matching cards', () => {
    expect(rankRegisteredNames(sam, [card('CHAN Peter')], [])).toEqual([{ name: 'LEE Samuel', source: 'format', cards: 0, teams: [] }]);
  });

  it('does not suggest names once set, or invalid/wildcard names that cannot be saved', () => {
    expect(rankRegisteredNames({ ...sam, registered_name: 'LEE Samuel' }, [card('LEE Sam')], [])).toEqual([]);
    const names = rankRegisteredNames(sam, [card('LEE Samuel%'), card('LEE Sam 123')], []);
    expect(names.every((n) => n.source === 'format')).toBe(true);
  });

  it('matches accents and uses team evidence to order equally similar names', () => {
    const p = { ...sam, given_names: 'José', preferred_name: 'Jose', surname: 'García' };
    expect(rankRegisteredNames(p, [card('GARCIA Jose', 'HKFC B'), card('GARCÍA José', 'HKFC C')], [])[0].name).toBe('GARCÍA José');
  });
});
