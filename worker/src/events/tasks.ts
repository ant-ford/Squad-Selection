import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { db, eq, inList } from "../data/supabase";
import { getVersioned } from "../cache";
import { isDatePoll } from "../../../shared/eventDates";
import { eventRights } from "../eventAccess";
import { eventDirectoryPerson } from "./audience";
import { matches } from "../../../shared/emailLists";
import { isOpen } from "../../../shared/events";
import {
  type EventRow,
  EVENT_COLS,
  RESPONSE_KEY,
  toDetails,
  audienceOf,
} from "./shared";

// ── My Tasks ─────────────────────────────────────────────────────────────

export interface EventTask {
  id: string;
  title: string;
  /** When answers close. */
  due: string;
}

const OPEN_EVENTS_TTL_MS = 60 * 1000;
const TASKS_TTL_MS = 60 * 1000;

/** Open events they're invited to and haven't answered (myTasks.ts). */
export async function eventTasks(env: Env, user: AuthorizedUser): Promise<EventTask[]> {
  return getVersioned(
    env,
    `event-tasks:${user.personId}`,
    ["events", "event_responses", "event_date_responses", "people", "teams", "team_people", "offices"],
    async (): Promise<EventTask[]> => {
      const rights = await eventRights(env, user);
      if (!rights.personUuid) return [];
      // The open events and their own directory entry, side by side.
      const [open, person] = await Promise.all([
        getVersioned(
          env,
          "events:open",
          ["events"],
          () =>
            db(env).select<EventRow>(
              "events",
              `select=${EVENT_COLS}&status=eq.published&starts_at=gte.${encodeURIComponent(new Date().toISOString())}&order=starts_at`,
            ),
          OPEN_EVENTS_TTL_MS,
        ),
        eventDirectoryPerson(env, user.personId, user),
      ]);
      const now = Date.now();
      const live = open.filter((r) => isOpen(toDetails(r, null), now));
      if (!live.length || !person) return [];
      const mine = live.filter((r) => matches(person, audienceOf(r)));
      if (!mine.length) return [];
      const polls = mine.filter((r) => isDatePoll(toDetails(r, null)));
      const [answered, dateAnswered] = await Promise.all([db(env).select<{ event_id: string }>(
        "event_responses",
        `select=event_id&person_id=${eq(rights.personUuid)}&event_id=${inList(mine.map((r) => r.id))}`,
        RESPONSE_KEY,
      ), polls.length ? db(env).select<{ event_id: string }>("event_date_responses", `select=event_id&person_id=${eq(rights.personUuid)}&event_id=${inList(polls.map((r) => r.id))}`, RESPONSE_KEY) : Promise.resolve([])]);
      return mine
        .filter((r) => !(isDatePoll(toDetails(r, null)) ? dateAnswered : answered).some((a) => a.event_id === r.id))
        .map((r) => ({ id: r.id, title: r.title, due: r.respond_by ?? r.starts_at }));
    },
    TASKS_TTL_MS,
  );
}
