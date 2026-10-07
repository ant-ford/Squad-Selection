// The demo's fictional club: people, teams and dates. No real person's
// details belong anywhere under tools/demo (the repository is public).
import { PERSONAS, sectionsOf, type Persona } from '../personas.mjs';

export { PERSONAS, sectionsOf };
export type { Persona };

const DAY = 86_400_000;

/** An ISO time `days` from today at hh:mm Hong Kong time. */
export function at(days: number, hh: number, mm = 0): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY);
  d.setUTCHours(hh - 8, mm, 0, 0);
  return d.toISOString();
}

/** YYYY-MM-DD (Hong Kong) of an ISO time. */
export function dateOnly(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD `days` from today. */
export const day = (days: number) => dateOnly(at(days, 12));

/** Days from today to the coming Saturday (next week's when today is Saturday). */
export const toSat = ((6 - new Date().getUTCDay() + 7) % 7) || 7;
export const SAT1 = toSat;
export const SUN1 = toSat + 1;
export const WED = toSat + 4;
export const SAT2 = toSat + 7;
export const SAT3 = toSat + 14;
export const SAT4 = toSat + 21;

/** The season that today falls in, e.g. 2026-2027 (a season starts in August). */
export const SEASON = (() => {
  const now = new Date();
  const start = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${start}-${start + 1}`;
})();
export const SEASON_SHORT = SEASON.replace(/-(\d\d)(\d\d)$/, '-$2');

export const TEAMS = ['HKFC A', 'HKFC B', 'HKFC C', 'HKFC D', 'HKFC E', 'HKFC F', 'HKFC G', 'HKFC H'];

export interface Player {
  id: string;
  name: string;
  position: string;
  shirtNo: string;
  team: string;
  ability: string;
}

const SQUAD: [string, string, string, string, string][] = [
  ['Sam Carter', 'Midfielder', '14', 'HKFC C', 'C+'],
  ['Jamie Wong', 'Forward', '9', 'HKFC C', 'C+'],
  ['Priya Nair', 'Defender', '4', 'HKFC C', 'C'],
  ['Tom Fletcher', 'Goalkeeper', '1', 'HKFC C', 'C'],
  ['Marcus Leung', 'Defender', '5', 'HKFC C', 'C'],
  ['Oliver Grant', 'Midfielder', '8', 'HKFC C', 'C-'],
  ['Kenji Tanaka', 'Forward', '11', 'HKFC C', 'C-'],
  ['Ravi Patel', 'Midfielder', '10', 'HKFC C', 'C'],
  ['Ben Hughes', 'Defender', '3', 'HKFC C', 'D+'],
  ['Luca Rossi', 'Forward', '7', 'HKFC C', 'D+'],
  ['Ethan Chan', 'Flexible/Varies', '16', 'HKFC C', 'D'],
  ['Noah Singh', 'Midfielder', '12', 'HKFC C', 'D'],
  ['Harry Lam', 'Defender', '2', 'HKFC C', 'D-'],
  ['Felix Moreau', 'Midfielder', '6', 'HKFC C', 'D-'],
  ['Arjun Mehta', 'Forward', '15', 'HKFC D', 'D'],
  ['Dylan Cheung', 'Defender', '18', 'HKFC D', 'E+'],
  ['Max Keller', 'Goalkeeper', '21', 'HKFC D', 'E+'],
  ['Leo Barros', 'Midfielder', '17', 'HKFC D', 'E'],
  ['Isaac Ho', 'Forward', '19', 'HKFC D', 'E'],
  ['Charlie Dunn', 'Midfielder', '20', 'HKFC D', 'E-'],
  ['Omar Haddad', 'Defender', '22', 'HKFC D', 'E-'],
  ['Wesley Tsang', 'Forward', '23', 'HKFC D', 'E'],
];

/** The HKFC C and D squads. Sam Carter (the player persona) is first. */
export const SQUAD_PLAYERS: Player[] = SQUAD.map(([name, position, shirtNo, team, ability], i) => ({
  id: i === 0 ? PERSONAS.player.id : `demoP${i}`,
  name,
  position,
  shirtNo,
  team,
  ability,
}));

export const idOf = (name: string) => SQUAD_PLAYERS.find((p) => p.name === name)?.id ?? `demo${name.replace(/\W/g, '')}`;

/** The rest of the section, for the ranking and the officers' lists. */
export const OTHERS: [string, string, string][] = [
  ['Alex Morgan', 'HKFC A', 'Goalkeeper'],
  ['Chris Tam', 'HKFC A', 'Defender'],
  ['Daniel Price', 'HKFC A', 'Midfielder'],
  ['Rohan Kapoor', 'HKFC A', 'Forward'],
  ['Will Ashford', 'HKFC A', 'Midfielder'],
  ['Matteo Bianchi', 'HKFC A', 'Defender'],
  ['Henry Yip', 'HKFC B', 'Forward'],
  ['George Lee', 'HKFC B', 'Flexible/Varies'],
  ['Adam Walsh', 'HKFC B', 'Goalkeeper'],
  ['Jonah Fung', 'HKFC B', 'Defender'],
  ['Victor Kwok', 'HKFC B', 'Midfielder'],
  ['Samuel Obi', 'HKFC B', 'Defender'],
  ['Patrick Ng', 'HKFC E', 'Defender'],
  ['Aiden Choi', 'HKFC E', 'Forward'],
  ['Finn O’Brien', 'HKFC E', 'Midfielder'],
  ['Karan Shah', 'HKFC F', 'Midfielder'],
  ['Lewis Mak', 'HKFC F', 'Forward'],
  ['Pete Summers', 'HKFC G', 'Defender'],
];

/** The persona as a player: everyone in the demo plays for HKFC C unless they're in OTHERS. */
export function personaTeam(p: Persona): string {
  return OTHERS.find(([n]) => n === p.name)?.[1] ?? SQUAD_PLAYERS.find((s) => s.name === p.name)?.team ?? 'HKFC C';
}

export const firstName = (name: string) => name.split(' ')[0];
