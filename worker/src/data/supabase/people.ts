import type { Env } from "../../env";
import { normalizeEmail } from "../../../../shared/normalizeEmail";
import { db, eq } from "../supabase";
import type { PeopleRepo, PersonPatch } from "../people";
import { toPlayer, toPlayerLite, type PlayerLiteRow, type PlayerRow } from "./mappers";
import { peopleCrmReads } from "./crm";

/** People columns the Worker writes, by PersonPatch key. */
const COLUMNS: Record<keyof PersonPatch, string> = {
  active: "active",
  sectionRank: "section_rank",
  playingAbility: "playing_ability",
  rankUpdatedAt: "rank_updated_at",
  optInOnly: "opt_in_only",
  status: "status",
  applicantStage: "applicant_stage",
  joinDate: "join_date",
  commitmentEndDate: "commitment_end_date",
  membershipNo: "membership_no",
};

function toColumns(patch: PersonPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) out[COLUMNS[key as keyof PersonPatch]] = value;
  return out;
}

/** A PostgREST condition "column <> value", counting a blank as different (Airtable's != does). */
const notEq = (col: string, value: string) => `or(${col}.is.null,${col}.neq.${encodeURIComponent(value)})`;

export function supabasePeople(env: Env): PeopleRepo {
  const d = db(env);
  const players = async (query: string) =>
    Promise.all((await d.select<PlayerRow>("api_players", `select=*&${query}`)).map((r) => toPlayer(env, r)));

  return {
    // The squad screens' columns only (api_players_lite): no photo lookup or
    // signing, CV, coach notes or date of birth.
    listActive: async () => (await d.select<PlayerLiteRow>("api_players_lite", "select=*&active=is.true")).map(toPlayerLite),

    async findByEmail(email) {
      const rows = await d.select<PlayerRow>("api_players", `select=*&email_lower=${eq(normalizeEmail(email))}`);
      // Postgres keeps emails unique, so this is one row at most; the Active
      // preference is kept as a defence.
      const chosen = rows.find((r) => r.active) ?? rows[0];
      return chosen ? toPlayer(env, chosen) : null;
    },

    async getById(id) {
      const row = await d.one<PlayerRow>("api_players", `select=*&id=${eq(id)}`);
      return row ? toPlayer(env, row) : null;
    },

    listRankingPool: () =>
      players(`and=(or(active.is.true,status.eq.Applicant),${notEq("applicant_stage", "Rejected")},${notEq("status", "Resigned")})`),

    listInactiveRankable: () =>
      players(`and=(active.is.false,${notEq("status", "Applicant")},${notEq("status", "Resigned")},${notEq("applicant_stage", "Rejected")})`),

    async update(id, patch) {
      const rows = await d.update("people", `api_id=${eq(id)}`, toColumns(patch));
      if (rows.length === 0) throw new Error(`No person ${id}`);
    },

    async updateMany(updates) {
      if (updates.length === 0) return;
      // One transaction: a reorder either lands whole or not at all.
      await d.rpc("update_people_ranks", { p: updates.map(({ id, patch }) => ({ id, ...patch })) });
    },

    // The officer sections' reads (api_people_crm).
    ...peopleCrmReads(env),
  };
}
