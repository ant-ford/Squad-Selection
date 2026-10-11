import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingRegisteredNameTasks } from '../worker/src/registeredNameTasks';
import type { AuthorizedUser } from '../worker/src/auth';
import type { Env } from '../worker/src/env';
import { fakePostgrest, SUPABASE_TEST_ENV } from './helpers/postgrest';

const env = SUPABASE_TEST_ENV as Env;
const actor = (office: string) => ({ officerRoles: [{ office, designation: '' }] }) as AuthorizedUser;
const conv = actor('hockeyConvenor');
const player = (id: string, registered_name: string | null, active = true) => ({
  id, api_id: `rec${id}`, preferred_name: id, given_names: id, surname: 'Test', active, registered_name,
});
afterEach(() => vi.unstubAllGlobals());

describe('missing registered-name tasks for the Men’s Convenor', () => {
  it('includes every active player with a null, empty or whitespace-only name, with a People link', async () => {
    const pg = fakePostgrest({ tables: { people: [player('Sam', null), player('Jo', ''), player('Lee', '  '), player('Named', 'NAMED Player'), player('Inactive', null, false)] } });
    expect(await missingRegisteredNameTasks(env, conv)).toEqual([
      { id: 'registered-name:recJo', key: 'registered-name', subject: 'Jo Test', url: '/people/recJo' },
      { id: 'registered-name:recLee', key: 'registered-name', subject: 'Lee Test', url: '/people/recLee' },
      { id: 'registered-name:recSam', key: 'registered-name', subject: 'Sam Test', url: '/people/recSam' },
    ]);
    expect(pg.reads('people')[0].params.get('active')).toBe('is.true');
    expect(pg.reads('people')[0].params.get('select')).not.toMatch(/email|mobile|hkid|passport/);
    expect(pg.writes()).toEqual([]);
  });

  it('removes corrected/inactive players on the next read without waiting for a cache timeout', async () => {
    const pg = fakePostgrest({ tables: { people: [player('Sam', null), player('Jo', null)] } });
    expect(await missingRegisteredNameTasks(env, conv)).toHaveLength(2);
    pg.tables.people[0].registered_name = 'TEST Sam';
    pg.tables.people[1].active = false;
    expect(await missingRegisteredNameTasks(env, conv)).toEqual([]);
  });

  it.each(['sectionCaptain', 'membershipOfficer', 'kitConvenor', 'assistantDirector'])('does not read or offer these tasks to %s', async (office) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await missingRegisteredNameTasks(env, actor(office))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
