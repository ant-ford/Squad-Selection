import { AirtableRepository }
  from "./baseRepository";

import { TABLES }
  from "../generated/tableNames";

import { Player }
  from "../generated/domainTypes";

import { mapPlayer }
  from "../mappers/playerMapper";

class PeopleRepository
  extends AirtableRepository<Player> {

  constructor() {
    super(
      TABLES.player,
      mapPlayer
    );
  }

  async getActivePlayers() {
    return this.findAll({
      filterByFormula:
        "{Active}=TRUE()"
    });
  }

  async getPlayersByTeam(
    teamName: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Registered Team}="${teamName}"`
    });
  }

  async getByEmail(
    email: string
  ) {
    const players =
      await this.findAll({
        filterByFormula:
          `{Email}="${email}"`
      });

    return players[0] ?? null;
  }

  async findBySupabaseUserId(supabaseUserId: string): Promise<Player | null> {
    const records = await this.findAll({
      filterByFormula: `{supabaseUserId}="${supabaseUserId}"`  // use the actual field name from Airtable
    });
    return records.length > 0 ? records[0] : null;
  }
}

export const peopleRepository =
  new PeopleRepository();
