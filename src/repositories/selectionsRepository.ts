import {
  AirtableRepository
} from "./baseRepository";

import {
  SquadSelection
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapSelection
} from "../mappers/selectionMapper";

class SelectionsRepository
  extends AirtableRepository<SquadSelection> {

  constructor() {
    super(
      TABLES.squadSelection,
      mapSelection
    );
  }

  async getMatchSelections(
    matchId: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Match}="${matchId}"`
    });
  }
}

export const selectionsRepository =
  new SelectionsRepository();