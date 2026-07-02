import {
  AirtableRepository
} from "./baseRepository";

import {
  Match
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapMatch
} from "../mappers/matchMapper";

class MatchesRepository
  extends AirtableRepository<Match> {

  constructor() {
    super(
      TABLES.match,
      mapMatch
    );
  }

  async getUpcoming() {
    return this.findAll({
      filterByFormula:
        "IS_AFTER({Match Date},TODAY())"
    });
  }
}

export const matchesRepository =
  new MatchesRepository();