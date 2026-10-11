import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, SupabaseError } from "../data/supabase";
import { invalidateCache, invalidateCachePrefix } from "../cache";
import { matches } from "../../../shared/emailLists";
import { isOpen } from "../../../shared/events";
import { cleanDateAnswers, cleanDateOptions, isDatePoll, type DateAnswers } from "../../../shared/eventDates";
import { eventDirectoryPerson } from "./audience";
import { audienceOf, loadEvent, requireManages, toDetails, nameOf, type NameParts } from "./shared";

export interface DateResponseRow { event_id: string; person_id: string; answers: DateAnswers; person?: (NameParts & { api_id: string }) | null }
export const DATE_RESPONSE_COLS = "event_id,person_id,answers,person:people(api_id,preferred_name,given_names,surname)";
export const DATE_RESPONSE_KEY = "event_id,person_id";
export const dateResponseOf = (r: DateResponseRow) => ({ personId: r.person?.api_id ?? "", name: nameOf(r.person), answers: r.answers });

async function dateWrite(env: Env, name: string, args: Record<string, unknown>) {
  try { await db(env).rpc(name, args); }
  catch (err) {
    if (err instanceof SupabaseError && ["P0001", "40001", "22023"].includes(err.code ?? "")) throw new HttpError(err.message, err.code === "22023" ? 400 : 409, "DATE_POLL_CHANGED");
    throw err;
  }
  invalidateCachePrefix("event-tasks:");
  invalidateCache("events:open");
}

export async function answerEventDates(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const [event, person] = await Promise.all([loadEvent(env, id), eventDirectoryPerson(env, user.personId, user)]);
  const details = toDetails(event, null);
  if (event.status === "draft") throw new HttpError("Event not found.", 404, "NOT_FOUND");
  if (!user.personUuid || !person || !matches(person, audienceOf(event))) throw new HttpError("This event isn't for you.", 403, "NOT_INVITED");
  if (!isDatePoll(details) || !isOpen(details)) throw new HttpError("The date poll has closed or a date has been chosen. Reload the event.", 409, "DATE_POLL_CLOSED");
  const answers = cleanDateAnswers(body.answers, details.dateOptions!);
  if (typeof answers === "string") throw new HttpError(answers, 400, "INVALID_INPUT");
  await dateWrite(env, "save_event_date_answers", { p_event_id: id, p_person_id: user.personUuid, p_answers: answers });
  return { ok: true };
}

export async function chooseEventDate(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  if (event.status !== "published" || !isDatePoll(toDetails(event, null))) throw new HttpError("This event is no longer waiting for a date.", 409, "DATE_POLL_CLOSED");
  const option = event.date_options?.find((o) => o.id === body.optionId);
  if (!option || Date.parse(option.startsAt) <= Date.now()) throw new HttpError("Choose a future proposed date.", 400, "INVALID_INPUT");
  if (JSON.stringify(cleanDateOptions(body.expectedOptions)) !== JSON.stringify(cleanDateOptions(event.date_options))) throw new HttpError("The proposed dates have changed. Reload first.", 409, "DATE_POLL_CHANGED");
  await dateWrite(env, "choose_event_date", { p_event_id: id, p_option_id: option.id, p_expected_options: event.date_options });
  return { ok: true };
}
