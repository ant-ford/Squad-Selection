import { airtableBatchUpdate, airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { supabasePeople } from "./supabase/people";
import { toRow, type Row } from "./rows";
import { normalizeEmail } from "../../../shared/normalizeEmail";
import { TABLES } from "../../../shared/schema/tableNames";
import { CHAIRMAN_FIELDS, MEMBERSHIP_FIELDS, PEOPLE_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapPlayer } from "../../../shared/mappers/playerMapper";
import type { Player } from "../../../shared/schema/domainTypes";

/**
 * The People fields the Worker writes. A key left out is not touched; null
 * clears the field. Never a link field: a PATCH naming a link replaces the
 * link's whole contents (see approveApplicant in membership.ts).
 */
export interface PersonPatch {
  active?: boolean;
  sectionRank?: number | null;
  playingAbility?: string | null;
  rankUpdatedAt?: string;
  optInOnly?: boolean;
  status?: string;
  applicantStage?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  membershipNo?: string;
}

// ── Row views for the membership, chairman, contacts, stats and My Tasks reads ──
//
// Each map is the exact projection its read requests (values, in order) and
// the keys module code reads. Reads for the membership and chairman sections
// never request an HKID, bank or address field.

/** The applicant board and Insights (membership.ts). */
export type MembershipRow = Row<typeof MEMBERSHIP_FIELDS>;

/** The active-members export. */
export const EXPORT_FIELDS = {
  membershipNo: MEMBERSHIP_FIELDS.membershipNo,
  surname: MEMBERSHIP_FIELDS.surname,
  givenNames: MEMBERSHIP_FIELDS.givenNames,
  status: MEMBERSHIP_FIELDS.status,
  applicantStage: MEMBERSHIP_FIELDS.applicantStage,
} as const;
export type ExportRow = Row<typeof EXPORT_FIELDS>;

/** Who else holds a Membership No. */
export const NUMBER_HOLDER_FIELDS = {
  membershipNo: MEMBERSHIP_FIELDS.membershipNo,
  preferredName: MEMBERSHIP_FIELDS.preferredName,
  givenNames: MEMBERSHIP_FIELDS.givenNames,
  surname: MEMBERSHIP_FIELDS.surname,
  status: MEMBERSHIP_FIELDS.status,
} as const;
export type NumberHolderRow = Row<typeof NUMBER_HOLDER_FIELDS>;

export const APPLICANT_STAGE_FIELDS = { applicantStage: MEMBERSHIP_FIELDS.applicantStage } as const;
export type ApplicantStageRow = Row<typeof APPLICANT_STAGE_FIELDS>;

/** The chairman's email-list directory (chairman.ts). */
export type DirectoryRow = Row<typeof CHAIRMAN_FIELDS>;

/** What a WhatsApp shortcut needs (contacts.ts). */
export const CONTACT_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  mobileNo: "Mobile No.",
  photo: "Photo",
  status: "Status",
} as const;
export type ContactRow = Row<typeof CONTACT_FIELDS>;

/** Everyone's name, for the Stats page (clubStats.ts). */
export const NAME_FIELDS = {
  preferredName: "Preferred Name",
  givenNames: "Given Name(s)",
  surname: "Surname",
  // Only to tell a father from a son who share a name; not stored.
  dateOfBirth: "Date of Birth",
} as const;
export type NameRow = Row<typeof NAME_FIELDS>;

/** The signed-in person's own forms, for My Tasks (myTasks.ts). */
export const MY_TASK_FIELDS = {
  waiversSubmittedAt: "Last Submission: Waivers & Declarations",
  waiversFormUrl: "Fillout - Member Waivers & Declarations",
} as const;
export type MyTaskRow = Row<typeof MY_TASK_FIELDS>;

/** Applicants in the New Joiner process: who is next, and their form (myTasks.ts). */
export const APPLICANT_TASK_FIELDS = {
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
export type ApplicantTaskRow = Row<typeof APPLICANT_TASK_FIELDS>;

/** A People record id, as Airtable writes one. */
export const ID_RE = /^rec[A-Za-z0-9]{14}$/;

/** Record ids per request: keeps the filter formula well inside URL limits. */
const IDS_PER_READ = 40;

export interface PeopleRepo {
  /** Every person with Active ticked. */
  listActive(): Promise<Player[]>;
  /**
   * The person whose Email matches, case-insensitively on both sides. Where
   * several share it, an Active record wins over an inactive one.
   */
  findByEmail(email: string): Promise<Player | null>;
  getById(id: string): Promise<Player | null>;
  /**
   * Everyone in the Section Ranking: Active players and Applicants, less
   * anyone Rejected or Resigned. Unsorted.
   */
  listRankingPool(): Promise<Player[]>;
  /** Inactive members who could be brought back into the ranking. Unsorted. */
  listInactiveRankable(): Promise<Player[]>;
  update(id: string, patch: PersonPatch): Promise<void>;
  /** Several people at once, in order. Not atomic on Airtable. */
  updateMany(updates: { id: string; patch: PersonPatch }[]): Promise<void>;

  /**
   * Everyone who has ever had an Applicant Stage and has not resigned. A
   * superset: belongsOnBoard and the insight facts are the rules.
   */
  listMembershipBoard(): Promise<MembershipRow[]>;
  /** Active people, less (most) Temporary players. The caller re-checks the stage. */
  listActiveForExport(): Promise<ExportRow[]>;
  /** People whose Membership No. matches (a superset; the caller compares exactly). */
  listByMembershipNo(membershipNo: string): Promise<NumberHolderRow[]>;
  /** One person's Applicant Stage, read fresh; null when there is no such person. */
  getApplicantStage(id: string): Promise<ApplicantStageRow | null>;
  /** Everyone not Resigned (a superset; the caller re-checks). */
  listDirectory(): Promise<DirectoryRow[]>;
  /**
   * Contact details for the given ids. Anything that is not a record id is
   * ignored; each person comes back once, in no particular order.
   */
  listContactsByIds(ids: Iterable<string>): Promise<ContactRow[]>;
  /** Everyone in People, with their names. */
  listNames(): Promise<NameRow[]>;
  /** The person's own-forms fields; null when there is no such person. */
  getMyTaskFields(id: string): Promise<MyTaskRow | null>;
  /** Applicants at any of the given Applicant Stage values. */
  listApplicantsAtStages(stages: readonly string[]): Promise<ApplicantTaskRow[]>;
}

const PATCH_FIELDS: Record<keyof PersonPatch, string> = {
  active: PEOPLE_FIELDS.active,
  sectionRank: PEOPLE_FIELDS.sectionRank,
  playingAbility: PEOPLE_FIELDS.playingAbility,
  rankUpdatedAt: PEOPLE_FIELDS.rankUpdatedAt,
  optInOnly: PEOPLE_FIELDS.optInOnly,
  status: MEMBERSHIP_FIELDS.status,
  applicantStage: MEMBERSHIP_FIELDS.applicantStage,
  joinDate: MEMBERSHIP_FIELDS.joinDate,
  commitmentEndDate: MEMBERSHIP_FIELDS.commitmentEndDate,
  membershipNo: MEMBERSHIP_FIELDS.membershipNo,
};

/** A filtered list rather than a record GET, which cannot be projected and would bring back the whole CRM record. */
async function findOne<M extends Record<string, string>>(env: Env, id: string, map: M): Promise<Row<M> | null> {
  const found = await airtableFindAll(env, TABLES.player, `RECORD_ID()="${id}"`, undefined, Object.values(map));
  const record = found.find((r) => r.id === id);
  return record ? toRow(record, map) : null;
}

function toFields(patch: PersonPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) fields[PATCH_FIELDS[key as keyof PersonPatch]] = value;
  }
  return fields;
}

function airtablePeople(env: Env): PeopleRepo {
  return {
    async listActive() {
      const records = await airtableFindAll(env, TABLES.player, "{Active}=TRUE()");
      return records.map(mapPlayer);
    },

    async findByEmail(email) {
      // Matching an email is case-insensitive on BOTH sides, unconditionally.
      //
      // Airtable's "=" compares text case-sensitively, so the original
      // {Email}="<address>" missed every People record whose Email held a capital
      // letter and refused that person as if they were not in the club. LOWER()
      // fixes the stored side. Lowercasing here rather than trusting the caller
      // fixes the other side: auth.ts happens to pass a normalized address, but a
      // caller that did not (recordRankingEvents resolving an actor, say) would
      // reintroduce exactly the same silent miss.
      const normalized = normalizeEmail(email);
      const records = await airtableFindAll(
        env,
        TABLES.player,
        `LOWER({${PEOPLE_FIELDS.email}})="${escapeFormulaValue(normalized)}"`,
      );
      // Airtable cannot enforce uniqueness on Email, and a stale duplicate is
      // easy to create. Taking whichever record came back first let a superseded
      // row decide someone's access: the person is refused while the record an
      // administrator is looking at plainly says Active. Prefer an active record
      // over an inactive one, and always say in the logs that a choice was made,
      // so the underlying duplicate still gets cleaned up.
      if (records.length > 1) {
        console.warn(
          `${records.length} People records share the email ${normalized}: ` +
            `${records.map((r) => r.id).join(", ")} - resolve the duplicate in Airtable`,
        );
      }
      const chosen = records.find((r) => r.fields?.[PEOPLE_FIELDS.active] === true) ?? records[0];
      return chosen ? mapPlayer(chosen) : null;
    },

    async getById(id) {
      const record = await airtableFindById(env, TABLES.player, id);
      return record ? mapPlayer(record) : null;
    },

    async listRankingPool() {
      const records = await airtableFindAll(
        env,
        TABLES.player,
        'AND({Applicant Stage}!="Rejected", {Status}!="Resigned", OR({Active}=TRUE(), {Status}="Applicant"))',
      );
      return records.map(mapPlayer);
    },

    async listInactiveRankable() {
      const records = await airtableFindAll(
        env,
        TABLES.player,
        'AND({Active}=FALSE(), {Status}!="Applicant", {Status}!="Resigned", {Applicant Stage}!="Rejected")',
      );
      return records.map(mapPlayer);
    },

    async update(id, patch) {
      await airtableUpdate(env, TABLES.player, id, toFields(patch));
    },

    async updateMany(updates) {
      // Ten per request, one request at a time: parallel PATCH streams tripped
      // Airtable's rate limit (see the 429 retry in airtable.ts).
      for (let i = 0; i < updates.length; i += 10) {
        const batch = updates.slice(i, i + 10).map(({ id, patch }) => ({ id, fields: toFields(patch) }));
        await airtableBatchUpdate(env, TABLES.player, batch);
      }
    },

    async listMembershipBoard() {
      const F = MEMBERSHIP_FIELDS;
      const records = await airtableFindAll(
        env,
        TABLES.player,
        `AND({${F.applicantStage}}!="", {${F.status}}!="Resigned")`,
        undefined,
        Object.values(F),
      );
      return records.map((r) => toRow(r, F));
    },

    async listActiveForExport() {
      const records = await airtableFindAll(
        env,
        TABLES.player,
        `AND({Active}=TRUE(), {${EXPORT_FIELDS.applicantStage}}!="Temporary")`,
        undefined,
        Object.values(EXPORT_FIELDS),
      );
      return records.map((r) => toRow(r, EXPORT_FIELDS));
    },

    async listByMembershipNo(membershipNo) {
      const records = await airtableFindAll(
        env,
        TABLES.player,
        `{${NUMBER_HOLDER_FIELDS.membershipNo}}="${escapeFormulaValue(membershipNo)}"`,
        undefined,
        Object.values(NUMBER_HOLDER_FIELDS),
      );
      return records.map((r) => toRow(r, NUMBER_HOLDER_FIELDS));
    },

    async getApplicantStage(id) {
      return findOne(env, id, APPLICANT_STAGE_FIELDS);
    },

    async listDirectory() {
      const F = CHAIRMAN_FIELDS;
      const records = await airtableFindAll(env, TABLES.player, `{${F.status}}!="Resigned"`, undefined, Object.values(F));
      return records.map((r) => toRow(r, F));
    },

    async listContactsByIds(ids) {
      const wanted = [...new Set([...ids].filter((id) => ID_RE.test(id)))];
      const chunks: string[][] = [];
      for (let i = 0; i < wanted.length; i += IDS_PER_READ) chunks.push(wanted.slice(i, i + IDS_PER_READ));
      const pages = await Promise.all(
        chunks.map((chunk) =>
          airtableFindAll(
            env,
            TABLES.player,
            `OR(${chunk.map((id) => `RECORD_ID()="${id}"`).join(",")})`,
            undefined,
            Object.values(CONTACT_FIELDS),
          ),
        ),
      );
      return pages
        .flat()
        .filter((record) => wanted.includes(record.id))
        .map((record) => toRow(record, CONTACT_FIELDS));
    },

    async listNames() {
      const records = await airtableFindAll(env, TABLES.player, undefined, undefined, Object.values(NAME_FIELDS));
      return records.map((r) => toRow(r, NAME_FIELDS));
    },

    async getMyTaskFields(id) {
      return findOne(env, id, MY_TASK_FIELDS);
    },

    async listApplicantsAtStages(stages) {
      const records = await airtableFindAll(
        env,
        TABLES.player,
        `OR(${stages.map((s) => `{${APPLICANT_TASK_FIELDS.stage}}="${s}"`).join(",")})`,
        undefined,
        Object.values(APPLICANT_TASK_FIELDS),
      );
      return records.map((r) => toRow(r, APPLICANT_TASK_FIELDS));
    },
  };
}

export function people(env: Env): PeopleRepo {
  return pick(env, "people", airtablePeople, supabasePeople);
}
