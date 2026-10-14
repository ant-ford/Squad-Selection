import { toCsv } from '@shared/csv';
import type { KitPerson } from '@shared/kit';

/** Players' recorded sizes for the selected supplier, regardless of kit orders or screen filters. */
export function playerKitCsv(people: KitPerson[]): { csv: string; count: number } {
  const players = people.filter((p) => p.active).sort((a, b) =>
    (a.shirtNo ?? Infinity) - (b.shirtNo ?? Infinity) || a.name.localeCompare(b.name),
  );
  const rows = players.map((p) => [
    p.name, p.status, p.team, p.shirtNo === null ? '' : String(p.shirtNo),
    p.sizes.shirt ?? '', p.sizes.shorts ?? '', p.sizes.socks ?? '',
    p.sizes.goalieSmock ?? '', p.sizes.goalieSmockStyle ?? '',
  ]);
  return {
    csv: toCsv([
      ['Name', 'Status', 'Team', 'Shirt No.', 'Shirt Size', 'Shorts Size', 'Socks Size', 'Goalie Smock Size', 'Goalie Smock Style'],
      ...rows,
    ]),
    count: players.length,
  };
}
