import { nameMatchScore, registeredNameKey, SUGGESTION_THRESHOLD } from './dataChecks';
import { registeredNameProblem, suggestRegisteredName, tidyRegisteredName } from './registration';

export interface RegisteredNameSuggestion {
  name: string;
  source: 'matchCard' | 'format';
  cards: number;
  teams: string[];
}

export interface NameSuggestionPerson {
  id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  registered_name: string | null;
  registered_team: string | null;
}

export interface NameSuggestionCard {
  raw_player_name: string | null;
  person_id: string | null;
  team: string | null;
}

/** Imported names first, using the same word-order/accent tolerant score as Data checks.
 * A manually linked card is stronger evidence than a fuzzy name. Names held by
 * anyone else are excluded. Choosing a suggestion never writes anything.
 */
export function rankRegisteredNames(
  person: NameSuggestionPerson,
  cards: readonly NameSuggestionCard[],
  holders: readonly { id: string; registered_name: string | null }[],
): RegisteredNameSuggestion[] {
  if (person.registered_name?.trim()) return [];
  const taken = new Set(holders.filter((p) => p.id !== person.id).map((p) => registeredNameKey(p.registered_name)));
  const variants = [`${person.given_names ?? ''} ${person.surname ?? ''}`, `${person.preferred_name ?? ''} ${person.surname ?? ''}`];
  const grouped = new Map<string, RegisteredNameSuggestion & { linked: boolean; score: number }>();
  for (const card of cards) {
    if (card.person_id !== null && card.person_id !== person.id) continue;
    const name = tidyRegisteredName(card.raw_player_name ?? '');
    const key = registeredNameKey(name);
    if (!name || taken.has(key) || registeredNameProblem(name)) continue;
    const linked = card.person_id === person.id;
    const score = Math.max(...variants.map((v) => nameMatchScore(name, v)));
    if (!linked && score < SUGGESTION_THRESHOLD) continue;
    const previous = grouped.get(key);
    if (previous) {
      previous.cards++;
      previous.linked ||= linked;
      if (card.team && !previous.teams.includes(card.team)) previous.teams.push(card.team);
    } else {
      grouped.set(key, { name, source: 'matchCard', cards: 1, teams: card.team ? [card.team] : [], linked, score });
    }
  }
  const ranked = [...grouped.values()].sort((a, b) =>
    Number(b.linked) - Number(a.linked) || b.score - a.score ||
    Number(b.teams.includes(person.registered_team ?? '')) - Number(a.teams.includes(person.registered_team ?? '')) ||
    b.cards - a.cards || a.name.localeCompare(b.name),
  ).slice(0, 5).map(({ name, source, cards, teams }) => ({ name, source, cards, teams: teams.sort() }));
  const format = suggestRegisteredName(person.surname, person.given_names);
  if (format && !registeredNameProblem(format) && !taken.has(registeredNameKey(format)) && !grouped.has(registeredNameKey(format))) {
    ranked.push({ name: format, source: 'format', cards: 0, teams: [] });
  }
  return ranked;
}
