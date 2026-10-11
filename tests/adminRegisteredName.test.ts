import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/src/env';
import type { AuthorizedUser } from '../worker/src/auth';
import { getRegisteredNameSuggestions, saveRegisteredName } from '../worker/src/admin/registeredName';

const invalidate = vi.hoisted(() => ({ people: vi.fn(), cards: vi.fn() }));
vi.mock('../worker/src/invalidation', () => ({ invalidatePeople: invalidate.people, invalidateMatchCards: invalidate.cards }));
const env = { DATA_SUPABASE_URL: 'https://test.supabase.co', DATA_SUPABASE_SECRET_KEY: 'sb_secret_test' } as Env;
const actor = { personId: 'recCONVENOR', officerRoles: [{ office: 'hockeyConvenor', designation: '' }] } as AuthorizedUser;
const sam = { id: 'uuid-sam', registered_name: null as string | null, preferred_name: 'Sam', given_names: 'Samuel', surname: 'Lee', registered_team: 'HKFC C' };
type Call = { table: string; method: string; url: URL; body?: Record<string, unknown> };
function fake({ person = sam as typeof sam | null, holders = [] as unknown[], cards = [] as unknown[], result = { status: 'ok', changed: ['registered_name'] } as object } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const table = url.pathname.split('/').pop()!;
    const method = init.method ?? 'GET';
    calls.push({ table, method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const data = table === 'people' ? (url.searchParams.has('api_id') ? person ? [person] : [] : holders) :
      table === 'match_cards' ? cards : table === 'admin_update_person' ? result : table === 'link_match_cards_by_name' ? 3 : [];
    return new Response(JSON.stringify(data), { status: 200 });
  }));
  return calls;
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('People registered-name saves', () => {
  it('validates, audits with the session actor, atomically checks the loaded value and links existing cards', async () => {
    const calls = fake();
    expect(await saveRegisteredName(env, actor, 'recSAM', {
      registeredName: ' LEE  Samuel ', expect: { registeredName: null }, id: 'recOTHER', personId: 'recIMPOSTOR', visiting: true,
    })).toEqual({ ok: true, linked: 3 });
    expect(calls.find((c) => c.table === 'admin_update_person')!.body).toEqual({
      p_person: 'recSAM', p_actor: 'recCONVENOR', p_action: 'admin-registered-name', p_patch: { registered_name: 'LEE Samuel' }, p_expect: { registered_name: null },
    });
    expect(calls.find((c) => c.table === 'link_match_cards_by_name')!.body).toEqual({ p_name: 'LEE Samuel' });
    expect(invalidate.people).toHaveBeenCalledOnce();
    expect(invalidate.cards).toHaveBeenCalledOnce();
    expect(calls.find((c) => c.url.searchParams.has('api_id'))!.url.searchParams.has('active')).toBe(false);
  });

  it('rejects a name held by an inactive person before writing and linking', async () => {
    const calls = fake({ holders: [{ preferred_name: 'Other', surname: 'Lee', active: false }] });
    await expect(saveRegisteredName(env, actor, 'recSAM', { registeredName: 'LEE Samuel', expect: { registeredName: null } })).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('refuses a change made after loading, including a race caught by the SQL row lock', async () => {
    const calls = fake({ result: { status: 'conflict', field: 'registered_name' } });
    await expect(saveRegisteredName(env, actor, 'recSAM', { registeredName: 'LEE Samuel', expect: { registeredName: null } })).rejects.toMatchObject({ status: 409, code: 'CHANGED' });
    expect(calls.some((c) => c.table === 'link_match_cards_by_name')).toBe(false);
    expect(invalidate.people).not.toHaveBeenCalled();
  });

  it('clears a stored name without relinking or detaching already linked cards', async () => {
    const calls = fake({ person: { ...sam, registered_name: 'LEE Samuel' } as typeof sam });
    expect(await saveRegisteredName(env, actor, 'recSAM', { registeredName: '', expect: { registeredName: 'LEE Samuel' } })).toEqual({ ok: true, linked: 0 });
    expect(calls.find((c) => c.table === 'admin_update_person')!.body!.p_patch).toEqual({ registered_name: null });
    expect(calls.some((c) => c.table === 'link_match_cards_by_name')).toBe(false);
  });

  it('does not relink or invalidate an unchanged save', async () => {
    fake({ person: { ...sam, registered_name: 'LEE Samuel' } as typeof sam, result: { status: 'ok', changed: [] } });
    expect(await saveRegisteredName(env, actor, 'recSAM', { registeredName: 'LEE Samuel', expect: { registeredName: 'LEE Samuel' } })).toEqual({ ok: true, linked: 0 });
    expect(invalidate.people).not.toHaveBeenCalled();
  });

  it.each([{ registeredName: 'LEE% Sam', expect: { registeredName: null } }, { registeredName: 'LEE Sam' }, { registeredName: 17, expect: { registeredName: null } }])('rejects invalid input before data reads', async (body) => {
    const calls = fake();
    await expect(saveRegisteredName(env, actor, 'recSAM', body)).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it('is a 404 for a missing person', async () => {
    fake({ person: null });
    await expect(saveRegisteredName(env, actor, 'recSAM', { registeredName: 'LEE Samuel', expect: { registeredName: null } })).rejects.toMatchObject({ status: 404 });
  });

  it('checks Convenor rights before either read or save', async () => {
    const calls = fake();
    const nonConvenor = { ...actor, officerRoles: [{ office: 'sectionCaptain', designation: '' }] } as AuthorizedUser;
    await expect(saveRegisteredName(env, nonConvenor, 'recSAM', {})).rejects.toMatchObject({ status: 403 });
    await expect(getRegisteredNameSuggestions(env, nonConvenor, 'recSAM')).rejects.toMatchObject({ status: 403 });
    expect(calls).toEqual([]);
  });
});

describe('People registered-name suggestion reads', () => {
  it('reads only minimal current-season card/name fields and excludes claimed names', async () => {
    const calls = fake({ cards: [{ raw_player_name: 'LEE Samuel', team: 'HKFC C', person_id: null }], holders: [{ id: 'other', registered_name: 'LEE Samuel' }] });
    expect(await getRegisteredNameSuggestions(env, actor, 'recSAM')).toEqual({ suggestions: [] });
    const query = calls.find((c) => c.table === 'match_cards')!.url.searchParams;
    expect(query.get('or')).toBe('(person_id.is.null,person_id.eq.uuid-sam)');
    expect(query.get('match.match_date')).toMatch(/^gte\.\d{4}-07-01/);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.map((c) => c.url.searchParams.get('select')).join(' ')).not.toMatch(/email|mobile|hkid|passport|cards|goals/);
  });

  it('does not fetch suggestions if the name has already been populated', async () => {
    const calls = fake({ person: { ...sam, registered_name: 'LEE Samuel' } as typeof sam });
    expect(await getRegisteredNameSuggestions(env, actor, 'recSAM')).toEqual({ suggestions: [] });
    expect(calls).toHaveLength(1);
  });
});
