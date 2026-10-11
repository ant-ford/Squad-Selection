/** Meeting audiences use current appointments, never captaincy interest. */
import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { db, eq } from "../data/supabase";
import { getChairmanDirectory, getDirectoryPerson } from "../chairman";
import type { DirectoryPerson } from "../../../shared/emailLists";
import { EVENT_ROLES } from "../../../shared/events";

type Appointment = { role: string; people: { api_id: string } | null; teams?: { active: boolean } | null };

async function appointedRoles(env: Env, personId?: string): Promise<Map<string, string[]>> {
  const person = personId ? `&people.api_id=${eq(personId)}` : "";
  const [offices, links] = await Promise.all([
    // People also reference sponsoring offices; select the office holder FK.
    db(env).select<Appointment>("offices", `select=role,people!offices_person_id_fkey!inner(api_id)&status=eq.Active&role=in.(section_captain,assistant_director,hockey_convenor,membership_officer,kit_convenor)${person}`),
    db(env).select<Appointment>("team_people", `select=role,people!inner(api_id),teams!inner(active)&role=in.(team_captain,section_captain)${person}`, "team_id,role,person_id"),
  ]);
  const roles = new Map<string, string[]>();
  for (const row of [...offices, ...links]) {
    const label = EVENT_ROLES[row.role];
    if (!row.people || !label || (row.role === "team_captain" && !row.teams?.active)) continue;
    const values = roles.get(row.people.api_id) ?? [];
    if (!values.includes(label)) values.push(label);
    roles.set(row.people.api_id, values);
  }
  return roles;
}

const withRoles = (p: DirectoryPerson, roles: string[]): DirectoryPerson => ({ ...p, values: { ...p.values, eventRoles: roles } });

export async function eventDirectory(env: Env): Promise<DirectoryPerson[]> {
  const [dir, roles] = await Promise.all([getChairmanDirectory(env), appointedRoles(env)]);
  return dir.people.map((p) => withRoles(p, roles.get(p.id) ?? []));
}

/** The viewer already carries appointments from auth_context; other invitees are read individually. */
export async function eventDirectoryPerson(env: Env, personId: string, user?: AuthorizedUser): Promise<DirectoryPerson | null> {
  const p = await getDirectoryPerson(env, personId);
  if (!p) return null;
  if (user?.personId === personId) {
    const roles = user.offices.map((o) => EVENT_ROLES[o.role]).filter(Boolean);
    if (user.captainTeams.length) roles.push(EVENT_ROLES.team_captain);
    if (user.isSectionCaptain) roles.push(EVENT_ROLES.section_captain);
    return withRoles(p, [...new Set(roles)]);
  }
  return withRoles(p, (await appointedRoles(env, personId)).get(personId) ?? []);
}
