/**
 * The activity log (public.activity_log): who did what to whom, with the
 * NAMES of the fields that changed, never their values.
 *
 * Writes that change data log from inside their SQL function, in the same
 * transaction (admin_update_person and friends). This is for the rest: an
 * action with nothing else to write in the database, such as an export.
 * Best effort: a failed log write is reported in Workers Logs and does not
 * fail the action it records.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { db, eq } from "./data/supabase";

export interface ActivityEntry {
  /** The actor's People uuid (actorUuid below), or null. */
  actorId: string | null;
  action: string;
  /** What entityIds are: People uuids unless said otherwise. */
  entity?: string;
  /** One row each; [null] for an action on no particular record. */
  entityIds: (string | null)[];
  fields: string[];
}

/** The signed-in person's People uuid: from sign-in (auth_context) when it has it, else looked up by api id. */
export async function actorUuid(env: Env, actor: Pick<AuthorizedUser, "personId"> & { personUuid?: string }): Promise<string | null> {
  if (actor.personUuid) return actor.personUuid;
  return (await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(actor.personId)}`))?.id ?? null;
}

/** One activity_log row per entity, in a single write. */
export async function logActivity(env: Env, entry: ActivityEntry): Promise<void> {
  if (entry.entityIds.length === 0) return;
  const entity = entry.entity ?? "people";
  await db(env)
    .insert(
      "activity_log",
      entry.entityIds.map((entityId) => ({
        actor_person_id: entry.actorId,
        action: entry.action,
        entity,
        entity_id: entityId,
        fields: entry.fields,
      })),
    )
    .catch((err) => console.error("activity_log write failed:", err instanceof Error ? err.message : err));
}
