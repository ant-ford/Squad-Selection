import type { Env } from './env';
import type { AuthorizedUser } from './auth';
import type { MyTask } from './myTasks';
import { db } from './data/supabase';
import { fullName } from '../../shared/personName';

/** Fresh on each Convenor task read: saving a name or making a player
 * inactive removes their task on the next read, whichever isolate serves it.
 * Other users do not perform this read or receive these tasks.
 */
export async function missingRegisteredNameTasks(env: Env, user: AuthorizedUser): Promise<MyTask[]> {
  if (!user.officerRoles.some((r) => r.office === 'hockeyConvenor')) return [];
  const rows = await db(env).select<{
    api_id: string;
    preferred_name: string | null;
    given_names: string | null;
    surname: string | null;
    registered_name: string | null;
  }>('people', 'select=api_id,preferred_name,given_names,surname,registered_name&active=is.true');
  return rows.filter((p) => !p.registered_name?.trim()).map((p) => ({
    id: `registered-name:${p.api_id}`,
    key: 'registered-name',
    subject: fullName(p) || 'An active player',
    url: `/people/${encodeURIComponent(p.api_id)}`,
  }));
}
