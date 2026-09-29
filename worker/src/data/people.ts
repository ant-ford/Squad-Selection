import { airtableBatchUpdate, airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { normalizeEmail } from "../../../shared/normalizeEmail";
import { TABLES } from "../../../shared/schema/tableNames";
import { PEOPLE_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapPlayer } from "../../../shared/mappers/playerMapper";
import type { Player } from "../../../shared/schema/domainTypes";

/**
 * The People fields the Worker writes. A key left out is not touched; null
 * clears the field.
 */
export interface PersonPatch {
  active?: boolean;
  sectionRank?: number | null;
  playingAbility?: string | null;
  rankUpdatedAt?: string;
  optInOnly?: boolean;
}

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
}

const PATCH_FIELDS: Record<keyof PersonPatch, string> = {
  active: PEOPLE_FIELDS.active,
  sectionRank: PEOPLE_FIELDS.sectionRank,
  playingAbility: PEOPLE_FIELDS.playingAbility,
  rankUpdatedAt: PEOPLE_FIELDS.rankUpdatedAt,
  optInOnly: PEOPLE_FIELDS.optInOnly,
};

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
  };
}

export function people(env: Env): PeopleRepo {
  return pick(env, "people", airtablePeople);
}
