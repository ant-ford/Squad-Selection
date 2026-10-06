/**
 * Things a signed-in person still has to do, shown as a banner at the top
 * of their player page until the base shows them done (owner requests,
 * 2026-09-26). Nothing here can be dismissed: a line goes when the record
 * changes.
 *
 * Their own forms:
 *  - statement: their commitment review is at Notified Member, i.e. the
 *    review email has gone out and they have not submitted their form.
 *  - waivers: no Waivers & Declarations submission this season (since
 *    1 July), so everyone is asked again each July.
 *  - details: an Active member who has not checked their details this season.
 *
 * And anything the New Joiner and Statements processes are waiting on them
 * for, one line per person, each opening an Eddy screen (stage 1 has no
 * line: the owner removed the Section Captains' invite prompt):
 *  - joiner: stage 2, the applicant's own application (/apply).
 *  - application: the sponsor, the chairman and the membership officer sign
 *    in Eddy (applicationSigning.ts), in that order; once all three have,
 *    the membership officer has an accept line.
 *  - review: a statement at Member Submitted waits on its sponsor, at
 *    Sponsor Submitted on its membership officer (/review/<id>).
 *  - system: the app owner only, while a system health check fails
 *    (systemHealth.ts); opens /system.
 *  - kit / registration: a Section Captain's request to the Kit Convenor or
 *    the Hockey Convenor for a new joiner, until they mark it done
 *    (joiners.ts).
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { getCached, getShared } from "./cache";
import { firstLink, getOfficeHolders } from "./contacts";
import { WAITING_ON_KEY } from "./reference";
import { people, type MyTaskRow } from "./data/people";
import { commitments } from "./data/commitments";
import { isRowId } from "./data/ids";
import { db, eq } from "./data/supabase";
import { openJoinerTasks } from "./joiners";
import { systemNeedsLook } from "./systemHealth";
import { signingTasks } from "./applicationSigning";
import { eventTasks, registerTasks } from "./events";
import { checkedThisSeason } from "../../shared/profile";
import { hkDateKey } from "../../shared/hkDateKey";
import { seasonStartYear } from "../../shared/membershipInsights";
import { MEMBER_SUBMITTED, NOTIFIED, REVIEWS_FROM, SPONSOR_SUBMITTED } from "../../shared/statementStages";

export type MyTaskKey = "system" | "joiner" | "details" | "statement" | "waivers" | "application" | "send" | "accept" | "review" | "kit" | "registration" | "event" | "register";
export type TaskRole = "Sponsor" | "Chairman" | "Membership Officer";

export interface MyTask {
  /** Unique within the list: the key plus the record it is about. */
  id: string;
  key: MyTaskKey;
  /** The applicant or member the line is about; absent for the person's own forms. */
  subject?: string;
  /** The part the signed-in person plays for that applicant or member. */
  role?: TaskRole;
  /** The Eddy screen to open. */
  url?: string;
  /** An event: when answers close. */
  due?: string;
}

/*
 * The fields read live with the repositories: the signed-in person's own
 * forms and the invited applicants in data/people.ts (MyTaskRow,
 * ApplicantTaskRow), the reviews in progress in data/commitments.ts
 * (ReviewTaskRow).
 */

const INVITED_STAGE = "2. Section Captain Invitation";

/**
 * A minute per person in this isolate, and dropped at once when People
 * changes (invalidation.ts), so a banner goes soon after the form is in.
 */
const MY_RECORD_TTL_MS = 60 * 1000;
const WAITING_ON_TTL_MS = 5 * 60 * 1000;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const firstText = (v: unknown): string | undefined => (Array.isArray(v) ? text(v[0]) : text(v));

/** People id -> the lines the processes are waiting on them for. */
type WaitingOn = Record<string, MyTask[]>;

/**
 * Who both processes are waiting on, for everyone at once: one shared
 * entry, rebuilt when People, Commitments or an office table changes.
 */
async function getWaitingOn(env: Env): Promise<WaitingOn> {
  return getShared<WaitingOn>(
    env,
    WAITING_ON_KEY,
    async () => {
      const reviewStages = [NOTIFIED, MEMBER_SUBMITTED, SPONSOR_SUBMITTED];
      const [applicants, reviews, holders, signing] = await Promise.all([
        people(env).listApplicantsAtStages([INVITED_STAGE]),
        commitments(env).listReviewsAtStages(reviewStages),
        getOfficeHolders(env),
        signingTasks(env),
      ]);

      const out: WaitingOn = {};
      const add = (personId: string | undefined, task: MyTask) => {
        if (!personId) return;
        const list = (out[personId] ??= []);
        if (!list.some((t) => t.id === task.id)) list.push(task);
      };

      // An invited applicant's own application screen (apply.ts).
      for (const r of applicants) {
        if (text(r.stage) === INVITED_STAGE) add(r.id, { id: `joiner:${r.id}`, key: "joiner", url: "/apply" });
      }

      // Signing an application (applicationSigning.ts).
      for (const [personId, tasks] of Object.entries(signing)) for (const t of tasks) add(personId, t);

      // Commitment reviews (reviews.ts).
      for (const r of reviews) {
        // The same cut-off as the Statements board: older periods are history.
        const periodEnd = firstText(r.periodEnd)?.slice(0, 10);
        if (!periodEnd || periodEnd < REVIEWS_FROM) continue;
        const stage = text(r.reviewProgress);
        const member = firstLink(r.people);
        const subject = firstText(r.fullName) ?? "A member";
        if (stage === NOTIFIED) {
          add(member, { id: `statement:${r.id}`, key: "statement", url: `/review/${r.id}` });
        } else if (stage === MEMBER_SUBMITTED) {
          add(holders[firstLink(r.sponsorLink) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Sponsor",
            url: `/review/${r.id}`,
          });
        } else if (stage === SPONSOR_SUBMITTED) {
          add(holders[firstLink(r.officerLink) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Membership Officer",
            url: `/review/${r.id}`,
          });
        }
      }
      return out;
    },
    WAITING_ON_TTL_MS,
  );
}

/** An Active member who hasn't confirmed their details since 1 July. */
async function needsDetailsCheck(env: Env, personId: string, today: string): Promise<boolean> {
  const { data } = await getCached(
    `my-details-check:${personId}`,
    async () => db(env).one<{ status: string | null; active: boolean; profile_updated_at: string | null }>(
      "people",
      `select=status,active,profile_updated_at&api_id=${eq(personId)}`,
    ),
    MY_RECORD_TTL_MS,
  );
  return !!data && data.active && data.status === "Member" && !checkedThisSeason(data.profile_updated_at, today);
}

/** Waivers count for the season they were submitted in (July to June). */
export function waiversDoneThisSeason(submittedAt: unknown, today: string): boolean {
  const at = text(submittedAt);
  if (!at) return false;
  return hkDateKey(at) >= `${seasonStartYear(today)}-07-01`;
}

/** Own forms first, then what others are waiting on, oldest process step first. */
const ORDER: Record<MyTaskKey, number> = { system: -1, joiner: 0, details: 1, statement: 2, waivers: 3, application: 4, send: 5, accept: 6, review: 7, kit: 8, registration: 9, event: 10, register: 11 };

export async function getMyTasks(env: Env, user: AuthorizedUser): Promise<{ tasks: MyTask[] }> {
  const personId = user.personId;
  // An imported person's id, or the uuid of one created in Eddy.
  if (!isRowId(personId)) return { tasks: [] };

  const [mine, waitingOn] = await Promise.all([
    getCached(
      `my-tasks:${personId}`,
      async (): Promise<Partial<MyTaskRow>> => (await people(env).getMyTaskFields(personId)) ?? {},
      MY_RECORD_TTL_MS,
    ).then((hit) => hit.data),
    getWaitingOn(env),
  ]);

  const today = hkDateKey(new Date().toISOString());
  const tasks: MyTask[] = [...(waitingOn[personId] ?? [])];
  if (!waiversDoneThisSeason(mine.waiversSubmittedAt, today)) {
    // Eddy's waivers screen (declarations.ts).
    tasks.push({ id: "waivers", key: "waivers", url: "/waivers" });
  }
  // Members check their details at the start of each season.
  if (await needsDetailsCheck(env, personId, today)) {
    tasks.push({ id: "details", key: "details", url: "/my-details" });
  }
  // A minute in this isolate, dropped when a request is made or marked done.
  const { data: requests } = await getCached(`joiner-tasks:${personId}`, () => openJoinerTasks(env, personId), MY_RECORD_TTL_MS);
  for (const r of requests) tasks.push({ id: `${r.kind}:${r.id}`, key: r.kind, subject: r.subject, url: `/joiner-task/${r.id}` });
  // Events they are invited to and have not answered (events.ts).
  for (const e of await eventTasks(env, user).catch(() => [])) tasks.push({ id: `event:${e.id}`, key: "event", subject: e.title, url: `/?event=${e.id}`, due: e.due });
  // Registers to take for events they keep (events.ts).
  for (const e of await registerTasks(env, user).catch(() => [])) tasks.push({ id: `register:${e.id}`, key: "register", subject: e.title, url: `/events/manage/${e.id}?tab=register` });
  // The owner: the daily health check found something (systemHealth.ts).
  if (await systemNeedsLook(env, user)) tasks.push({ id: "system", key: "system", url: "/system" });
  tasks.sort((a, b) => ORDER[a.key] - ORDER[b.key] || (a.subject ?? "").localeCompare(b.subject ?? ""));
  return { tasks };
}
