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
import { airtableFindAll } from "./airtable";
import { getCached, getShared } from "./cache";
import { firstLink, getOfficeHolders } from "./contacts";
import { WAITING_ON_KEY } from "./reference";
import { TABLES } from "../../shared/schema/tableNames";
import { COMMITMENT_FIELDS as CF } from "../../shared/schema/fieldMaps";
import { hkDateKey } from "../../shared/hkDateKey";
import { seasonStartYear } from "../../shared/membershipInsights";
import { MEMBER_SUBMITTED, NOTIFIED, REVIEWS_FROM, SPONSOR_SUBMITTED } from "../../shared/statementStages";

export type MyTaskKey = "joiner" | "statement" | "waivers" | "application" | "review";
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

/** People fields read for the signed-in person only, by record id. */
export const MY_TASK_FIELDS = {
  waiversSubmittedAt: "Last Submission: Waivers & Declarations",
  waiversFormUrl: "Fillout - Member Waivers & Declarations",
} as const;

/** Applicants at stages 2-5: who is next, and their form. */
const APPLICANT_FIELDS = {
  stage: "Applicant Stage",
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  sponsoredBySponsor: "Sponsored By Sponsor",
  sponsoredByChair: "Sponsored By Chair",
  sponsoredByOfficer: "Sponsored By Membership Officer",
  joinerFormUrl: "Fillout - Applicant (New Joiner Form)",
  sponsorFormUrl: "Fillout - Sponsor (Page 7)",
  chairFormUrl: "Fillout - Chairman (Page 7 Signature)",
  officerFormUrl: "Fillout - Membership Officer (Page 7 Signature)",
} as const;

/** Reviews in progress: who they wait on, and each one's form. */
const REVIEW_FIELDS = {
  reviewProgress: CF.reviewProgress,
  people: CF.people,
  fullName: CF.fullName,
  periodEnd: CF.periodEnd,
  sponsorLink: CF.sponsorLink,
  officerLink: "Membership Officers",
  /** A lookup of the member's own People formula. */
  memberFormUrl: "Fillout - Member (Commitment Record Picker)",
  sponsorFormUrl: "Fillout - Sponsor (Commitment Review Form)",
  officerFormUrl: CF.officerFormUrl,
} as const;

/** Stage -> who signs it: [role, the applicant's link naming them, their form]. */
const SIGNERS: Record<string, [TaskRole, string, string]> = {
  "3. Club Application (Signed)": ["Sponsor", APPLICANT_FIELDS.sponsoredBySponsor, APPLICANT_FIELDS.sponsorFormUrl],
  "4. Sponsor (Signed)": ["Chairman", APPLICANT_FIELDS.sponsoredByChair, APPLICANT_FIELDS.chairFormUrl],
  "5. Chairman (Signed)": ["Membership Officer", APPLICANT_FIELDS.sponsoredByOfficer, APPLICANT_FIELDS.officerFormUrl],
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
        airtableFindAll(
          env,
          TABLES.player,
          `OR(${stages.map((s) => `{${APPLICANT_FIELDS.stage}}="${s}"`).join(",")})`,
          undefined,
          Object.values(APPLICANT_FIELDS),
        ),
        airtableFindAll(
          env,
          TABLES.commitment,
          `OR(${reviewStages.map((s) => `{${REVIEW_FIELDS.reviewProgress}}="${s}"`).join(",")})`,
          undefined,
          Object.values(REVIEW_FIELDS),
        ),
        getOfficeHolders(env),
      ]);

      const out: WaitingOn = {};
      const add = (personId: string | undefined, task: MyTask) => {
        if (!personId) return;
        const list = (out[personId] ??= []);
        if (!list.some((t) => t.id === task.id)) list.push(task);
      };

      for (const r of applicants) {
        const f = r.fields ?? {};
        const stage = text(f[APPLICANT_FIELDS.stage]) ?? "";
        const first = text(f[APPLICANT_FIELDS.preferredName]) ?? text(f[APPLICANT_FIELDS.givenNames]);
        const subject = [first, text(f[APPLICANT_FIELDS.surname])].filter(Boolean).join(" ") || "An applicant";
        if (stage === INVITED_STAGE) {
          add(r.id, { id: `joiner:${r.id}`, key: "joiner", url: text(f[APPLICANT_FIELDS.joinerFormUrl]) });
          continue;
        }
        const signer = SIGNERS[stage];
        if (!signer) continue;
        const [role, link, form] = signer;
        add(holders[firstLink(f[link]) ?? ""], {
          id: `application:${r.id}`,
          key: "application",
          subject,
          role,
          url: text(f[form]),
        });
      }

      for (const r of reviews) {
        const f = r.fields ?? {};
        // The same cut-off as the Statements board: older periods are history.
        const periodEnd = firstText(f[REVIEW_FIELDS.periodEnd])?.slice(0, 10);
        if (!periodEnd || periodEnd < REVIEWS_FROM) continue;
        const stage = text(f[REVIEW_FIELDS.reviewProgress]);
        const member = firstLink(f[REVIEW_FIELDS.people]);
        const subject = firstText(f[REVIEW_FIELDS.fullName]) ?? "A member";
        if (stage === NOTIFIED) {
          add(member, { id: `statement:${r.id}`, key: "statement", url: firstText(f[REVIEW_FIELDS.memberFormUrl]) });
        } else if (stage === MEMBER_SUBMITTED) {
          add(holders[firstLink(f[REVIEW_FIELDS.sponsorLink]) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Sponsor",
            url: text(f[REVIEW_FIELDS.sponsorFormUrl]),
          });
        } else if (stage === SPONSOR_SUBMITTED) {
          add(holders[firstLink(f[REVIEW_FIELDS.officerLink]) ?? ""], {
            id: `review:${r.id}`,
            key: "review",
            subject,
            role: "Membership Officer",
            url: text(f[REVIEW_FIELDS.officerFormUrl]),
          });
        }
      }
      return out;
    },
    WAITING_ON_TTL_MS,
  );
}

/** Waivers count for the season they were submitted in (July to June). */
export function waiversDoneThisSeason(submittedAt: unknown, today: string): boolean {
  const at = text(submittedAt);
  if (!at) return false;
  return hkDateKey(at) >= `${seasonStartYear(today)}-07-01`;
}

/** Own forms first, then what others are waiting on, oldest process step first. */
const ORDER: Record<MyTaskKey, number> = { joiner: 0, statement: 1, waivers: 2, application: 3, review: 4 };

export async function getMyTasks(env: Env, user: AuthorizedUser): Promise<{ tasks: MyTask[] }> {
  const personId = user.personId;
  if (!personId || !/^rec[A-Za-z0-9]{14}$/.test(personId)) return { tasks: [] };

  const [record, waitingOn] = await Promise.all([
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
    getWaitingOn(env),
  ]);

  const today = hkDateKey(new Date().toISOString());
  const tasks: MyTask[] = [...(waitingOn[personId] ?? [])];
  if (!waiversDoneThisSeason(record[MY_TASK_FIELDS.waiversSubmittedAt], today)) {
    tasks.push({ id: "waivers", key: "waivers", url: text(record[MY_TASK_FIELDS.waiversFormUrl]) });
  }
  tasks.sort((a, b) => ORDER[a.key] - ORDER[b.key] || (a.subject ?? "").localeCompare(b.subject ?? ""));
  return { tasks };
}
