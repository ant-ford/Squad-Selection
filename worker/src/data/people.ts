import { airtableFindAll, airtableFindById, escapeFormulaValue } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { normalizeEmail } from "../../../shared/normalizeEmail";
import { TABLES } from "../../../shared/schema/tableNames";
import { PEOPLE_FIELDS } from "../../../shared/schema/fieldMaps";
import { mapPlayer } from "../../../shared/mappers/playerMapper";
import type { Player } from "../../../shared/schema/domainTypes";

export interface PeopleRepo {
  /** Every person with Active ticked. */
  listActive(): Promise<Player[]>;
  /**
   * The person whose Email matches, case-insensitively on both sides. Where
   * several share it, an Active record wins over an inactive one.
   */
  findByEmail(email: string): Promise<Player | null>;
  getById(id: string): Promise<Player | null>;
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
  };
}

export function people(env: Env): PeopleRepo {
  return pick(env, "people", airtablePeople);
}
