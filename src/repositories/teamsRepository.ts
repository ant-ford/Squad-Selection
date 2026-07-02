import {
  AirtableRepository
} from "./baseRepository";

import {
  Team
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapTeam
} from "../mappers/teamMapper";

class TeamsRepository
  extends AirtableRepository<Team> {

  constructor() {
    super(
      TABLES.team,
      mapTeam
    );
  }

  async getActiveTeams() {
    return this.findAll({
      filterByFormula:
        "{Active}=TRUE()"
    });
  }
}

export const teamsRepository =
  new TeamsRepository();