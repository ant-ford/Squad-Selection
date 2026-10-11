/** Date polls are availability, separate from an event's final attendance RSVP. */
export interface EventDateOption { id: string; startsAt: string; endsAt: string | null }
export type DateAnswer = "available" | "maybe" | "unavailable";
export type DateAnswers = Record<string, DateAnswer>;
export const DATE_ANSWER_LABEL: Record<DateAnswer, string> = { available: "Available", maybe: "Maybe", unavailable: "No" };
export const MAX_EVENT_DATES = 6;
export const isDatePoll = (e: { dateOptions?: EventDateOption[]; chosenDateId?: string | null }) => !!e.dateOptions?.length && !e.chosenDateId;

export function cleanDateOptions(raw: unknown): EventDateOption[] | string {
  if (!Array.isArray(raw)) return "Choose two to six proposed dates.";
  if (!raw.length) return [];
  if (raw.length < 2 || raw.length > MAX_EVENT_DATES) return "Choose two to six proposed dates.";
  const out: EventDateOption[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(value.id)) return "A proposed date wasn't understood. Reload and try again.";
    const start = typeof value.startsAt === "string" ? Date.parse(value.startsAt) : NaN;
    const end = value.endsAt == null || value.endsAt === "" ? null : typeof value.endsAt === "string" ? Date.parse(value.endsAt) : NaN;
    if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) return "Give each proposed date a start and an end after it starts.";
    if (out.some((o) => o.id === value.id || Date.parse(o.startsAt) === start)) return "Proposed dates must be different.";
    out.push({ id: value.id, startsAt: new Date(start).toISOString(), endsAt: end === null ? null : new Date(end).toISOString() });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function cleanDateAnswers(raw: unknown, options: EventDateOption[]): DateAnswers | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Answer each proposed date.";
  const answers = raw as Record<string, unknown>;
  if (Object.keys(answers).some((id) => !options.some((o) => o.id === id))) return "The proposed dates have changed. Reload before answering.";
  const out: DateAnswers = {};
  for (const o of options) {
    const a = answers[o.id];
    if (a !== "available" && a !== "maybe" && a !== "unavailable") return "Answer each proposed date.";
    out[o.id] = a;
  }
  return out;
}
