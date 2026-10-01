/**
 * The officer sections' reads on Supabase: rows keyed by field-map KEYS,
 * selected from api_people_crm / api_commitments_crm, whose columns carry
 * those names. Attachments come back from the views as {fileId, filename}
 * and leave here as {url, filename}, a signed link, as Airtable's did.
 */
import type { Env } from "../../env";
import { HttpError } from "../../http";
import { db, eq, inList } from "../supabase";
import type { FieldMap, Row } from "../rows";
import type { CommitmentsRepo } from "../commitments";
import { NOTIFY_FIELDS, REVIEW_TASK_FIELDS } from "../commitments";
import {
  APPLICANT_STAGE_FIELDS, APPLICANT_TASK_FIELDS, CONTACT_FIELDS, EXPORT_FIELDS, MY_TASK_FIELDS, NAME_FIELDS, NUMBER_HOLDER_FIELDS,
} from "../people";
import { API_ID_RE } from "../ids";
import type { MembershipEventsRepo } from "../membershipEvents";
import { CHAIRMAN_FIELDS, COMMITMENT_FIELDS, MEMBERSHIP_FIELDS } from "../../../../shared/schema/fieldMaps";
import { REVIEWS_FROM } from "../../../../shared/statementStages";
import { fileLink } from "./files";
import { startReview } from "../../reviewEmails";

/** Attachment columns, turned into signed links on the way out. */
const ATTACHMENTS = new Set(["photo", "applicationForm", "playerStatement"]);
/** Keys whose view column has another name. */
const ALIASES: Record<string, string> = { stage: "applicantStage" };

const selectFor = (map: FieldMap) =>
  ["id", ...Object.keys(map).map((k) => (ALIASES[k] ? `${k}:${ALIASES[k]}` : k))].join(",");

async function signAttachments(env: Env, row: Record<string, unknown>) {
  for (const key of ATTACHMENTS) {
    const refs = row[key];
    if (!Array.isArray(refs)) continue;
    row[key] = await Promise.all(
      refs.map(async (r: { fileId: string; filename: string | null }) => ({ url: await fileLink(env, r.fileId), filename: r.filename ?? "Attachment" })),
    );
  }
  return row;
}

export async function selectRows<M extends FieldMap>(env: Env, view: string, map: M, query = ""): Promise<Row<M>[]> {
  const rows = await db(env).select<Record<string, unknown>>(view, `select=${selectFor(map)}${query ? `&${query}` : ""}`);
  return Promise.all(rows.map((r) => signAttachments(env, r))) as Promise<Row<M>[]>;
}

async function selectOne<M extends FieldMap>(env: Env, view: string, map: M, id: string): Promise<Row<M> | null> {
  const [row] = await selectRows(env, view, map, `id=${eq(id)}&limit=1`);
  return row ?? null;
}

/** "column <> value", counting a blank as different, as Airtable's != does. */
const notEq = (col: string, value: string) => `or(${col}.is.null,${col}.neq.${encodeURIComponent(value)})`;

/** The People repository's officer-section reads (merged into supabasePeople). */
export function peopleCrmReads(env: Env) {
  return {
    listMembershipBoard: () =>
      selectRows(env, "api_people_crm", MEMBERSHIP_FIELDS, `and=(applicantStage.not.is.null,${notEq("status", "Resigned")})`),
    listActiveForExport: async () => {
      return selectRows(env, "api_people_crm", EXPORT_FIELDS, `and=(active.is.true,${notEq("applicantStage", "Temporary")})`);
    },
    listByMembershipNo: async (membershipNo: string) => {
      return selectRows(env, "api_people_crm", NUMBER_HOLDER_FIELDS, `membershipNo=${eq(membershipNo)}`);
    },
    getApplicantStage: async (id: string) => {
      return selectOne(env, "api_people_crm", APPLICANT_STAGE_FIELDS, id);
    },
    listDirectory: () => selectRows(env, "api_people_crm", CHAIRMAN_FIELDS, "or=(status.is.null,status.neq.Resigned)"),
    listContactsByIds: async (ids: Iterable<string>) => {
      const wanted = [...new Set([...ids].filter((id) => API_ID_RE.test(id)))];
      if (wanted.length === 0) return [];
      return selectRows(env, "api_people_crm", CONTACT_FIELDS, `id=${inList(wanted)}`);
    },
    listNames: async () => {
      return selectRows(env, "api_people_crm", NAME_FIELDS);
    },
    getMyTaskFields: async (id: string) => {
      return selectOne(env, "api_people_crm", MY_TASK_FIELDS, id);
    },
    listApplicantsAtStages: async (stages: readonly string[]) => {
      if (stages.length === 0) return [];
      return selectRows(env, "api_people_crm", APPLICANT_TASK_FIELDS, `applicantStage=${inList(stages)}`);
    },
  };
}

const addDays = (dayKey: string, n: number) =>
  new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function supabaseCommitments(env: Env): CommitmentsRepo {
  return {
    listReviewBoard() {
      // Started periods ending on or after REVIEWS_FROM, with the same day's
      // slack either side as the Airtable formula.
      const today = new Date().toISOString().slice(0, 10);
      return selectRows(
        env,
        "api_commitments_crm",
        COMMITMENT_FIELDS,
        `periodStart=lt.${addDays(today, 2)}&periodEnd=gt.${addDays(REVIEWS_FROM, -2)}`,
      );
    },
    getNotifyState: (id) => selectOne(env, "api_commitments_crm", NOTIFY_FIELDS, id),
    async setNotifyNow(id) {
      // On Supabase "Notify Now" is Eddy sending the review email itself - the
      // job the Airtable automation did when the box was ticked.
      if (!(await startReview(env, id))) {
        throw new HttpError("This review has already been started.", 409, "ALREADY_STARTED");
      }
    },
    listReviewsAtStages(stages) {
      if (stages.length === 0) return Promise.resolve([]);
      return selectRows(env, "api_commitments_crm", REVIEW_TASK_FIELDS, `reviewProgress=${inList(stages)}`);
    },
  };
}

/** Which fields each membership action changes, for the activity log (names, never values). */
const EVENT_FIELDS: Record<string, string[]> = {
  Approved: ["status", "applicant_stage", "join_date", "commitment_end_date", "membership_no"],
  Notified: ["review_progress"],
  Exported: [],
};

export function supabaseMembershipEvents(env: Env): MembershipEventsRepo {
  return {
    async record(e) {
      await db(env).rpc("log_activity", {
        p: {
          occurredAt: e.timestamp,
          actorId: e.actorId ?? null,
          action: e.eventType.toLowerCase(),
          entity: "people",
          entityId: e.personId ?? null,
          fields: EVENT_FIELDS[e.eventType] ?? [],
        },
      });
    },
  };
}
