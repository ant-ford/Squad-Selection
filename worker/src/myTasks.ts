/**
 * Things a signed-in member still has to do, shown as a banner at the top
 * of their player page until the base shows them done (owner request,
 * 2026-09-26). Nothing here can be dismissed: the banner goes when the
 * record changes.
 *
 *  - statement: their commitment review is at Notified Member, i.e. the
 *    review email has gone out and they have not submitted their form.
 *  - waivers: no Waivers & Declarations submission this season (since
 *    1 July), so everyone is asked again each July.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { airtableFindAll } from "./airtable";
import { getCached, getShared } from "./cache";
import { TABLES } from "../../shared/schema/tableNames";
import { COMMITMENT_FIELDS } from "../../shared/schema/fieldMaps";
import { hkDateKey } from "../../shared/hkDateKey";
import { seasonStartYear } from "../../shared/membershipInsights";
import { NOTIFIED } from "../../shared/statementStages";
import { NOTIFIED_REVIEWS_KEY } from "./reference";

export type MyTaskKey = "statement" | "waivers";

export interface MyTask {
  key: MyTaskKey;
  /** The member's own form, when the base has a link for them. */
  url?: string;
}

/** People fields read for the signed-in member only, by record id. */
export const MY_TASK_FIELDS = {
  waiversSubmittedAt: "Last Submission: Waivers & Declarations",
  waiversFormUrl: "Fillout - Member Waivers & Declarations",
  /** Blank unless they are a Member whose commitment has not ended. */
  commitmentFormUrl: "Fillout - Member (Commitment Record Picker)",
} as const;

/**
 * A minute per member in this isolate, and dropped at once when People
 * changes (airtableWebhook.ts), so a banner goes soon after the form is in.
 */
const MY_RECORD_TTL_MS = 60 * 1000;
const NOTIFIED_TTL_MS = 5 * 60 * 1000;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** People ids with a review at Notified Member. One shared read for everyone. */
async function getNotifiedPeople(env: Env): Promise<string[]> {
  return getShared<string[]>(
    env,
    NOTIFIED_REVIEWS_KEY,
    async () => {
      const rows = await airtableFindAll(
        env,
        TABLES.commitment,
        `{${COMMITMENT_FIELDS.reviewProgress}}="${NOTIFIED}"`,
        undefined,
        [COMMITMENT_FIELDS.reviewProgress, COMMITMENT_FIELDS.people],
      );
      const ids = new Set<string>();
      for (const r of rows) {
        if (text(r.fields?.[COMMITMENT_FIELDS.reviewProgress]) !== NOTIFIED) continue;
        const people = r.fields?.[COMMITMENT_FIELDS.people];
        for (const id of Array.isArray(people) ? people : []) if (typeof id === "string") ids.add(id);
      }
      return [...ids];
    },
    NOTIFIED_TTL_MS,
  );
}

/** Waivers count for the season they were submitted in (July to June). */
export function waiversDoneThisSeason(submittedAt: unknown, today: string): boolean {
  const at = text(submittedAt);
  if (!at) return false;
  return hkDateKey(at) >= `${seasonStartYear(today)}-07-01`;
}

export async function getMyTasks(env: Env, user: AuthorizedUser): Promise<{ tasks: MyTask[] }> {
  const personId = user.personId;
  if (!personId || !/^rec[A-Za-z0-9]{14}$/.test(personId)) return { tasks: [] };

  const [record, notified] = await Promise.all([
    getCached(
      `my-tasks:${personId}`,
      async () => {
        const found = await airtableFindAll(
          env,
          TABLES.player,
          `RECORD_ID()="${personId}"`,
          undefined,
          Object.values(MY_TASK_FIELDS),
        );
        return found.find((r) => r.id === personId)?.fields ?? {};
      },
      MY_RECORD_TTL_MS,
    ).then((hit) => hit.data as Record<string, unknown>),
    getNotifiedPeople(env),
  ]);

  const today = hkDateKey(new Date().toISOString());
  const tasks: MyTask[] = [];
  if (notified.includes(personId)) {
    tasks.push({ key: "statement", url: text(record[MY_TASK_FIELDS.commitmentFormUrl]) });
  }
  if (!waiversDoneThisSeason(record[MY_TASK_FIELDS.waiversSubmittedAt], today)) {
    tasks.push({ key: "waivers", url: text(record[MY_TASK_FIELDS.waiversFormUrl]) });
  }
  return { tasks };
}
