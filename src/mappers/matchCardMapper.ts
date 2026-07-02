import {
  MatchCard
} from "../generated/domainTypes";

import {
  MATCHCARDS_FIELDS
} from "../generated/fieldMaps";

export function mapMatchCard(
  record: any
): MatchCard {

  const f = record.fields;

  return {
    id: record.id,

    player:
      f[MATCHCARDS_FIELDS.player],

    match:
      f[MATCHCARDS_FIELDS.match],

    goals:
      f[MATCHCARDS_FIELDS.goals],

    cards:
      f[MATCHCARDS_FIELDS.cards]
  };
}