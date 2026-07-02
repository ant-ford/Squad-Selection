import {
  AirtableRepository
} from "./baseRepository";

import {
  AvailabilityException
} from "../generated/domainTypes";

import {
  TABLES
} from "../generated/tableNames";

import {
  mapAvailability
} from "../mappers/availabilityMapper";

class AvailabilityRepository
  extends AirtableRepository<AvailabilityException> {

  constructor() {
    super(
      TABLES.availabilityException,
      mapAvailability
    );
  }

  async getForMatch(
    matchId: string
  ) {
    return this.findAll({
      filterByFormula:
        `{Match}="${matchId}"`
    });
  }
}

export const availabilityRepository =
  new AvailabilityRepository();