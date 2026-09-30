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
 *
 * And anything the New Joiner and Statements processes are waiting on them
 * for, one line per person, each with that person's form (stage 1 has no
 * line: the owner removed the Section Captains' invite prompt):
 *  - joiner: stage 2, the applicant's own New Joiner Form (club
 *    application). Seen only if the applicant can sign in to Eddy.
 *  - application: stage 3 the sponsor (support form), stage 4 the chairman
 *    and stage 5 the membership officer (signature forms), from the
 *    applicant's Sponsored By links.
 *  - review: a statement at Member Submitted waits on its sponsor, at
 *    Sponsor Submitted on its membership officer.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { getCached, getShared } from "./cache";
import { firstLink, getOfficeHolders } from "./contacts";
import { WAITING_ON_KEY } from "./reference";
import { people, type ApplicantTaskRow, type MyTaskRow } from "./data/people";
import { commitments } from "./data/commitments";
import { backendFor } from "./data/backend";
import { db, eq } from "./data/supabase";
import { checkedThisSeason } from "../../shared/profile";
import { hkDateKey } from "../../shared/hkDateKey";
import { seasonStartYear } from "../../shared/membershipInsights";
import { MEMBER_SUBMITTED, NOTIFIED, REVIEWS_FROM, SPONSOR_SUBMITTED } from "../../shared/statementStages";

export type MyTaskKey = "joiner" | "details" | "statement" | "waivers" | "application" | "review";
export type TaskRole = "Sponsor" | "Chairman" | "Membership Officer";

export interface MyTask {
  /** Unique within the list: the key plus the record it is about. */
  id: string;
  key: MyTaskKey;
  /** The applicant or member the line is about; absent for the person's own forms. */
  subject?: string;
  /** The part the signed-in person plays for that applicant or member. */
  role?: TaskRole;
  /** The form to open, when the base has a link. */
  url?: string;
}

/*
 * The fields read live with the repositories: the signed-in person's own
 * forms and the applicants at stages 2-5 in data/people.ts (MyTaskRow,
 * ApplicantTaskRow), the reviews in progress in data/commitments.ts
 * (ReviewTaskRow).
 */

/** Stage -> who signs it: [role, the applicant's link naming them, their form]. */
const SIGNERS: Record<string, [TaskRole, keyof ApplicantTaskRow, keyof ApplicantTaskRow]> = {
  "3. Club Application (Signed)": ["Sponsor", "sponsoredBySponsor", "sponsorFormUrl"],
  "4. Sponsor (Signed)": ["Chairman", "sponsoredByChair", "chairFormUrl"],
  "5. Chairman (Signed)": ["Membership Officer", "sponsoredByOfficer", "officerFormUrl"],
};
const INVITED_STAGE = "2. Section Captain Invitation";

/**
 * A minute per person in this isolate, and dropped at once when People
 * changes (airtableWebhook.ts), so a banner goes soon after the form is in.
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
      const stages = [INVITED_STAGE, ...Object.keys(SIGNERS)];
      const reviewStages = [NOTIFIED, MEMBER_SUBMITTED, SPONSOR_SUBMITTED];
      const [applicants, reviews, holders] = await Promise.all([
        people(env).listApplicantsAtStages(stages),
        commitments(env).listReviewsAtStages(reviewStages),
        getOfficeHolders(env),
      ]);

      const out: WaitingOn = {};
      const add = (personId: string | undefined, task: MyTask) => {
        if (!personId) return;
        const list = (out[personId] ??= []);
        if (!list.some((t) => t.id === task.id)) list.push(task);
      };

      for (const r of applicants) {
        const stage = text(r.stage) ?? "";
        const first = text(r.preferredName) ?? text(r.givenNames);
        const subject = [first, text(r.surname)].filter(Boolean).join(" ") || "An applicant";
        if (stage === INVITED_STAGE) {
          add(r.id, { id: `joiner:${r.id}`, key: "joiner", url: text(r.joinerFormUrl) });
          continue;
        }
        const signer = SIGNERS[stage];
        if (!signer) continue;
        const [role, link, form] = signer;
        add(holders[firstLink(r[link]) ?? ""], {
          id: `application:${r.id}`,
          key: "application",
          subject,
          role,
          url: text(r[form]),
        });
      }

      // On Supabase the reviews are Eddy's own screen (src/reviews.ts); on
      // Airtable they are still the Fillout forms.
      const inEddy = backendFor(env, "commitments") === "supabase";
      const reviewUrl = (id: string, fillout: unknown) => (inEddy ? `/review/${id}` : text(fillout));
      for (const r of reviews) {
        // The same cut-off as the Statements board: older periods are history.
        const periodEnd = firstText(r.periodEnd)?.slice(0, 10);
        if (!periodEnd || periodEnd < REVIEWS_FROM) continue;
        const stage = text(r.reviewProgress);
        const member = firstLink(r.people);
        const subject = firstText(r.fullName) ?? "A member";
        if (stage === NOTIFIED) {
          add(member, { id: `statement:${r.id}`, key: "statement", url: inEddy ? `/review/${r.id}` : firstText(r.memberFormUrl) });
        } else if (stage === MEMBER_SUBMITTED) {
          add(holders[firstLink(r.sponsorLink) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Sponsor",
            url: reviewUrl(r.id, r.sponsorFormUrl),
          });
        } else if (stage === SPONSOR_SUBMITTED) {
          add(holders[firstLink(r.officerLink) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Membership Officer",
            url: reviewUrl(r.id, r.officerFormUrl),
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
const ORDER: Record<MyTaskKey, number> = { joiner: 0, details: 1, statement: 2, waivers: 3, application: 4, review: 5 };

export async function getMyTasks(env: Env, user: AuthorizedUser): Promise<{ tasks: MyTask[] }> {
  const personId = user.personId;
  const onSupabase = backendFor(env, "people") === "supabase";
  // Airtable ids only on Airtable (the id goes into a formula); on Supabase,
  // people created in Eddy have a uuid.
  const idPattern = onSupabase ? /^(rec[A-Za-z0-9]{14}|[0-9a-f-]{36})$/ : /^rec[A-Za-z0-9]{14}$/;
  if (!personId || !idPattern.test(personId)) return { tasks: [] };

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
    // On Supabase, Eddy's own waivers screen (src/declarations.ts); on Airtable, the Fillout form.
    const inEddy = backendFor(env, "people") === "supabase";
    tasks.push({ id: "waivers", key: "waivers", url: inEddy ? "/waivers" : text(mine.waiversFormUrl) });
  }
  // Members check their details at the start of each season (Supabase: Eddy's screen).
  if (onSupabase && (await needsDetailsCheck(env, personId, today))) {
    tasks.push({ id: "details", key: "details", url: "/my-details" });
  }
  tasks.sort((a, b) => ORDER[a.key] - ORDER[b.key] || (a.subject ?? "").localeCompare(b.subject ?? ""));
  return { tasks };
}
