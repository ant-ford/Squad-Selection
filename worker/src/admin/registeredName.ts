import type { Env } from '../env';
import { sectionsFor, type AuthorizedUser } from '../auth';
import { HttpError } from '../http';
import { db, eq } from '../data/supabase';
import { invalidateMatchCards, invalidatePeople } from '../invalidation';
import { parseDetailsChange, requireUniqueRegisteredName } from '../registration';
import { currentSeason } from '../seasonContext';
import { seasonBounds } from '../dataChecks';
import { rankRegisteredNames, type NameSuggestionCard, type NameSuggestionPerson, type RegisteredNameSuggestion } from '../../../shared/registeredNameSuggestions';
import { registeredNameKey } from '../../../shared/dataChecks';
import { adminRpc } from './rpc';
import { API_ID } from './people';

function requireRegistration(actor: AuthorizedUser): void {
  if (!sectionsFor(actor).includes('registration')) {
    throw new HttpError("Only the Men's Convenor can change the HockeyHK registered name.", 403, 'FORBIDDEN');
  }
}

async function readNamePerson(env: Env, id: string): Promise<NameSuggestionPerson> {
  if (!API_ID.test(id)) throw new HttpError('Person not found.', 404, 'NOT_FOUND');
  const p = await db(env).one<NameSuggestionPerson>('people',
    `select=id,registered_name,preferred_name,given_names,surname,registered_team&api_id=${eq(id)}`);
  if (!p) throw new HttpError('Person not found.', 404, 'NOT_FOUND');
  return p;
}

/** Read only when the People field is blank; names from this season's HKFC cards. */
export async function getRegisteredNameSuggestions(env: Env, actor: AuthorizedUser, id: string): Promise<{ suggestions: RegisteredNameSuggestion[] }> {
  requireRegistration(actor);
  const p = await readNamePerson(env, id);
  if (p.registered_name?.trim()) return { suggestions: [] };
  const d = db(env);
  const { from, to } = seasonBounds(currentSeason());
  const [cards, holders] = await Promise.all([
    d.select<NameSuggestionCard>('match_cards',
      'select=id,raw_player_name,person_id,team,match:matches!inner(match_date)' +
      `&or=(person_id.is.null,person_id.${eq(p.id)})` +
      `&match.match_date=gte.${encodeURIComponent(from)}&match.match_date=lt.${encodeURIComponent(to)}`),
    d.select<{ id: string; registered_name: string | null }>('people', 'select=id,registered_name&registered_name=not.is.null'),
  ]);
  return { suggestions: rankRegisteredNames(p, cards, holders) };
}

/** Existing column and audited admin RPC; its row lock protects the loaded value.
 * Like Registration, saving a name links this season's unlinked matching cards.
 * Inactive players can also be corrected here before they return to playing.
 */
export async function saveRegisteredName(env: Env, actor: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true; linked: number }> {
  requireRegistration(actor);
  const change = parseDetailsChange({ id, registeredName: body.registeredName });
  const expected = body.expect;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
      !('registeredName' in expected) ||
      (expected.registeredName !== null && typeof expected.registeredName !== 'string')) {
    throw new HttpError('Reload the page and try again.', 400, 'INVALID_INPUT');
  }
  const p = await readNamePerson(env, id);
  if ((p.registered_name || null) !== (expected.registeredName || null)) {
    throw new HttpError('Someone else changed this while you had it open. Reload and try again.', 409, 'CHANGED');
  }
  const name = change.registeredName ?? null;
  if (name && registeredNameKey(name) !== registeredNameKey(p.registered_name)) {
    await requireUniqueRegisteredName(env, p.id, name);
  }
  const result = await adminRpc<{ changed: string[] }>(env, 'admin_update_person', {
    p_person: id, p_actor: actor.personId, p_action: 'admin-registered-name',
    p_patch: { registered_name: name }, p_expect: { registered_name: expected.registeredName },
  });
  if (!result.changed.includes('registered_name')) return { ok: true, linked: 0 };
  // Invalidate the changed name even if a later link request fails.
  await invalidatePeople(env);
  const linked = name ? await db(env).rpc<number>('link_match_cards_by_name', { p_name: name }) : 0;
  if (linked > 0) await invalidateMatchCards(env);
  return { ok: true, linked };
}
