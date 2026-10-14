import { describe, expect, it } from 'vitest';
import { playerKitCsv } from '../src/lib/kitCsv';
import type { KitPerson, KitSizes } from '../shared/kit';

const sizes = (more: Partial<KitSizes> = {}): KitSizes => ({
  shirt: null, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null, ...more,
});
const person = (name: string, more: Partial<KitPerson> = {}): KitPerson => ({
  id: name, name, search: name.toLowerCase(), status: 'Member', team: 'HKFC A',
  active: true, shirtNo: null, sizes: sizes(), hasSet: false, ...more,
});

describe('players kit CSV', () => {
  it('includes active players with and without kit, by number, then unnumbered players by name', () => {
    const people = [
      person('Zoe'),
      person('Keeper', { shirtNo: 42, sizes: sizes({ goalieSmock: '2XL', goalieSmockStyle: 'Long Sleeve' }) }),
      person('Former player', { active: false, shirtNo: 1 }),
      person('Bo', { status: 'Applicant', shirtNo: 12, team: 'HKFC B' }),
      person('Al', { shirtNo: 2, hasSet: true, sizes: sizes({ shirt: 'L', shorts: 'M', socks: 'Large' }) }),
      person('Amy'),
    ];
    const { csv, count } = playerKitCsv(people);
    expect(count).toBe(5);
    expect(csv).toBe([
      'Name,Status,Team,Shirt No.,Shirt Size,Shorts Size,Socks Size,Goalie Smock Size,Goalie Smock Style',
      'Al,Member,HKFC A,2,L,M,Large,,',
      'Bo,Applicant,HKFC B,12,,,,,',
      'Keeper,Member,HKFC A,42,,,,2XL,Long Sleeve',
      'Amy,Member,HKFC A,,,,,,',
      'Zoe,Member,HKFC A,,,,,,',
      '',
    ].join('\r\n'));
    expect(people.map((p) => p.name)).toEqual(['Zoe', 'Keeper', 'Former player', 'Bo', 'Al', 'Amy']);
  });

  it('escapes names and protects spreadsheet cells from formulas while preserving Unicode', () => {
    const { csv } = playerKitCsv([
      person('Lee, "阿明"\r\nJunior', { shirtNo: 9 }),
      person('=HYPERLINK("bad")', { shirtNo: 10, team: '@HKFC A', sizes: sizes({ shirt: '+L' }) }),
    ]);
    expect(csv).toContain('"Lee, ""阿明""\r\nJunior",Member,HKFC A,9');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")",Member,\'@HKFC A,10,\'+L');
  });

  it('produces a header and no player rows when nobody is active', () => {
    const { csv, count } = playerKitCsv([person('Inactive', { active: false })]);
    expect(count).toBe(0);
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });
});
